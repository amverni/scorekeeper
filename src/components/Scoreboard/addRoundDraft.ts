import type {
  ArrayAtLeastOne,
  GameSettings,
  GameTiebreaker,
  PhaseStatus,
  PlayerId,
  PlayerIdentity,
  PointsCardBreakdown,
  RoundScore,
} from "../../types";
import {
  getPointsCardCount,
  getPointsCardCountRule,
  getPointsCardScore,
  getRoundWinnerRequirement,
  isPointsTiebreaker,
  POINTS_CARD_VALUES,
  type PointsCardCountRule,
} from "../../utils";

type ManualResult = Extract<PhaseStatus, "failed" | "completed">;

export type PointsQuickButtonId = keyof PointsCardBreakdown;

export type QuickCounts = PointsCardBreakdown;

const ZERO_QUICK_COUNTS: QuickCounts = { p5: 0, p10: 0, skipCard: 0, wild: 0 };

interface PointsEntrySnapshot {
  score: number;
  lastManualScore: number;
  quickCounts: QuickCounts;
}

export interface ScoreEntryCompletion {
  complete: boolean;
  reason?: string;
}

/** Per-player draft state. `result === null` means the user hasn't picked yet — submission blocked. */
export interface PlayerDraft {
  playerId: PlayerId;
  result: PhaseStatus | null;
  /** Polymorphic numeric value (semantics depend on tiebreaker — see addRound.md). */
  score: number;
  /** Snapshot of the score the user last manually set while result was failed|completed. Used to restore when toggling away from skipped/satOut. */
  lastManualScore: number;
  /** Press counts per quick-add button (points-based tiebreaker only). */
  quickCounts: QuickCounts;
  /** Snapshot of the quick counts last set while result was failed|completed. */
  lastManualQuickCounts: QuickCounts;
  /** Points/card-count entry to restore after this player stops being the Round Winner. */
  pointsEntryBeforeWinner: PointsEntrySnapshot | null;
  /** Whether the Round Result secondary row (Skipped / Sat Out) is currently expanded for this player. */
  expandedSecondary: boolean;
}

export interface AddRoundDraft {
  players: PlayerDraft[];
  roundWinnerId: PlayerId | null;
}

type CompleteAddRoundDraft = AddRoundDraft & {
  players: Array<PlayerDraft & { result: PhaseStatus }>;
};

type PenaltySettings = Pick<GameSettings, "roundSkipPenalty" | "sitOutPenalty">;
type ResultSettings = PenaltySettings & Pick<GameSettings, "tiebreaker">;

const FAILED_POINTS_DEFAULT_SCORE = 50;
const FAILED_POINTS_DEFAULT_QUICK_COUNTS: QuickCounts = {
  ...ZERO_QUICK_COUNTS,
  p5: FAILED_POINTS_DEFAULT_SCORE / POINTS_CARD_VALUES.p5,
};
const POINTS_MAX = 250;
const POINTS_STEP = 5;
const allowedPointScoresCache = new Map<string, number[]>();

function isManualResult(result: PhaseStatus | null): result is ManualResult {
  return result === "failed" || result === "completed";
}

function getPointsPenaltyScore(result: PhaseStatus, settings: PenaltySettings): number | null {
  if (result === "skipped") {
    return settings.roundSkipPenalty;
  }

  if (result === "satOut") {
    return settings.sitOutPenalty;
  }

  return null;
}

function isBetterQuickCounts(candidate: QuickCounts, current: QuickCounts): boolean {
  const candidateSpecials = candidate.skipCard + candidate.wild;
  const currentSpecials = current.skipCard + current.wild;
  if (candidateSpecials !== currentSpecials) {
    return candidateSpecials < currentSpecials;
  }

  if (candidate.wild !== current.wild) {
    return candidate.wild < current.wild;
  }

  return candidate.p5 > current.p5;
}

