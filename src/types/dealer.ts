import type { PlayerId } from "./player";

export type FirstDealerSelection = { type: "random" } | { type: "player"; playerId: PlayerId };
