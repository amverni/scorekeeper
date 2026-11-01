import type { FirstDealerSelection, PlayerId } from "../../types";

export function resolveFirstDealer(
  players: readonly PlayerId[],
  selection: FirstDealerSelection = { type: "random" },
  enabled = true,
): PlayerId | null {
  if (
    !selection ||
    (selection.type !== "random" && selection.type !== "player") ||
    (selection.type === "player" && !players.includes(selection.playerId))
  ) {
    throw new Error("First Dealer must be Random or a selected Player.");
  }
  if (!enabled) return null;
  if (selection.type === "player") return selection.playerId;
  if (players.length === 0) throw new Error("First Dealer requires a selected Player.");
  return players[Math.floor(Math.random() * players.length)];
}