function findQuickCountsForPoints(score: number, rule: PointsCardCountRule): QuickCounts | null {
  let best: QuickCounts | null = null;

  for (let p5 = 0; p5 <= rule.maxCards; p5 += 1) {
    for (let p10 = 0; p10 <= rule.maxCards - p5; p10 += 1) {
      for (let skipCard = 0; skipCard <= rule.maxCards - p5 - p10; skipCard += 1) {
        for (let wild = 0; wild <= rule.maxCards - p5 - p10 - skipCard; wild += 1) {
          const quickCounts = { p5, p10, skipCard, wild };
          const cardCount = getPointsCardCount(quickCounts);
          if (cardCount < rule.minCards || cardCount > rule.maxCards) {
            continue;
          }

          if (getPointsCardScore(quickCounts) !== score) {
            continue;
          }

          if (best === null || isBetterQuickCounts(quickCounts, best)) {
            best = quickCounts;
          }
        }
      }
    }
  }

  return best;
}

export function getAllowedPointScoresForResult(
  result: PhaseStatus | null,
  isRoundWinner: boolean,
): number[] {
  const cacheKey = `${result ?? "none"}:${isRoundWinner}`;
  const cached = allowedPointScoresCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const rule = getPointsCardCountRule(result, isRoundWinner);
  if (!rule) {
    return [];
  }

  const scores: number[] = [];
  for (let score = 0; score <= POINTS_MAX; score += POINTS_STEP) {
    if (findQuickCountsForPoints(score, rule)) {
      scores.push(score);
    }
  }
  allowedPointScoresCache.set(cacheKey, scores);
  return scores;
}

function applyQuickCountsIncrement(
  quickCounts: QuickCounts,
  button: PointsQuickButtonId,
  maxCards: number | null,
): QuickCounts {
  if (maxCards === null || getPointsCardCount(quickCounts) < maxCards) {
    return { ...quickCounts, [button]: quickCounts[button] + 1 };
  }

  if (button === "p5" || quickCounts.p5 === 0) {
    return quickCounts;
  }

  return {
    ...quickCounts,
    p5: quickCounts.p5 - 1,
    [button]: quickCounts[button] + 1,
  };
}

function applyQuickCountsDecrement(
  quickCounts: QuickCounts,
  button: PointsQuickButtonId,
): QuickCounts {
  if (quickCounts[button] === 0) {
    return quickCounts;
  }

  return { ...quickCounts, [button]: quickCounts[button] - 1 };
}

export function isPointsQuickIncrementNoop({
  result,
  quickCounts,
  button,
  isRoundWinner,
}: {
  result: PhaseStatus | null;
  quickCounts: QuickCounts;
  button: PointsQuickButtonId;
  isRoundWinner: boolean;
}): boolean {
  if (!isManualResult(result) || isRoundWinner) {
    return true;
  }

  const rule = getPointsCardCountRule(result, false);
  return applyQuickCountsIncrement(quickCounts, button, rule?.maxCards ?? null) === quickCounts;
}

function getQuickResetEntry(
  result: PhaseStatus | null,
  isRoundWinner: boolean,
): PointsEntrySnapshot | null {
  if (isRoundWinner || result === "completed") {
    return {
      score: 0,
      lastManualScore: 0,
      quickCounts: { ...ZERO_QUICK_COUNTS },
    };
  }

  if (result === "failed") {
    return {
      score: FAILED_POINTS_DEFAULT_SCORE,
      lastManualScore: FAILED_POINTS_DEFAULT_SCORE,
      quickCounts: { ...FAILED_POINTS_DEFAULT_QUICK_COUNTS },
    };
  }

  return null;
}

export function isPointsQuickResetNoop({
  result,
  quickCounts,
  isRoundWinner,
}: {
  result: PhaseStatus | null;
  quickCounts: QuickCounts;
  isRoundWinner: boolean;
}): boolean {
  const resetEntry = getQuickResetEntry(result, isRoundWinner);
  if (!resetEntry) {
    return true;
  }

  return (
    quickCounts.p5 === resetEntry.quickCounts.p5 &&
    quickCounts.p10 === resetEntry.quickCounts.p10 &&
    quickCounts.skipCard === resetEntry.quickCounts.skipCard &&
    quickCounts.wild === resetEntry.quickCounts.wild
  );
}

function findNearestAllowedPointScore(score: number, allowedScores: number[]): number {
  return allowedScores.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(score - nearest);
    const candidateDistance = Math.abs(score - candidate);
    if (candidateDistance !== nearestDistance) {
      return candidateDistance < nearestDistance ? candidate : nearest;
    }

    return candidate < nearest ? candidate : nearest;
  }, allowedScores[0] ?? 0);
}

