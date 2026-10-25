import type { GameTiebreaker, PhaseStatus, PointsCardBreakdown } from "../types";

export const POINTS_CARD_VALUES: PointsCardBreakdown = {
  p5: 5,
  p10: 10,
  skipCard: 15,
  wild: 25,
};

export interface PointsCardCountRule {
  minCards: number;
  maxCards: number;
  reason: string;
}

export function isPointsTiebreaker(tiebreaker: GameTiebreaker): boolean {
  return tiebreaker === "lowestPoints" || tiebreaker === "highestPoints";
}

export function getPointsCardCountRule(
  result: PhaseStatus | null,
  isRoundWinner: boolean,
): PointsCardCountRule | null {
  if (isRoundWinner) {
    return { minCards: 0, maxCards: 0, reason: "Winner needs 0 cards." };
  }
  if (result === "failed") {
    return { minCards: 10, maxCards: 10, reason: "Needs 10 cards." };
  }
  if (result === "completed") {
    return { minCards: 0, maxCards: 9, reason: "Needs 9 or fewer cards." };
  }
  return null;
}

export function getPointsCardScore(cards: PointsCardBreakdown): number {
  return (
    cards.p5 * POINTS_CARD_VALUES.p5 +
    cards.p10 * POINTS_CARD_VALUES.p10 +
    cards.skipCard * POINTS_CARD_VALUES.skipCard +
    cards.wild * POINTS_CARD_VALUES.wild
  );
}

export function getPointsCardCount(cards: PointsCardBreakdown): number {
  return cards.p5 + cards.p10 + cards.skipCard + cards.wild;
}
