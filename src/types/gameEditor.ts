import type { ActiveGame, GamePhaseOccurrence } from "./game";
import type { GameId } from "./gameLifecycle";
import type { ActiveGenericGame } from "./genericGame";
import type { Phase } from "./phase";
import type { Player, PlayerId, PlayerIdentity } from "./player";

export interface PhaseGameEditor {
  game: ActiveGame;
  players: Player[];
  phases: Array<Phase & { occurrenceId: GamePhaseOccurrence["id"]; removed?: true }>;
  version: string;
  withdrawnPlayers: PlayerId[];
  finishedPlayers: PlayerId[];
  canEditPhases: boolean;
}

export interface PhaseRemovalOption {
  occurrenceId: GamePhaseOccurrence["id"];
  phaseNumber: number;
  retainSlot: boolean;
  reason: string | null;
}

export interface EditGamePlayersInput {
  gameId: GameId;
  version: string;
  players: PlayerId[];
  withdrawnPlayers?: PlayerId[];
  phaseOccurrences?: GamePhaseOccurrence[];
  confirmImpact?: boolean;
  approval?: {
    token: string;
    finishChoice?: "continue" | "finish";
  };
}

export type PhaseGameEditEffect =
  | {
      type: "join" | "withdrawal" | "rejoin";
      players: PlayerIdentity[];
      afterRoundNumber: number;
    }
  | {
      type: "phaseRemoval";
      phaseNumbers: number[];
      resolvedPhaseNumbers: number[];
      players: PlayerIdentity[];
    }
  | { type: "finished"; players: PlayerIdentity[] };

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