function resolvePointsScoreEntry(
  score: number,
  result: PhaseStatus | null,
  isRoundWinner: boolean,
): PointsEntrySnapshot | null {
  const rule = getPointsCardCountRule(result, isRoundWinner);
  if (!rule) {
    return null;
  }

  const allowedScores = getAllowedPointScoresForResult(result, isRoundWinner);
  const resolvedScore = findNearestAllowedPointScore(score, allowedScores);
  const quickCounts = findQuickCountsForPoints(resolvedScore, rule) ?? { ...ZERO_QUICK_COUNTS };

  return {
    score: resolvedScore,
    lastManualScore: resolvedScore,
    quickCounts,
  };
}

function hasNoPointsEntry(player: PlayerDraft): boolean {
  return (
    player.score === 0 &&
    player.lastManualScore === 0 &&
    player.quickCounts.p5 === 0 &&
    player.quickCounts.p10 === 0 &&
    player.quickCounts.skipCard === 0 &&
    player.quickCounts.wild === 0
  );
}

function createPointsEntrySnapshot(player: PlayerDraft): PointsEntrySnapshot {
  return {
    score: player.score,
    lastManualScore: player.lastManualScore,
    quickCounts: { ...player.quickCounts },
  };
}

function restorePointsEntry(player: PlayerDraft): PlayerDraft {
  if (!player.pointsEntryBeforeWinner) {
    return player;
  }

  return {
    ...player,
    score: player.pointsEntryBeforeWinner.score,
    lastManualScore: player.pointsEntryBeforeWinner.lastManualScore,
    quickCounts: { ...player.pointsEntryBeforeWinner.quickCounts },
    lastManualQuickCounts: { ...player.pointsEntryBeforeWinner.quickCounts },
    pointsEntryBeforeWinner: null,
  };
}

function getLastManualPointsEntry(player: PlayerDraft): PointsEntrySnapshot {
  if (isManualResult(player.result)) {
    return {
      score: player.score,
      lastManualScore: player.score,
      quickCounts: { ...player.quickCounts },
    };
  }

  return {
    score: player.lastManualScore,
    lastManualScore: player.lastManualScore,
    quickCounts: { ...player.lastManualQuickCounts },
  };
}

function restoreRoundWinnerPointsEntry(draft: AddRoundDraft): AddRoundDraft {
  if (!draft.roundWinnerId) {
    return draft;
  }

  return updatePlayer(draft, draft.roundWinnerId, restorePointsEntry);
}

function updatePlayer(
  draft: AddRoundDraft,
  playerId: PlayerId,
  update: (player: PlayerDraft) => PlayerDraft,
): AddRoundDraft {
  return {
    ...draft,
    players: draft.players.map((player) =>
      player.playerId === playerId ? update(player) : player,
    ),
  };
}

export function createInitialDraft(players: PlayerIdentity[]): AddRoundDraft {
  return {
    players: players.map((p) => ({
      playerId: p.id,
      result: null,
      score: 0,
      lastManualScore: 0,
      quickCounts: { ...ZERO_QUICK_COUNTS },
      lastManualQuickCounts: { ...ZERO_QUICK_COUNTS },
      pointsEntryBeforeWinner: null,
      expandedSecondary: false,
    })),
    roundWinnerId: null,
  };
}

/**
 * Update a player's Round Result.
 *
 * Behavior:
 * - Points tiebreakers preserve score/card counts for Pass, Skip, and Sat Out.
 *   Failed starts at 50 points (+5 card count 10) only when the player has no
 *   existing points entry yet.
 * - If new result is "skipped" → set score to settings.roundSkipPenalty.
 *   (Save current score as lastManualScore IFF the OLD result was "failed" or "completed".)
 * - If new result is "satOut" → set score to settings.sitOutPenalty.
 *   (Same snapshot rule.)
 * - If new result is "failed" or "completed" → restore score from lastManualScore.
 * - If new result is no longer "completed" AND the player is the current roundWinnerId →
 *   clear roundWinnerId (downgrade clears winner).
 */
