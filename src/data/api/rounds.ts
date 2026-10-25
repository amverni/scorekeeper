import type {
  ArrayAtLeastOne,
  CompletedGame,
  GameId,
  GameTiebreaker,
  PlayerId,
  PlayerIdentity,
  Round,
  RoundScore,
} from "../../types";
import {
  getPointsCardCount,
  getPointsCardCountRule,
  getPointsCardScore,
  getRoundWinnerRequirement,
  isPointsTiebreaker,
} from "../../utils";
import { getDB } from "../db";
import { finalizeGame, requirePlayers, withGameTransaction } from "./gameLifecycle";
import { deriveGameReadModel } from "./gameReadModel";
import { assertActivePhaseGame, assertPhaseRounds } from "./games";
import { resolveGameCompletion } from "./roundCompletion";

type AddRoundScoreInput = Omit<RoundScore, "currentPhase">;

export interface AddRoundAddedResult {
  outcome: "roundAdded";
  round: Round;
}

export interface AddRoundCompletedResult {
  outcome: "gameCompleted";
  round: Round;
  completedGame: CompletedGame;
  gameWinner: PlayerIdentity;
}

export type AddRoundResult = AddRoundAddedResult | AddRoundCompletedResult;

function assertPointsCardBreakdown(
  score: AddRoundScoreInput,
  tiebreaker: GameTiebreaker,
  roundWinnerId: PlayerId | null,
): void {
  const cards = score.pointsCardBreakdown;
  if (cards === undefined) return;
  if (
    !isPointsTiebreaker(tiebreaker) ||
    (score.phaseStatus !== "failed" && score.phaseStatus !== "completed")
  ) {
    throw new Error("Points Card Breakdown is only valid for Passed or Failed Points entries");
  }
  if (
    !cards ||
    [cards.p5, cards.p10, cards.skipCard, cards.wild].some(
      (count) => !Number.isSafeInteger(count) || count < 0,
    )
  ) {
    throw new Error("Points Card Breakdown needs non-negative whole card counts");
  }
  const rule = getPointsCardCountRule(score.phaseStatus, score.playerId === roundWinnerId);
  const cardCount = getPointsCardCount(cards);
  if (rule && (cardCount < rule.minCards || cardCount > rule.maxCards)) {
    throw new Error(rule.reason);
  }
  if (score.score !== getPointsCardScore(cards)) {
    throw new Error("Points must match cards.");
  }
}

