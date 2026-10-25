import type {
  DeletePhaseRoundInput,
  EditPhaseRoundInput,
  GameId,
  GameReadModel,
  PhaseRoundEditor,
  Round,
  RoundScore,
} from "../../types";
import { getRoundWinnerRequirement, isPointsTiebreaker } from "../../utils";
import {
  finalizeGame,
  type GameLifecycleTransaction,
  requirePlayers,
  withGameTransaction,
} from "./gameLifecycle";
import { deriveGameReadModel } from "./gameReadModel";
import { assertActivePhaseGame, assertPhaseRounds } from "./games";
import { resolveGameCompletion } from "./roundCompletion";
import { assertPointsCardBreakdown, validateScore } from "./rounds";

export const phaseRoundEdits = {
  delete(input: DeletePhaseRoundInput) {
    return withGameTransaction(async (tx) => {
      const { game, players, rounds, view } = await loadHistory(tx, input.gameId);
      if (input.version !== view.version) {
        throw new Error(
          "Game history changed. Close and reopen Edit Round to load the saved values.",
        );
      }
      if (typeof input.roundId !== "string" || input.roundId.length === 0) {
        throw new Error("Round not found.");
      }
      const selected = rounds.find((round) => round.id === input.roundId);
      if (!selected) throw new Error("Round not found.");
      const remaining = rounds
        .filter((round) => round.id !== selected.id)
        .sort((a, b) => a.roundNumber - b.roundNumber)
        .map((round, index) => ({ ...round, roundNumber: index + 1 }));
      const now = Date.now();
      const activeGame = { ...game, lastActivityAt: now };
      const completion = resolveGameCompletion({
        game: activeGame,
        players,
        rounds: remaining,
        completedAt: now,
      });
      const store = tx.objectStore("rounds");
      for (const round of rounds) await store.delete([game.id, round.roundNumber]);
      for (const round of remaining) await store.add(round);
      if (completion) {
        await finalizeGame(tx, completion.completedGame);
        return { outcome: "gameCompleted" as const, ...completion };
      }
      await tx.objectStore("games").put(activeGame);
      return { outcome: "roundDeleted" as const };
    });
  },

  getEditor(gameId: GameId, roundNumber: number): Promise<PhaseRoundEditor> {
    return withGameTransaction(async (tx) => {
      const { game, round, players, view, roundView } = await loadEditor(tx, gameId, roundNumber);
      return {
        game,
        round,
        players: players.filter((player) =>
          round.scores.some((score) => score.playerId === player.id),
        ),
        countedPlayerIds: roundView.scores
          .filter((entry) => entry.counted)
          .map((entry) => entry.playerId),
        version: view.version,
      };
    });
  },

  preview(input: EditPhaseRoundInput) {
    return withGameTransaction(async (tx) => {
      const { requiresConfirmation } = await evaluateEdit(tx, input);
      return { requiresConfirmation };
    });
  },

  edit(input: EditPhaseRoundInput) {
    return withGameTransaction(async (tx) => {
      const { game, round, players, rounds, requiresConfirmation } = await evaluateEdit(tx, input);
      if (requiresConfirmation && input.confirmImpact !== true) {
        throw new Error("This edit will change game results. Confirm the edit before saving.");
      }
      const now = Date.now();
      const activeGame = { ...game, lastActivityAt: now };
      const completion = resolveGameCompletion({
        game: activeGame,
        players,
        rounds,
        completedAt: now,
      });
      await tx.objectStore("rounds").put(round);
      if (completion) {
        await finalizeGame(tx, completion.completedGame);
        return { outcome: "gameCompleted" as const, round, ...completion };
      }
      await tx.objectStore("games").put(activeGame);
      return { outcome: "roundEdited" as const, round };
    });
  },
};

async function loadHistory(tx: GameLifecycleTransaction, gameId: GameId) {
  const game = await tx.objectStore("games").get(gameId);
  assertActivePhaseGame(game);
  const players = await requirePlayers(tx, game.players);
  const rounds = await tx.objectStore("rounds").index("by-game").getAll(gameId);
  assertPhaseRounds(rounds);
  const view = deriveGameReadModel({ game, players, rounds });
  return { game, players, rounds, view };
}

async function loadEditor(tx: GameLifecycleTransaction, gameId: GameId, roundNumber: number) {
  const { game, players, rounds, view } = await loadHistory(tx, gameId);
  const round = rounds.find((saved) => saved.roundNumber === roundNumber);
  if (!round) throw new Error("Round not found.");
  if (
    typeof round.id !== "string" ||
    round.id.length === 0 ||
    round.roundWinnerId === undefined ||
    (isPointsTiebreaker(game.settings.tiebreaker) &&
      round.scores.some(
        (score) =>
          (score.phaseStatus === "completed" || score.phaseStatus === "failed") &&
          score.pointsCardBreakdown === undefined,
      ))
  ) {
    throw new Error("Legacy Round is read-only: original Round values are unavailable.");
  }
  const roundView = view.rounds.find((entry) => entry.source.roundNumber === roundNumber);
  if (!roundView) throw new Error("Round interpretation is unavailable.");
  return { game, players, rounds, round: { ...round, id: round.id }, view, roundView };
}