export function applyResult(
  draft: AddRoundDraft,
  playerId: PlayerId,
  result: PhaseStatus,
  settings: ResultSettings,
): AddRoundDraft {
  const wasRoundWinner = draft.roundWinnerId === playerId;
  const updated = updatePlayer(draft, playerId, (player) => {
    if (isPointsTiebreaker(settings.tiebreaker)) {
      const restoredPlayer =
        wasRoundWinner && result !== "completed" ? restorePointsEntry(player) : player;
      const penaltyScore = getPointsPenaltyScore(result, settings);
      if (penaltyScore !== null) {
        const lastManualEntry = getLastManualPointsEntry(restoredPlayer);
        return {
          ...restoredPlayer,
          result,
          score: penaltyScore,
          lastManualScore: lastManualEntry.lastManualScore,
          quickCounts: { ...ZERO_QUICK_COUNTS },
          lastManualQuickCounts: { ...lastManualEntry.quickCounts },
        };
      }

      if (result === "failed" && hasNoPointsEntry(restoredPlayer)) {
        return {
          ...restoredPlayer,
          result,
          score: FAILED_POINTS_DEFAULT_SCORE,
          lastManualScore: FAILED_POINTS_DEFAULT_SCORE,
          quickCounts: { ...FAILED_POINTS_DEFAULT_QUICK_COUNTS },
          lastManualQuickCounts: { ...FAILED_POINTS_DEFAULT_QUICK_COUNTS },
        };
      }

      const lastManualEntry = getLastManualPointsEntry(restoredPlayer);

      return {
        ...restoredPlayer,
        result,
        score: lastManualEntry.score,
        lastManualScore: lastManualEntry.lastManualScore,
        quickCounts: { ...lastManualEntry.quickCounts },
        lastManualQuickCounts: { ...lastManualEntry.quickCounts },
      };
    }

    const lastManualScore = isManualResult(player.result) ? player.score : player.lastManualScore;
    const quickCounts = isManualResult(result) ? player.quickCounts : { ...ZERO_QUICK_COUNTS };

    if (result === "skipped") {
      return {
        ...player,
        result,
        score: 0,
        lastManualScore,
        quickCounts,
      };
    }

    if (result === "satOut") {
      return {
        ...player,
        result,
        score: 0,
        lastManualScore,
        quickCounts,
      };
    }

    return {
      ...player,
      result,
      score: player.lastManualScore,
      quickCounts,
    };
  });

  if (result !== "completed" && draft.roundWinnerId === playerId) {
    return {
      ...updated,
      roundWinnerId: null,
    };
  }

  return updated;
}

/**
 * Update a player's tiebreaker score (the polymorphic numeric value). Only writable when result ∈ {failed, completed}.
 * If result is skipped/satOut, this is a no-op (UI should be greyed). Always updates lastManualScore.
 */
export function applyScore(
  draft: AddRoundDraft,
  playerId: PlayerId,
  score: number,
  settings: Pick<GameSettings, "tiebreaker">,
): AddRoundDraft {
  return updatePlayer(draft, playerId, (player) => {
    if (!isManualResult(player.result)) {
      return player;
    }

    if (isPointsTiebreaker(settings.tiebreaker)) {
      const resolvedEntry = resolvePointsScoreEntry(
        score,
        player.result,
        draft.roundWinnerId === playerId,
      );
      if (!resolvedEntry) {
        return player;
      }

      return {
        ...player,
        ...resolvedEntry,
        lastManualQuickCounts: { ...resolvedEntry.quickCounts },
        pointsEntryBeforeWinner:
          draft.roundWinnerId === playerId ? player.pointsEntryBeforeWinner : null,
      };
    }

    return {
      ...player,
      score,
      lastManualScore: score,
      lastManualQuickCounts: { ...player.quickCounts },
      pointsEntryBeforeWinner: null,
    };
  });
}

/**
 * Increment a points-based quick-add button. Adds its delta to the wheel score and bumps the
 * per-button press count. Bound by `max`. No-op if the player's result is Skipped / Sat Out.
 */
