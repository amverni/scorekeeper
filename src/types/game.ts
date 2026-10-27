import type { ActiveGameMetadata, CompletedGameMetadata } from "./gameLifecycle";
import type { GenericGame } from "./genericGame";
import type { TemporaryPhaseSet } from "./phaseSet";
import type { PlayerId } from "./player";

export type PhaseGame = ActiveGame | CompletedGame;
export type Game = PhaseGame;
export type StoredGame = PhaseGame | GenericGame;
export type { GameId } from "./gameLifecycle";

export type GameTiebreaker =
  | "lowestPoints"
  | "highestPoints"
  | "fewestSkips"
  | "mostSkipped"
  | "fewestWilds"
  | "roundsWon";

export interface GameSettings {
  tiebreaker: GameTiebreaker;
  roundSkipPenalty: number; // Default 100. Points added when player takes a Round Skip.
  sitOutPenalty: number; // Default 0. Points added when player Sits Out.
}

export interface ActiveGame extends ActiveGameMetadata<"phase10">, PhaseGameFields {
  activePlayers: PlayerId[]; // Players actively playing, allows players to be added/removed mid-game
  /** Reopening is not an interrupted first-finisher choice; the next save restores normal policy. */
  deferFinishChoiceUntilSave?: true;
}

export interface CompletedGame extends CompletedGameMetadata<"phase10">, PhaseGameFields {}

interface PhaseGameFields {
  scorekeeper: "phase10";
  phaseSet: TemporaryPhaseSet;
  settings: GameSettings;
  continuation?: boolean;
  playerJoins?: Array<{ playerId: PlayerId; afterRoundNumber: number }>;
  playerMembershipChanges?: Array<{
    playerId: PlayerId;
    afterRoundNumber: number;
    type: "withdrawal" | "rejoin";
  }>;
}

export type CreateGameInput = Pick<ActiveGame, "players" | "phaseSet" | "settings">;
