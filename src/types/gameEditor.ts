import type { ActiveGame } from "./game";
import type { GameId } from "./gameLifecycle";
import type { ActiveGenericGame } from "./genericGame";
import type { Phase } from "./phase";
import type { Player, PlayerId, PlayerIdentity } from "./player";

export interface PhaseGameEditor {
  game: ActiveGame;
  players: Player[];
  phases: Phase[];
  version: string;
  withdrawnPlayers: PlayerId[];
  finishedPlayers: PlayerId[];
}

export interface EditGamePlayersInput {
  gameId: GameId;
  version: string;
  players: PlayerId[];
  withdrawnPlayers?: PlayerId[];
  confirmImpact?: boolean;
  approval?: {
    token: string;
    finishChoice?: "continue" | "finish";
  };
}

export interface PhaseGameEditEffect {
  type: "join" | "withdrawal" | "rejoin";
  players: PlayerIdentity[];
  afterRoundNumber: number;
}

export type PhaseGameEditCompletion =
  | { type: "none" }
  | {
      type: "choice" | "automatic";
      winner: PlayerIdentity;
      gameEndingRound: number;
    };

export interface PhaseGameEditPreview {
  token: string;
  requiresConfirmation: boolean;
  effects: PhaseGameEditEffect[];
  completion: PhaseGameEditCompletion;
}

export interface GenericGameEditor {
  game: ActiveGenericGame;
  players: Player[];
  withdrawnPlayers: PlayerId[];
  version: string;
}