export function applyQuickIncrement(
  draft: AddRoundDraft,
  playerId: PlayerId,
  button: PointsQuickButtonId,
  max: number,
): AddRoundDraft {
  return updatePlayer(draft, playerId, (player) => {
    if (!isManualResult(player.result) || draft.roundWinnerId === playerId) {
      return player;
    }
    const rule = getPointsCardCountRule(player.result, false);
    const quickCounts = applyQuickCountsIncrement(
      player.quickCounts,
      button,
      rule?.maxCards ?? null,
    );
    if (quickCounts === player.quickCounts) {
      return player;
    }
    const nextScore = Math.min(max, getPointsCardScore(quickCounts));
    return {
      ...player,
      score: nextScore,
      lastManualScore: nextScore,
      quickCounts,
      lastManualQuickCounts: { ...quickCounts },
      pointsEntryBeforeWinner: null,
    };
  });
}

/** Decrement a points-based quick-add button by one press count. No-op if unavailable. */
export function applyQuickDecrement(
  draft: AddRoundDraft,
  playerId: PlayerId,
  button: PointsQuickButtonId,
): AddRoundDraft {
  return updatePlayer(draft, playerId, (player) => {
    if (!isManualResult(player.result) || draft.roundWinnerId === playerId) {
      return player;
    }

    const quickCounts = applyQuickCountsDecrement(player.quickCounts, button);
    if (quickCounts === player.quickCounts) {
      return player;
    }

    const nextScore = getPointsCardScore(quickCounts);
    return {
      ...player,
      score: nextScore,
      lastManualScore: nextScore,
      quickCounts,
      lastManualQuickCounts: { ...quickCounts },
      pointsEntryBeforeWinner: null,
    };
  });
}

/** Reset a points-based quick-card entry to the default for the player's current status. */
export function applyQuickReset(draft: AddRoundDraft, playerId: PlayerId): AddRoundDraft {
  return updatePlayer(draft, playerId, (player) => {
    if (!isManualResult(player.result)) {
      return player;
    }

    const resetEntry = getQuickResetEntry(player.result, draft.roundWinnerId === playerId);
    if (!resetEntry) {
      return player;
    }

    return {
      ...player,
      ...resetEntry,
      lastManualQuickCounts: { ...resetEntry.quickCounts },
      pointsEntryBeforeWinner:
        draft.roundWinnerId === playerId ? player.pointsEntryBeforeWinner : null,
    };
  });
}

/** Toggle the Round Result secondary row's expanded state for a single player. */
export function applyExpandedSecondary(
  draft: AddRoundDraft,
  playerId: PlayerId,
  expanded: boolean,
): AddRoundDraft {
  return updatePlayer(draft, playerId, (player) => ({
    ...player,
    expandedSecondary: expanded,
  }));
}

/**
 * Set the Round Winner. If the target player's result is not "completed", auto-promote them
 * (set result to "completed" + restore lastManualScore) BEFORE recording the winner.
 */
export function applyRoundWinner(
  draft: AddRoundDraft,
  playerId: PlayerId,
  settings: ResultSettings,
): AddRoundDraft {
  if (draft.roundWinnerId === playerId) {
    return draft;
  }

  const restoredDraft = isPointsTiebreaker(settings.tiebreaker)
    ? restoreRoundWinnerPointsEntry(draft)
    : draft;
  const player = restoredDraft.players.find((candidate) => candidate.playerId === playerId);
  if (!player) {
    return draft;
  }

  if (isPointsTiebreaker(settings.tiebreaker)) {
    const winnerDraft = updatePlayer(restoredDraft, playerId, (candidate) => ({
      ...candidate,
      result: "completed",
      score: 0,
      lastManualScore: 0,
      quickCounts: { ...ZERO_QUICK_COUNTS },
      lastManualQuickCounts: { ...ZERO_QUICK_COUNTS },
      pointsEntryBeforeWinner:
        candidate.pointsEntryBeforeWinner ?? createPointsEntrySnapshot(candidate),
    }));

    return {
      ...winnerDraft,
      roundWinnerId: playerId,
    };
  }

  const autoPromoted = player.result !== "completed";
  const promotedDraft = autoPromoted
    ? applyResult(restoredDraft, playerId, "completed", settings)
    : restoredDraft;

  return {
    ...promotedDraft,
    roundWinnerId: playerId,
  };
}