export const roundsApi = {
  /**
   * Get all rounds for a given game, sorted by round number ascending.
   *
   * @param gameId - The unique identifier of the game.
   * @returns An array of rounds belonging to the game.
   */
  async getByGameId(gameId: GameId): Promise<Round[]> {
    const db = await getDB();
    const tx = db.transaction(["games", "rounds"]);
    const game = await tx.objectStore("games").get(gameId);
    if (game?.scorekeeper !== "phase10") return [];
    const rounds = await tx.objectStore("rounds").index("by-game").getAll(gameId);
    await tx.done;
    return rounds
      .filter((round) => round.scorekeeper === "phase10")
      .sort((a, b) => a.roundNumber - b.roundNumber);
  },

  async hasRounds(gameId: GameId): Promise<boolean> {
    return (await this.getByGameId(gameId)).length > 0;
  },

  /**
   * Add a new round to a game.
   *
   * The round number is automatically assigned as the next sequential number.
   * Each player's `currentPhase` is automatically computed based on their
   * phase status in the previous round — callers do not provide it.
   *
   * @param data - The round data. Scores should omit `currentPhase` (it is computed).
   *   `roundWinnerId` explicitly identifies the player who went out, or is null.
   *   Rounds Won requires a winner unless every Active Player Skips or Sits Out.
   * @returns The newly created round and completion details when this round finishes the game.
   * @throws {Error} If the game does not exist.
   */
  add(data: {
    gameId: GameId;
    expectedRoundNumber?: number;
    scores: ArrayAtLeastOne<AddRoundScoreInput>;
    roundWinnerId: PlayerId | null;
    expectedVersion?: string;
  }): Promise<AddRoundResult> {
    return withGameTransaction(async (tx) => {
      const gamesStore = tx.objectStore("games");
      const roundsStore = tx.objectStore("rounds");

      const game = await gamesStore.get(data.gameId);
      assertActivePhaseGame(game);
      const winnerScores = data.scores.filter((score) => score.playerId === data.roundWinnerId);
      if (
        data.roundWinnerId !== null &&
        (!game.activePlayers.includes(data.roundWinnerId) ||
          winnerScores.length !== 1 ||
          winnerScores[0].phaseStatus !== "completed")
      ) {
        throw new Error("Round Winner must be a Passed Active Player in the Round");
      }
      for (const score of data.scores) {
        assertPointsCardBreakdown(score, game.settings.tiebreaker, data.roundWinnerId);
      }
      const players = await requirePlayers(tx, game.players);
      const existingRounds = await roundsStore.index("by-game").getAll(data.gameId);
      assertPhaseRounds(existingRounds);
      const view = deriveGameReadModel({ game, players, rounds: existingRounds });
      if (data.expectedVersion !== undefined && data.expectedVersion !== view.version) {
        throw new Error(
          "Game history changed. Close and reopen Add Round to review the saved history and your draft.",
        );
      }
      if (view.pendingFinishChoice) {
        throw new Error("Choose Keep playing or Finish in Finish Game before adding a Round");
      }
      const winnerRequirement = getRoundWinnerRequirement(
        game.settings.tiebreaker,
        view.playingPlayers.map(
          (player) =>
            data.scores.find((score) => score.playerId === player.id)?.phaseStatus ?? null,
        ),
      );
      if (data.roundWinnerId === null && winnerRequirement === "required") {
        throw new Error("A Round Winner is required");
      }
      if (
        data.roundWinnerId !== null &&
        (!view.playingPlayers.some((player) => player.id === data.roundWinnerId) ||
          winnerRequirement === "disabled")
      ) {
        throw new Error("Round Winner must be a Passed Active Player in the Round");
      }
      const now = Date.now();

      if (
        data.scores.length === 0 ||
        data.scores.length !== view.playingPlayers.length ||
        new Set(data.scores.map((score) => score.playerId)).size !== data.scores.length ||
        view.playingPlayers.some(
          (player) => !data.scores.some((score) => score.playerId === player.id),
        )
      ) {
        throw new Error("Provide exactly one Round entry for every Player still playing");
      }
      for (const score of data.scores) {
        validateScore(score);
      }
      const nextRoundNumber = view.nextRoundNumber;
      if (data.expectedRoundNumber !== undefined && data.expectedRoundNumber !== nextRoundNumber) {
        throw new Error("Round history changed. Reload before saving.");
      }

      const scores = data.scores.map((input) => {
        const player = view.players.find((player) => player.id === input.playerId);
        if (!player || player.progress.isFinished) {
          throw new Error("Round entries must belong to Players still playing");
        }
        return {
          ...input,
          currentPhase: player.progress.currentPhase,
        };
        // Input guarantees at least one score; .map() preserves length but TS can't infer tuple minimum
      }) as ArrayAtLeastOne<RoundScore>;

      const round: Round = {
        scorekeeper: "phase10",
        gameId: data.gameId,
        roundNumber: nextRoundNumber,
        scores,
        roundWinnerId: data.roundWinnerId,
      };

      const activeGameWithActivity = { ...game, lastActivityAt: now };
      const completion = resolveGameCompletion({
        game: activeGameWithActivity,
        players,
        rounds: [...existingRounds, round],
        completedAt: now,
      });

      await roundsStore.add(round);
      if (completion) {
        await finalizeGame(tx, completion.completedGame);
      } else {
        await gamesStore.put(activeGameWithActivity);
      }

      if (completion) {
        return {
          outcome: "gameCompleted",
          round,
          completedGame: completion.completedGame,
          gameWinner: completion.gameWinner,
        };
      }

      return {
        outcome: "roundAdded",
        round,
      };
    });
  },

  /**
   * Edit a single player's score entry within an existing round.
   *
   * Finds the `RoundScore` matching the given `playerId` and merges the
   * provided updates into it. The `currentPhase` field cannot be edited
   * directly — it is recomputed automatically.
   *
   * If `phaseStatus` is changed, `currentPhase` is cascade-updated for
   * that player in all subsequent rounds of the same game.
   *
   * @param gameId - The unique identifier of the game.
   * @param roundNumber - The round number to edit.
   * @param playerId - The player whose score entry should be updated.
   * @param updates - A partial `RoundScore` with the fields to change (excluding `playerId` and `currentPhase`).
   * @returns The full updated round.
   * @throws {Error} If the round does not exist.
   * @throws {Error} If the game does not exist.
   * @throws {Error} If the player is not found in the round's scores.
   */
  edit(
    gameId: GameId,
    roundNumber: number,
    playerId: PlayerId,
    updates: Partial<Omit<RoundScore, "playerId" | "currentPhase">>,
  ): Promise<Round> {
    return withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(gameId);
      assertActivePhaseGame(game);
      const roundsStore = tx.objectStore("rounds");
      const round = await roundsStore.get([gameId, roundNumber]);
      if (!round) throw new Error("Round not found");
      if (round.scorekeeper !== "phase10") throw new Error("Round belongs to another Scorekeeper");

      const scoreIndex = round.scores.findIndex((s) => s.playerId === playerId);
      if (scoreIndex === -1) throw new Error("Player not found in round");

      // Spread preserves minimum length of original; TS can't infer tuple minimum from spread
      const updatedScores = [...round.scores] as ArrayAtLeastOne<RoundScore>;
      updatedScores[scoreIndex] = { ...updatedScores[scoreIndex], ...updates };
      validateScore(updatedScores[scoreIndex]);
      assertPointsCardBreakdown(
        updatedScores[scoreIndex],
        game.settings.tiebreaker,
        round.roundWinnerId,
      );

      const updatedRound: Round = { ...round, scores: updatedScores };
      let savedRound = updatedRound;
      const players = await requirePlayers(tx, game.players);
      const allRounds = await roundsStore.index("by-game").getAll(gameId);
      assertPhaseRounds(allRounds);
      const rounds = allRounds.map((r) => (r.roundNumber === roundNumber ? updatedRound : r));
      const view = deriveGameReadModel({ game, players, rounds });
      for (const interpreted of view.rounds) {
        const source = interpreted.source;
        const scores = source.scores.map((score) => {
          const entry = interpreted.scores.find((entry) => entry.playerId === score.playerId);
          return entry?.counted && entry.phaseNumber !== null
            ? { ...score, currentPhase: entry.phaseNumber }
            : score;
        }) as ArrayAtLeastOne<RoundScore>;
        if (
          source.roundNumber === roundNumber ||
          scores.some((score, index) => score.currentPhase !== source.scores[index].currentPhase)
        ) {
          const normalized = { ...source, scores };
          await roundsStore.put(normalized);
          if (source.roundNumber === roundNumber) savedRound = normalized;
        }
      }
      const now = Date.now();
      const completion = resolveGameCompletion({ game, players, rounds, completedAt: now });
      if (completion) await finalizeGame(tx, completion.completedGame);
      else await tx.objectStore("games").put({ ...game, lastActivityAt: now });
      return savedRound;
    });
  },

  /**
   * Delete a single round by its composite key.
   *
   * No error is thrown if the round does not exist.
   *
   * @param gameId - The unique identifier of the game.
   * @param roundNumber - The round number to delete.
   */
  async delete(gameId: GameId, roundNumber: number): Promise<void> {
    await withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(gameId);
      assertActivePhaseGame(game);
      const store = tx.objectStore("rounds");
      const rounds = await store.index("by-game").getAll(gameId);
      assertPhaseRounds(rounds);
      const round = rounds.find((candidate) => candidate.roundNumber === roundNumber);
      if (!round) return;

      const latestRoundNumber = Math.max(...rounds.map((candidate) => candidate.roundNumber));
      if (roundNumber !== latestRoundNumber) {
        throw new Error("Only the latest round can be deleted");
      }

      await store.delete([gameId, roundNumber]);
    });
  },

  /**
   * Delete all rounds belonging to a game.
   *
   * @param gameId - The unique identifier of the game whose rounds should be deleted.
   */
  async deleteByGameId(gameId: GameId): Promise<void> {
    await withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(gameId);
      assertActivePhaseGame(game);
      const store = tx.objectStore("rounds");
      const rounds = await store.index("by-game").getAll(gameId);
      assertPhaseRounds(rounds);
      await Promise.all(rounds.map((r) => store.delete([r.gameId, r.roundNumber])));
    });
  },
};

function validateScore(score: AddRoundScoreInput) {
  if (!["completed", "failed", "skipped", "satOut"].includes(score.phaseStatus)) {
    throw new Error("Invalid Round Result");
  }
  if (!Number.isSafeInteger(score.score) || score.score < 0) {
    throw new Error("Round score must be a nonnegative whole number");
  }
}
