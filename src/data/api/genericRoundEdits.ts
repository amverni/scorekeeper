import type {
  EditGenericPointsRoundInput,
  GameId,
  GenericPointsRoundEditor,
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
  getEditor(gameId: GameId, roundId: GenericRoundId): Promise<GenericPointsRoundEditor> {
    return withGameTransaction(async (tx) => {
      const { game, players, round, version } = await loadEditor(tx, gameId, roundId);
      return {
        round,
        version,
        players: players.map(({ id, name, color }) => ({ id, name, color })),
        tiebreakerEnabled: game.settings.tiebreaker !== null,
      };
    });
  },

  async previewEdit(input: EditGenericPointsRoundInput) {
    const draft = parseEdit(input);
    return await withGameTransaction(async (tx) => {
      const { requiresConfirmation } = await evaluateEdit(tx, draft);
      return { requiresConfirmation };
    });
  },

  async edit(input: EditGenericPointsRoundInput) {
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

function parseEdit(input: EditGenericPointsRoundInput) {
  if (input.mode !== "points") throw new Error("Only Points Rounds can be edited.");
  if (!Array.isArray(input.scores)) {
    throw new Error("A Round must include every Player exactly once.");
  }
  return {
    gameId: input.gameId,
    roundId: input.roundId,
    version: input.version,
    confirmImpact: input.confirmImpact,
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
  if (game.settings.mode !== "points") throw new Error("Only Points Rounds can be edited.");
  const rounds = await tx.objectStore("rounds").index("by-game").getAll(gameId);
  const round = rounds.find((saved) => saved.scorekeeper === "generic" && saved.id === roundId);
  if (
    !round ||
    round.scorekeeper !== "generic" ||
    round.mode !== "points" ||
    typeof round.id !== "string" ||
    round.id.length === 0 ||
    !Number.isSafeInteger(round.revision) ||
    round.revision === undefined ||
    round.revision < 0
  ) {
    throw new Error("Round cannot be edited. Legacy or missing Round history is read-only.");
  }
  const players = await requirePlayers(tx, game.players);
  const editable: GenericPointsRoundEditor["round"] = {
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
  const round: GenericPointsRoundEditor["round"] = {
    ...saved,
    revision: saved.revision + 1,
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
  return {
    game,
    round,
    requiresConfirmation: after.standings.some(
      ({ player, place }) => places.get(player.id) !== place,
    ),
  };
}