export function applyClearRoundWinner(
  draft: AddRoundDraft,
  settings: Pick<GameSettings, "tiebreaker">,
): AddRoundDraft {
  if (!draft.roundWinnerId) {
    return draft;
  }

  const restoredDraft = isPointsTiebreaker(settings.tiebreaker)
    ? restoreRoundWinnerPointsEntry(draft)
    : draft;

  return {
    ...restoredDraft,
    roundWinnerId: null,
  };
}

export function getScoreEntryCompletion({
  player,
  tiebreaker,
  roundWinnerId,
}: {
  player: PlayerDraft;
  tiebreaker: GameTiebreaker;
  roundWinnerId: PlayerId | null;
}): ScoreEntryCompletion {
  if (player.result === null) {
    return { complete: false, reason: "Select a Round Result." };
  }

  if (!isPointsTiebreaker(tiebreaker)) {
    return { complete: true };
  }

  const rule = getPointsCardCountRule(player.result, roundWinnerId === player.playerId);
  if (!rule) {
    return { complete: true };
  }

  const cardCount = getPointsCardCount(player.quickCounts);
  if (cardCount < rule.minCards || cardCount > rule.maxCards) {
    return { complete: false, reason: rule.reason };
  }

  if (player.score !== getPointsCardScore(player.quickCounts)) {
    return { complete: false, reason: "Points must match cards." };
  }

  return { complete: true };
}

export function areScoreEntriesComplete(
  draft: AddRoundDraft,
  tiebreaker: GameTiebreaker,
): draft is CompleteAddRoundDraft {
  if (draft.players.length === 0) {
    return false;
  }

  return draft.players.every(
    (player) =>
      getScoreEntryCompletion({ player, tiebreaker, roundWinnerId: draft.roundWinnerId }).complete,
  );
}

export function getDraftProgress(draft: AddRoundDraft, tiebreaker: GameTiebreaker) {
  const winnerRequirement = getRoundWinnerRequirement(
    tiebreaker,
    draft.players.map((player) => player.result),
  );
  const winnerComplete = draft.players.some(
    (player) => player.playerId === draft.roundWinnerId && player.result === "completed",
  );
  const completedPlayers = draft.players.filter(
    (player) =>
      getScoreEntryCompletion({ player, tiebreaker, roundWinnerId: draft.roundWinnerId }).complete,
  ).length;
  const winnerRequired = winnerRequirement === "required";
  const completed = completedPlayers + (winnerRequired && winnerComplete ? 1 : 0);
  const total = draft.players.length + (winnerRequired ? 1 : 0);
  const validWinner = draft.roundWinnerId === null ? !winnerRequired : winnerComplete;

  return {
    winnerRequirement,
    winnerComplete,
    completed,
    total,
    ready: draft.players.length > 0 && completed === total && validWinner,
  };
}

/** Every Player is Score Entry Complete and the conditional winner rule is satisfied. */
export function isDraftComplete(
  draft: AddRoundDraft,
  tiebreaker: GameTiebreaker,
): draft is CompleteAddRoundDraft {
  return getDraftProgress(draft, tiebreaker).ready;
}

/**
 * Build the array of `Omit<RoundScore, "currentPhase">` for `roundsApi.add` from the draft.
 * Throws if !isDraftComplete(draft). The `score.score` field is the polymorphic value
 * (points / wilds / skip-card-count) chosen by the wheel; for tiebreaker = "roundsWon"
 * the value is ignored by the scoreboard reader but we still write it (preserves the polymorphic contract).
 *
 * NOTE: `currentPhase` is omitted because `roundsApi.add` computes it.
 */
export function toRoundScores(
  draft: AddRoundDraft,
  tiebreaker: GameTiebreaker,
): ArrayAtLeastOne<Omit<RoundScore, "currentPhase">> {
  if (!isDraftComplete(draft, tiebreaker)) {
    throw new Error("Cannot build round scores from an incomplete draft.");
  }

  return draft.players.map((player) => ({
    playerId: player.playerId,
    score: player.score,
    phaseStatus: player.result,
    ...(isPointsTiebreaker(tiebreaker) && isManualResult(player.result)
      ? { pointsCardBreakdown: { ...player.quickCounts } }
      : {}),
  })) as ArrayAtLeastOne<Omit<RoundScore, "currentPhase">>;
}
