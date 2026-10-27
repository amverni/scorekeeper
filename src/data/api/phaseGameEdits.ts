import type { EditGamePlayersInput, GameId, PhaseGameEditor } from "../../types";
import {
  finalizeGame,
  type GameLifecycleTransaction,
  requirePlayers,
  withGameTransaction,
} from "./gameLifecycle";
import { assertSavedSeats } from "./gameMembership";
import { deriveGameReadModel } from "./gameReadModel";
import { assertActivePhaseGame, assertPhaseRounds } from "./games";
import { phasesApi } from "./phases";
import { resolveGameCompletion } from "./roundCompletion";

export const phaseGameEdits = {
  async getEditor(id: GameId): Promise<PhaseGameEditor | null> {
    const saved = await withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(id);
      if (!game || game.scorekeeper !== "phase10") return null;
      if (game.status !== "active") {
        throw new Error("Reopen this Completed Game for correction before editing.");
      }
      return loadEditor(tx, id);
    });
    if (!saved) return null;
    const found = await phasesApi.getByIds(saved.game.phaseSet.phases);
    const byId = new Map(found.map((phase) => [phase.id, phase]));
    const phases = saved.game.phaseSet.phases.map((id) => {
      const phase = byId.get(id);
      if (!phase) throw new Error(`Phase no longer exists: ${id}`);
      return phase;
    });
    return {
      game: saved.game,
      players: saved.players,
      version: saved.view.version,
      phases,
      withdrawnPlayers: saved.view.players
        .filter((player) => player.place === null)
        .map(({ id }) => id),
      finishedPlayers: saved.view.players
        .filter((player) => player.progress.isFinished)
        .map(({ id }) => id),
    };
  },

  preview(input: EditGamePlayersInput) {
    return withGameTransaction(async (tx) => {
      const { requiresConfirmation } = await evaluateEdit(tx, input);
      return { requiresConfirmation };
    });
  },

  edit(input: EditGamePlayersInput) {
    return withGameTransaction(async (tx) => {
      const { game, players, rounds, requiresConfirmation } = await evaluateEdit(tx, input);
      if (requiresConfirmation && input.confirmImpact !== true) {
        throw new Error("This edit will change game results. Confirm the edit before saving.");
      }
      const saved = { ...game, deferFinishChoiceUntilSave: undefined, lastActivityAt: Date.now() };
      const completion = resolveGameCompletion({
        game: saved,
        players,
        rounds,
        completedAt: saved.lastActivityAt,
      });
      if (completion) {
        await finalizeGame(tx, completion.completedGame);
        return completion.completedGame;
      }
      await tx.objectStore("games").put(saved);
      return saved;
    });
  },
};

async function loadEditor(tx: GameLifecycleTransaction, id: GameId) {
  const game = await tx.objectStore("games").get(id);
  assertActivePhaseGame(game);
  const [players, rounds] = await Promise.all([
    requirePlayers(tx, game.players),
    tx.objectStore("rounds").index("by-game").getAll(id),
  ]);
  assertPhaseRounds(rounds);
  return { game, players, rounds, view: deriveGameReadModel({ game, players, rounds }) };
}

async function evaluateEdit(tx: GameLifecycleTransaction, input: EditGamePlayersInput) {
  const { game, players, rounds, view } = await loadEditor(tx, input.gameId);
  if (input.version !== view.version) {
    throw new Error("Game history changed. Close and reopen Edit game to load the saved values.");
  }
  if (view.gameEndingRound !== null) {
    throw new Error("Resolve Finish Game before adding Players.");
  }
  assertSavedSeats(game.players, input.players);
  const addedIds = input.players.filter((id) => !game.players.includes(id));
  const addedPlayers = await requirePlayers(tx, addedIds);
  const savedWithdrawn = new Set(
    view.players.filter((player) => player.place === null).map(({ id }) => id),
  );
  const withdrawnPlayers =
    input.withdrawnPlayers === undefined ? [...savedWithdrawn] : input.withdrawnPlayers;
  if (
    !Array.isArray(withdrawnPlayers) ||
    new Set(withdrawnPlayers).size !== withdrawnPlayers.length ||
    withdrawnPlayers.some((id) => !game.players.includes(id))
  ) {
    throw new Error("Withdrawn Players must be unique saved Game members.");
  }
  const withdrawn = new Set(withdrawnPlayers);
  const afterRoundNumber = view.nextRoundNumber - 1;
  const changes = game.players
    .filter((id) => savedWithdrawn.has(id) !== withdrawn.has(id))
    .map((playerId) => ({
      playerId,
      afterRoundNumber,
      type: withdrawn.has(playerId) ? ("withdrawal" as const) : ("rejoin" as const),
    }));
  if (addedIds.length === 0 && changes.length === 0) {
    throw new Error("No Game membership changes to save.");
  }
  if (view.players.some((player) => player.progress.isFinished && withdrawn.has(player.id))) {
    throw new Error("Finished Players cannot Withdraw.");
  }
  if (
    changes.some(({ type }) => type === "withdrawal") &&
    input.players.length - withdrawn.size < 2
  ) {
    throw new Error("Withdrawal must leave at least two eligible Players.");
  }
  const proposed = {
    ...game,
    players: [...input.players],
    activePlayers: input.players.filter(
      (id) => game.activePlayers.includes(id) || addedIds.includes(id),
    ),
    playerJoins: [
      ...(game.playerJoins ?? []),
      ...addedIds.map((playerId) => ({
        playerId,
        afterRoundNumber,
      })),
    ],
    playerMembershipChanges: [...(game.playerMembershipChanges ?? []), ...changes],
  };
  deriveGameReadModel({ game: proposed, players: [...players, ...addedPlayers], rounds });
  return {
    game: proposed,
    players: [...players, ...addedPlayers],
    rounds,
    requiresConfirmation: rounds.length > 0,
  };
}
