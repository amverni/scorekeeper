import type { RoundMetadata } from "./gameLifecycle";
import type { GenericRound } from "./genericRound";
import type { PlayerId } from "./player";
import type { ArrayAtLeastOne } from "./utils";

export type Round = PhaseRound;
export type StoredRound = PhaseRound | GenericRound;

export interface PhaseRound extends RoundMetadata {
  scorekeeper: "phase10";
  scores: ArrayAtLeastOne<RoundScore>;
  roundWinnerId: PlayerId | null;
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
