import type { AddGenericRoundInput, GameId, GenericRound } from "../../types";
import { parseGenericPoints } from "../../utils/genericPoints";
import { getDB } from "../db";
import { requirePlayers, withGameTransaction } from "./gameLifecycle";
import { genericRoundEdits } from "./genericRoundEdits";
import {
  assertGenericGame,
  deriveGenericScoreboard,
  genericRoundPlayerIds,
  orderGenericScores,
} from "./genericScoring";

export const genericRoundsApi = {
  ...genericRoundEdits,
  async add(input: AddGenericRoundInput): Promise<GenericRound> {
    const gameId = input.gameId;
    if (
      input.mode !== "points" &&
      input.mode !== "singleRoundWinner" &&
      input.mode !== "passFail"
    ) {
      throw new Error("Unsupported Round Scoring Mode.");
    }
    if (!Array.isArray(input.scores)) {
      throw new Error("A Round must include every Player exactly once.");
    }
    const draft =
      input.mode === "passFail"
        ? {
            mode: "passFail" as const,
            scores: input.scores.map(({ playerId, passed }) => {
              if (typeof passed !== "boolean") {
                throw new Error("Round contains an invalid Pass/Fail outcome.");
              }
              return { playerId, passed };
            }),
          }
        : input.mode === "singleRoundWinner"
          ? {
              mode: input.mode,
              scores: input.scores.map(({ playerId, won }) => ({ playerId, won })),
            }
          : {
              mode: "points" as const,
              scores: input.scores.map(({ playerId, points, tiebreaker }) => ({
                playerId,
                points: parseGenericPoints(points),
                tiebreaker,
              })),
            };
    return await withGameTransaction(async (tx) => {
      const games = tx.objectStore("games");
      const game = await games.get(gameId);
      if (!game || game.scorekeeper !== "generic") throw new Error("Generic Game not found");
      if (game.status !== "active") throw new Error("Cannot add a Round to a Completed Game");
      assertGenericGame(game);
      if (draft.mode !== game.settings.mode) {
        throw new Error("Round mode must match the Game settings.");
      }
      const players = await requirePlayers(tx, game.players);
      const rounds = tx.objectStore("rounds");
      const existing = await rounds.index("by-game").getAll(gameId);
      const metadata = {
        id: crypto.randomUUID(),
        revision: 0,
        gameId,
        scorekeeper: "generic" as const,
        roundNumber: existing.reduce((latest, saved) => Math.max(latest, saved.roundNumber), 0) + 1,
      };
      const eligible = genericRoundPlayerIds(game, metadata.roundNumber);
      const round: GenericRound =
        draft.mode === "passFail"
          ? {
              ...metadata,
              mode: "passFail",
              scores: orderGenericScores(eligible, draft.scores),
            }
          : draft.mode === "singleRoundWinner"
            ? {
                ...metadata,
                mode: "singleRoundWinner",
                scores: orderGenericScores(eligible, draft.scores),
              }
            : {
                ...metadata,
                mode: "points",
                scores: orderGenericScores(
                  eligible,
                  draft.scores.map(({ playerId, points, tiebreaker }) =>
                    game.settings.mode === "points" && game.settings.tiebreaker
                      ? {
                          playerId,
                          points,
                          tiebreaker: parseGenericPoints(tiebreaker ?? "", "Tiebreaker"),
                        }
                      : { playerId, points },
                  ),
                ),
              };
      deriveGenericScoreboard(game, players, [...existing, round]);
      await rounds.add(round);
      await games.put({ ...game, lastActivityAt: Date.now() });
      return round;
    });
  },

  async getByGameId(gameId: GameId): Promise<GenericRound[]> {
    const db = await getDB();
    const tx = db.transaction(["games", "rounds"]);
    const game = await tx.objectStore("games").get(gameId);
    if (game?.scorekeeper !== "generic") return [];
    const rounds = await tx.objectStore("rounds").index("by-game").getAll(gameId);
    await tx.done;
    return rounds
      .filter((round) => round.scorekeeper === "generic")
      .sort((a, b) => a.roundNumber - b.roundNumber);
  },

  async hasRounds(gameId: GameId): Promise<boolean> {
    return (await this.getByGameId(gameId)).length > 0;
  },
};
