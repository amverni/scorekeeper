import type {
  EditGenericRoundInput,
  GameId,
  GenericRoundEditor,
  GenericRoundId,
} from "../../types";
import { parseGenericPoints } from "../../utils/genericPoints";
import {
  type GameLifecycleTransaction,
  requirePlayers,
  withGameTransaction,
} from "./gameLifecycle";
import { assertGenericGame, deriveGenericScoreboard, orderGenericScores } from "./genericScoring";

export const genericRoundEdits = {
  getEditor(gameId: GameId, roundId: GenericRoundId): Promise<GenericRoundEditor> {
    return withGameTransaction(async (tx) => {
      const { game, players, round, version } = await loadEditor(tx, gameId, roundId);
      const metadata = {
        version,
        players: players.map(({ id, name, color }) => ({ id, name, color })),
      };
      if (round.mode === "points") {
        return {
          ...metadata,
          mode: round.mode,
          round,
          tiebreakerEnabled: game.settings.tiebreaker !== null,
        };
      }
      if (round.mode === "passFail") return { ...metadata, mode: round.mode, round };
      const winnerId = round.scores.find((score) => score.won)?.playerId;
      if (!winnerId) throw new Error("A Single Round Winner Round requires exactly one winner.");
      return { ...metadata, mode: round.mode, round, tiebreakerEnabled: false, winnerId };
    });
  },

  async previewEdit(input: EditGenericRoundInput) {
    const draft = parseEdit(input);
    return await withGameTransaction(async (tx) => {
      const { requiresConfirmation } = await evaluateEdit(tx, draft);
      return { requiresConfirmation };
    });
  },

  async edit(input: EditGenericRoundInput) {
    const draft = parseEdit(input);
    return await withGameTransaction(async (tx) => {
      const { game, round, requiresConfirmation } = await evaluateEdit(tx, draft);
      if (requiresConfirmation && draft.confirmImpact !== true) {
        throw new Error("This edit will change game results. Confirm the edit before saving.");
      }
      await tx.objectStore("rounds").put(round);
      await tx.objectStore("games").put({
        ...game,
        lastActivityAt: Date.now(),
      });
      return round;
    });
  },
};

function parseEdit(input: EditGenericRoundInput) {
  if (input.mode !== "points" && input.mode !== "singleRoundWinner" && input.mode !== "passFail") {
    throw new Error("Unsupported Round Scoring Mode.");
  }
  if (!Array.isArray(input.scores)) {
    throw new Error("A Round must include every Player exactly once.");
  }
  const metadata = {
    gameId: input.gameId,
    roundId: input.roundId,
    version: input.version,
    confirmImpact: input.confirmImpact,
  };
  if (input.mode === "passFail") {
    return {
      ...metadata,
      mode: input.mode,
      scores: input.scores.map((score) => {
        if (!score || typeof score.passed !== "boolean") {
          throw new Error("Round contains an invalid Pass/Fail outcome.");
        }
        return { playerId: score.playerId, passed: score.passed };
      }),
    };
  }
  return input.mode === "singleRoundWinner"
    ? {
        ...metadata,
        mode: input.mode,
        scores: input.scores.map(({ playerId, won }) => ({ playerId, won })),
      }
    : {
        ...metadata,
        mode: input.mode,
        scores: input.scores.map(({ playerId, points, tiebreaker }) => ({
          playerId,
          points: parseGenericPoints(points),
          tiebreaker,
        })),
      };
}

async function loadEditor(tx: GameLifecycleTransaction, gameId: GameId, roundId: GenericRoundId) {
  const game = await tx.objectStore("games").get(gameId);
  if (!game || game.scorekeeper !== "generic") throw new Error("Generic Game not found.");
  if (game.status !== "active") throw new Error("Cannot edit a Completed Game.");
  assertGenericGame(game);
  const rounds = await tx.objectStore("rounds").index("by-game").getAll(gameId);
  const round = rounds.find((saved) => saved.scorekeeper === "generic" && saved.id === roundId);
  if (
    !round ||
    round.scorekeeper !== "generic" ||
    typeof round.id !== "string" ||
    round.id.length === 0 ||
    !Number.isSafeInteger(round.revision) ||
    round.revision === undefined ||
    round.revision < 0
  ) {
    throw new Error("Round cannot be edited. Legacy or missing Round history is read-only.");
  }
  const players = await requirePlayers(tx, game.players);
  const editable: GenericRoundEditor["round"] = {
    ...round,
    id: round.id,
    revision: round.revision,
  };
  const scoreboard = deriveGenericScoreboard(game, players, rounds);
  return {
    game,
    players,
    rounds,
    round: editable,
    scoreboard,
    version: JSON.stringify([game, rounds]),
  };
}

async function evaluateEdit(tx: GameLifecycleTransaction, draft: ReturnType<typeof parseEdit>) {
  const {
    game,
    players,
    rounds,
    round: saved,
    version,
    scoreboard: before,
  } = await loadEditor(tx, draft.gameId, draft.roundId);
  if (draft.version !== version) {
    throw new Error("Game history changed. Close and reopen Edit Round to load the saved values.");
  }
  if (draft.mode !== game.settings.mode || draft.mode !== saved.mode) {
    throw new Error("Round mode must match the Game settings.");
  }
  const metadata = { ...saved, revision: saved.revision + 1 };
  const round: GenericRoundEditor["round"] =
    draft.mode === "passFail"
      ? {
          ...metadata,
          mode: "passFail",
          scores: orderGenericScores(game.players, draft.scores),
        }
      : draft.mode === "singleRoundWinner"
        ? {
            ...metadata,
            mode: draft.mode,
            scores: orderGenericScores(game.players, draft.scores),
          }
        : {
            ...metadata,
            mode: "points",
            scores: orderGenericScores(
              game.players,
              draft.scores.map(({ playerId, points, tiebreaker }) =>
                game.settings.tiebreaker
                  ? {
                      playerId,
                      points,
                      tiebreaker: parseGenericPoints(tiebreaker ?? "", "Tiebreaker"),
                    }
                  : { playerId, points },
              ),
            ),
          };
  const after = deriveGenericScoreboard(
    game,
    players,
    rounds.map((existing) =>
      existing.scorekeeper === "generic" && existing.id === saved.id ? round : existing,
    ),
  );
  const places = new Map(before.standings.map(({ player, place }) => [player.id, place]));
  const winnerChanged =
    saved.mode === "singleRoundWinner" &&
    round.mode === "singleRoundWinner" &&
    saved.scores.find((score) => score.won)?.playerId !==
      round.scores.find((score) => score.won)?.playerId;
  return {
    game,
    round,
    requiresConfirmation:
      winnerChanged || after.standings.some(({ player, place }) => places.get(player.id) !== place),
  };
}
