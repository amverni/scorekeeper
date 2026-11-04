import type { GameTiebreaker, PhaseStatus } from "../types";

export function getRoundWinnerRequirement(
  tiebreaker: GameTiebreaker,
  results: readonly (PhaseStatus | null)[],
  hasRemovedEntries = false,
): "required" | "optional" | "disabled" {
  if (
    results.length > 0 &&
    results.every((result) => result === "skipped" || result === "satOut")
  ) {
    return "disabled";
  }

  if (hasRemovedEntries && !results.includes("completed")) return "optional";

  return tiebreaker === "roundsWon" ? "required" : "optional";
}
