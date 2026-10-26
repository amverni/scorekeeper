import type { PlayerId } from "../../types";

export function assertJoinSeats(savedPlayers: PlayerId[], players: PlayerId[]): void {
  const savedIds = new Set(savedPlayers);
  if (
    !Array.isArray(players) ||
    players.length <= savedPlayers.length ||
    new Set(players).size !== players.length ||
    players.some((id) => typeof id !== "string" || id.length === 0) ||
    players.filter((id) => savedIds.has(id)).length !== savedPlayers.length ||
    players.filter((id) => savedIds.has(id)).some((id, index) => savedPlayers[index] !== id)
  ) {
    throw new Error(
      "Only new Players can be positioned. Preserve every saved Player's relative Seating Order.",
    );
  }
}
