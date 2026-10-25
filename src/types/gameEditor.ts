import type { ActiveGame } from "./game";
import type { GameId } from "./gameLifecycle";
import type { ActiveGenericGame } from "./genericGame";
import type { Phase } from "./phase";
import type { Player, PlayerId } from "./player";

export interface PhaseGameEditor {
  game: ActiveGame;
  players: Player[];
  phases: Phase[];
  version: string;
}

export interface EditGamePlayersInput {
  gameId: GameId;
  version: string;
  players: PlayerId[];
  confirmImpact?: boolean;
}

export interface GenericGameEditor {
  game: ActiveGenericGame;
  players: Player[];
  version: string;
}
