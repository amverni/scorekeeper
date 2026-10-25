import type { ActiveGame } from "./game";
import type { ActiveGenericGame } from "./genericGame";
import type { Phase } from "./phase";
import type { Player, PlayerIdentity } from "./player";

export interface PhaseGameEditor {
  game: ActiveGame;
  players: PlayerIdentity[];
  phases: Phase[];
}

export interface GenericGameEditor {
  game: ActiveGenericGame;
  players: Player[];
  version: string;
}
