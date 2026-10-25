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

interface GenericRoundEditorMetadata {
  players: PlayerIdentity[];
  version: string;
}

export interface GenericPointsRoundEditor extends GenericRoundEditorMetadata {
  mode: "points";
  round: GenericPointsRound & { id: GenericRoundId; revision: number };
  tiebreakerEnabled: boolean;
}

export interface GenericWinnerRoundEditor extends GenericRoundEditorMetadata {
  mode: "singleRoundWinner";
  round: GenericSingleRoundWinnerRound & { id: GenericRoundId; revision: number };
  tiebreakerEnabled: false;
  winnerId: PlayerId;
}

export interface GenericPassFailRoundEditor extends GenericRoundEditorMetadata {
  mode: "passFail";
  round: GenericPassFailRound & { id: GenericRoundId; revision: number };
}

export type GenericRoundEditor =
  | GenericPointsRoundEditor
  | GenericWinnerRoundEditor
  | GenericPassFailRoundEditor;

export interface EditGenericPointsRoundInput extends AddGenericPointsRoundInput {
  roundId: GenericRoundId;
  version: string;
  confirmImpact?: boolean;
}

export interface EditGenericWinnerRoundInput extends AddGenericWinnerRoundInput {
  roundId: GenericRoundId;
  version: string;
  confirmImpact?: boolean;
}

export interface EditGenericPassFailRoundInput extends AddGenericPassFailRoundInput {
  roundId: GenericRoundId;
  version: string;
  confirmImpact?: boolean;
}

export type EditGenericRoundInput =
  | EditGenericPointsRoundInput
  | EditGenericWinnerRoundInput
  | EditGenericPassFailRoundInput;
