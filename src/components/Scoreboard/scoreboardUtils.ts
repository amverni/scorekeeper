import type { GameTiebreaker, PlayerId, Round } from "../../types";
import { formatTiebreakerValue, getRoundTiebreakerValue } from "../../utils";

export { getDealerId } from "../../utils";

/**
 * Per-round tiebreaker contribution for one player, using the shared
 * tiebreaker rules so Scoreboard and Standings stay consistent.
 */
export function getTiebreakerValue(
  round: Round,
  playerId: PlayerId,
  tiebreaker: GameTiebreaker,
): number {
  const score = round.scores.find((s) => s.playerId === playerId);
  return getRoundTiebreakerValue(round, playerId, tiebreaker, score);
}

/** Format a tiebreaker value with units. E.g. `(43, "lowestPoints") -> "43 pts"`. */
export function formatTiebreaker(value: number, tiebreaker: GameTiebreaker): string {
  return formatTiebreakerValue(value, tiebreaker);
}
