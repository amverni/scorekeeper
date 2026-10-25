import type { Game, GameId } from "./game";
import type { RoundMetadata } from "./gameLifecycle";
import type { GenericRound } from "./genericRound";
import type { PlayerId, PlayerIdentity } from "./player";
import type { ArrayAtLeastOne } from "./utils";

export type Round = PhaseRound;
export type StoredRound = PhaseRound | GenericRound;
export type PhaseRoundId = string;

export interface PhaseRound extends RoundMetadata {
  scorekeeper: "phase10";
  id?: PhaseRoundId;
  revision?: number;
  scores: ArrayAtLeastOne<RoundScore>;
  roundWinnerId: PlayerId | null;
}

export interface PhaseRoundEditor {
  game: Game;
  round: Round & { id: PhaseRoundId };
  players: PlayerIdentity[];
  countedPlayerIds: PlayerId[];
  version: string;
}

export interface DeletePhaseRoundInput {
  gameId: GameId;
  roundId: PhaseRoundId;
  version: string;
}

export interface EditPhaseRoundInput {
  gameId: GameId;
  roundNumber: number;
  version: string;
  scores: Omit<RoundScore, "currentPhase">[];
  roundWinnerId: PlayerId | null;
  confirmImpact?: boolean;
}

export type PhaseStatus = "failed" | "completed" | "skipped" | "satOut";

export interface PointsCardBreakdown {
  p5: number;
  p10: number;
  skipCard: number;
  wild: number;
}

export interface RoundScore {
  playerId: PlayerId;
  score: number;
  phaseStatus: PhaseStatus;
  currentPhase: number;
  /** Remaining cards for a Points entry; absent for penalties, Count Tiebreakers and legacy data. */
  pointsCardBreakdown?: PointsCardBreakdown;
}
