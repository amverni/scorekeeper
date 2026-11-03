import type {
  ActiveGame,
  EditGamePlayersInput,
  GameId,
  GamePhaseOccurrence,
  PhaseGameEditCompletion,
  PhaseGameEditEffect,
  PhaseGameEditor,
  PhaseGameEditPreview,
} from "../../types";
import { builtInPhases } from "../constants/phases";
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
import { resolveEarlyGameCompletion, resolveGameCompletion } from "./roundCompletion";

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
    const phases = saved.game.phaseOccurrences.map(({ id, phaseId }) => {
      const phase = byId.get(phaseId);
      if (!phase) throw new Error(`Phase no longer exists: ${phaseId}`);
      return { ...phase, occurrenceId: id };
    });
    return {
      game: saved.game,
      players: saved.players,
      version: saved.view.version,
      canEditPhases: saved.rounds.length === 0,
      phases,
      withdrawnPlayers: saved.view.players
        .filter((player) => player.place === null)
        .map(({ id }) => id),
      finishedPlayers: saved.view.players
        .filter((player) => player.progress.isFinished)
        .map(({ id }) => id),
    };
  },

  preview(input: EditGamePlayersInput): Promise<PhaseGameEditPreview> {
    return withGameTransaction(async (tx) => {
      const { preview } = await evaluateEdit(tx, input);
      return preview;
    });
  },

  edit(input: EditGamePlayersInput) {
    return withGameTransaction(async (tx) => {
      const { game, players, rounds, preview } = await evaluateEdit(tx, input);
      if (preview.requiresConfirmation && !input.approval) {
        throw new Error("Confirm the reviewed Game changes before saving.");
      }
      if (input.approval && input.approval.token !== preview.token) {
        throw new Error("Game changes differ from the review. Review the intended changes again.");
      }
      const choice = input.approval?.finishChoice;
      if (preview.completion.type === "choice") {
        if (choice !== "continue" && choice !== "finish") {
          throw new Error("Choose Keep playing or Finish before saving Game changes.");
        }
      } else if (choice !== undefined) {
        throw new Error("This review does not require a Finish Game choice.");
      }
      const saved = {
        ...game,
        ...(choice === "continue" ? { continuation: true } : {}),
        lastActivityAt: Date.now(),
      };
      if (choice === "finish") {
        const completed = resolveEarlyGameCompletion({
          game: saved,
          players,
          rounds,
          completedAt: saved.lastActivityAt,
        });
        await finalizeGame(tx, completed);
        return completed;
      }
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
  assertSavedSeats(game.players, input.players);
  const phaseOccurrences =
    input.phaseOccurrences === undefined ? game.phaseOccurrences : input.phaseOccurrences;
  if (!Array.isArray(phaseOccurrences) || phaseOccurrences.length === 0) {
    throw new Error("At least one required Phase must remain.");
  }
  if (
    phaseOccurrences.some(
      (phase) =>
        !phase ||
        typeof phase.id !== "string" ||
        phase.id.trim().length === 0 ||
        typeof phase.phaseId !== "string" ||
        phase.phaseId.length === 0,
    ) ||
    new Set(phaseOccurrences.map(({ id }) => id)).size !== phaseOccurrences.length
  ) {
    throw new Error(
      "Each Game Phase must have a unique occurrence identity and a Phase definition.",
    );
  }
  const phasesChanged =
    phaseOccurrences.length !== game.phaseOccurrences.length ||
    phaseOccurrences.some(
      (phase, index) =>
        phase.id !== game.phaseOccurrences[index]?.id ||
        phase.phaseId !== game.phaseOccurrences[index]?.phaseId,
    );
  if (phasesChanged && rounds.length > 0) {
    throw new Error("Phases can only be edited before the first saved Round.");
  }
  if (phasesChanged) await assertPhaseDefinitions(tx, game.phaseOccurrences, phaseOccurrences);
  const [firstPhase, ...remainingPhases] = phaseOccurrences.map(({ phaseId }) => phaseId);
  if (!firstPhase) throw new Error("At least one required Phase must remain.");
  const addedIds = input.players.filter((id) => !game.players.includes(id));
  const afterRoundNumber = view.nextRoundNumber - 1;
  if (
    view.gameEndingRound !== null &&
    (addedIds.length > 0 ||
      !game.deferFinishChoiceUntilSave ||
      view.automaticCompletion ||
      view.gameEndingRound !== afterRoundNumber)
  ) {
    throw new Error("Resolve Finish Game before editing membership.");
  }
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
  const changes = game.players
    .filter((id) => savedWithdrawn.has(id) !== withdrawn.has(id))
    .map((playerId) => ({
      playerId,
      afterRoundNumber,
      type: withdrawn.has(playerId) ? ("withdrawal" as const) : ("rejoin" as const),
    }));
  if (addedIds.length === 0 && changes.length === 0 && !phasesChanged) {
    throw new Error("No Game membership or Phase changes to save.");
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
  const proposed: ActiveGame = {
    ...game,
    phaseOccurrences: phaseOccurrences.map(({ id, phaseId }) => ({ id, phaseId })),
    phaseSet: { ...game.phaseSet, phases: [firstPhase, ...remainingPhases] },
    deferFinishChoiceUntilSave: undefined,
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
  const intendedPlayers = [...players, ...addedPlayers];
  const projected = deriveGameReadModel({ game: proposed, players: intendedPlayers, rounds });
  const winner = projected.standings.gameWinner?.player;
  const completion: PhaseGameEditCompletion =
    winner && projected.gameEndingRound !== null
      ? {
          type: projected.automaticCompletion ? "automatic" : "choice",
          winner,
          gameEndingRound: projected.gameEndingRound,
        }
      : { type: "none" };
  const effects: PhaseGameEditEffect[] = [];
  for (const type of ["join", "withdrawal", "rejoin"] as const) {
    const affected = intendedPlayers.filter(({ id }) =>
      type === "join"
        ? addedIds.includes(id)
        : changes.some((change) => change.playerId === id && change.type === type),
    );
    if (affected.length > 0) effects.push({ type, players: affected, afterRoundNumber });
  }
  const preview: PhaseGameEditPreview = {
    token: JSON.stringify([view.version, proposed, intendedPlayers]),
    requiresConfirmation: rounds.length > 0,
    effects,
    completion,
  };
  return {
    game: proposed,
    players: intendedPlayers,
    rounds,
    preview,
  };
}

async function assertPhaseDefinitions(
  tx: GameLifecycleTransaction,
  saved: GamePhaseOccurrence[],
  intended: GamePhaseOccurrence[],
) {
  const savedById = new Map(saved.map((phase) => [phase.id, phase.phaseId]));
  for (const { id, phaseId } of intended) {
    if (savedById.has(id) && savedById.get(id) !== phaseId) {
      throw new Error("A Game Phase occurrence cannot change its objective.");
    }
  }
  for (const phaseId of new Set(intended.map((phase) => phase.phaseId))) {
    const phase =
      builtInPhases.find((phase) => phase.id === phaseId) ??
      (await tx.objectStore("customPhases").get(phaseId));
    if (!phase) throw new Error(`Phase no longer exists: ${phaseId}`);
  }
}
