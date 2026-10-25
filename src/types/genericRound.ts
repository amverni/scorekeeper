import type { GameId, RoundMetadata } from "./gameLifecycle";
import type { PlayerId, PlayerIdentity } from "./player";
import type { ArrayAtLeastOne } from "./utils";

export type GenericRoundId = string;

interface GenericRoundMetadata extends RoundMetadata {
  id?: GenericRoundId;
  revision?: number;
}

export interface GenericPointsScore {
  playerId: PlayerId;
  points: number;
  tiebreaker?: number;
}

export interface GenericPassFailScore {
  playerId: PlayerId;
  passed: boolean;
}

export interface GenericPointsRound extends GenericRoundMetadata {
  scorekeeper: "generic";
  mode: "points";
  scores: ArrayAtLeastOne<GenericPointsScore>;
}

export interface GenericPassFailRound extends GenericRoundMetadata {
  scorekeeper: "generic";
  mode: "passFail";
  scores: ArrayAtLeastOne<GenericPassFailScore>;
}

export interface GenericWinnerScore {
  playerId: PlayerId;
  won: boolean;
}

export interface GenericSingleRoundWinnerRound extends GenericRoundMetadata {
  scorekeeper: "generic";
  mode: "singleRoundWinner";
  scores: ArrayAtLeastOne<GenericWinnerScore>;
}

export type GenericRound =
  | GenericPointsRound
  | GenericSingleRoundWinnerRound
  | GenericPassFailRound;

export interface AddGenericPointsRoundInput {
  gameId: GameId;
  mode: "points";
  scores: { playerId: PlayerId; points: string; tiebreaker?: string }[];
}

export interface AddGenericPassFailRoundInput {
  gameId: GameId;
  mode: "passFail";
  scores: GenericPassFailScore[];
}

export interface AddGenericWinnerRoundInput {
  gameId: GameId;
  mode: "singleRoundWinner";
  scores: GenericWinnerScore[];
}

export type AddGenericRoundInput =
  | AddGenericPointsRoundInput
  | AddGenericWinnerRoundInput
  | AddGenericPassFailRoundInput;

export interface GenericPointsRoundEditor {
  mode: "points";
  round: GenericPointsRound & { id: GenericRoundId; revision: number };
  players: PlayerIdentity[];
  tiebreakerEnabled: boolean;
  version: string;
}

export interface GenericPassFailRoundEditor {
  mode: "passFail";
  round: GenericPassFailRound & { id: GenericRoundId; revision: number };
  players: PlayerIdentity[];
  version: string;
}

export type GenericRoundEditor = GenericPointsRoundEditor | GenericPassFailRoundEditor;

export interface EditGenericPointsRoundInput extends AddGenericPointsRoundInput {
  roundId: GenericRoundId;
  version: string;
  confirmImpact?: boolean;
}

export interface EditGenericPassFailRoundInput extends AddGenericPassFailRoundInput {
  roundId: GenericRoundId;
  version: string;
  confirmImpact?: boolean;
}

export type EditGenericRoundInput = EditGenericPointsRoundInput | EditGenericPassFailRoundInput;
