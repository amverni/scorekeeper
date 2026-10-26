import type { EditGamePlayersInput, GameId, PhaseGameEditor } from "../../types";
import {
  type GameLifecycleTransaction,
  requirePlayers,
  withGameTransaction,
} from "./gameLifecycle";
import { assertSavedSeats } from "./gameMembership";
import { deriveGameReadModel } from "./gameReadModel";
import { assertActivePhaseGame, assertPhaseRounds } from "./games";
import { phasesApi } from "./phases";

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
    return { game: saved.game, players: saved.players, version: saved.view.version, phases };
  },

  preview(input: EditGamePlayersInput) {
    return withGameTransaction(async (tx) => {
      const { requiresConfirmation } = await evaluateEdit(tx, input);
      return { requiresConfirmation };
    });
  },

  edit(input: EditGamePlayersInput) {
    return withGameTransaction(async (tx) => {
      const { game, requiresConfirmation } = await evaluateEdit(tx, input);
      if (requiresConfirmation && input.confirmImpact !== true) {
        throw new Error("This edit will change game results. Confirm the edit before saving.");
      }
      const saved = { ...game, lastActivityAt: Date.now() };
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
  const { game, rounds, view } = await loadEditor(tx, input.gameId);
  if (input.version !== view.version) {
    throw new Error("Game history changed. Close and reopen Edit game to load the saved values.");
  }
  if (view.automaticCompletion || view.pendingFinishChoice) {
    throw new Error("Resolve Finish Game before adding Players.");
  }
  assertSavedSeats(game.players, input.players);
  const addedIds = input.players.filter((id) => !game.players.includes(id));
  if (addedIds.length === 0) throw new Error("Add at least one new Player.");
  await requirePlayers(tx, addedIds);
  return {
    game: {
      ...game,
      players: [...input.players],
      activePlayers: input.players.filter(
        (id) => game.activePlayers.includes(id) || addedIds.includes(id),
      ),
      playerJoins: [
        ...(game.playerJoins ?? []),
        ...addedIds.map((playerId) => ({
          playerId,
          afterRoundNumber: view.nextRoundNumber - 1,
        })),
      ],
    },
    requiresConfirmation: rounds.length > 0,
  };
}