async function evaluateEdit(tx: GameLifecycleTransaction, input: EditPhaseRoundInput) {
  const {
    game,
    players,
    rounds,
    round: saved,
    view,
  } = await loadEditor(tx, input.gameId, input.roundNumber);
  if (input.version !== view.version) {
    throw new Error("Game history changed. Close and reopen Edit Round to load the saved values.");
  }
  if (
    !Array.isArray(input.scores) ||
    input.scores.length !== saved.scores.length ||
    new Set(input.scores.map((score) => score.playerId)).size !== saved.scores.length
  ) {
    throw new Error("Provide exactly one entry for every recorded Player in this Round.");
  }
  const scores = saved.scores.map((previous): RoundScore => {
    const score = input.scores.find((entry) => entry.playerId === previous.playerId);
    if (!score) throw new Error("Round entries must match the recorded Players.");
    validateScore(score);
    assertPointsCardBreakdown(score, game.settings.tiebreaker, input.roundWinnerId);
    if (score.phaseStatus === "skipped" || score.phaseStatus === "satOut") {
      const expected = isPointsTiebreaker(game.settings.tiebreaker)
        ? score.phaseStatus === "skipped"
          ? game.settings.roundSkipPenalty
          : game.settings.sitOutPenalty
        : 0;
      if (score.score !== expected)
        throw new Error("Round Skip and Sit Out must use the Game's configured penalty.");
    }
    if (
      isPointsTiebreaker(game.settings.tiebreaker) &&
      (score.phaseStatus === "completed" || score.phaseStatus === "failed") &&
      score.pointsCardBreakdown === undefined
    ) {
      throw new Error("Points entries require their original card counts.");
    }
    return {
      playerId: score.playerId,
      phaseStatus: score.phaseStatus,
      score: score.score,
      currentPhase: previous.currentPhase,
      ...(score.pointsCardBreakdown !== undefined
        ? { pointsCardBreakdown: score.pointsCardBreakdown }
        : {}),
    };
  });
  const [first, ...rest] = scores;
  if (!first) throw new Error("A Round needs at least one recorded entry.");
  const round: Round = {
    ...saved,
    revision: (saved.revision ?? 0) + 1,
    scores: [first, ...rest],
    roundWinnerId: input.roundWinnerId,
  };
  const updatedRounds = rounds.map((existing) =>
    existing.roundNumber === round.roundNumber ? round : existing,
  );
  const after = deriveGameReadModel({ game, players, rounds: updatedRounds });
  const interpreted = after.rounds.find((entry) => entry.source.roundNumber === round.roundNumber);
  if (!interpreted) throw new Error("Round not found.");
  const winner = interpreted.scores.find((entry) => entry.playerId === input.roundWinnerId);
  if (input.roundWinnerId !== null) {
    const retainedWinner =
      input.roundWinnerId === saved.roundWinnerId && winner?.source?.phaseStatus === "completed";
    if (
      !winner ||
      winner.source?.phaseStatus !== "completed" ||
      (!winner.counted && !retainedWinner)
    ) {
      throw new Error("Round Winner must be a Passed Player whose entry counts.");
    }
  } else if (
    interpreted.counted &&
    getRoundWinnerRequirement(
      game.settings.tiebreaker,
      interpreted.scores
        .filter((entry) => entry.counted)
        .map((entry) => entry.source?.phaseStatus ?? null),
    ) === "required"
  ) {
    throw new Error("A Round Winner is required.");
  }
  return {
    game,
    players,
    rounds: updatedRounds,
    round,
    requiresConfirmation: consequences(view) !== consequences(after),
  };
}

function consequences(view: GameReadModel) {
  return JSON.stringify({
    ending: view.gameEndingRound,
    automatic: view.automaticCompletion,
    choice: view.pendingFinishChoice?.winner.id,
    players: view.players.map((player) => [
      player.id,
      player.progress.currentPhase,
      player.finishingRound,
      player.place,
    ]),
    rounds: view.rounds.map((round) => [
      round.counted,
      round.scores.find((score) => score.playerId === round.source.roundWinnerId && score.counted)
        ?.playerId,
      round.scores.map((score) => [
        score.playerId,
        score.counted,
        score.counted ? score.phaseNumber : null,
      ]),
    ]),
  });
}
