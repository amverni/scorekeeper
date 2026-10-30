import type { Game } from "./game";
import type { PlayerIdentity } from "./player";
import type { Round } from "./round";

export interface StandingsInput<TPlayer extends PlayerIdentity = PlayerIdentity> {
  game: Game;
  players: readonly TPlayer[];
  rounds: readonly Round[];
}

export interface StandingsDerivation<TPlayer extends PlayerIdentity = PlayerIdentity> {
  includedPlayers: TPlayer[];
  rows: StandingsRow<TPlayer>[];
  phaseGraphSeries: PhaseGraphSeries[];
  tiebreakerGraphSeries: TiebreakerGraphSeries[];
  hasFinishedPlayers: boolean;
  gameWinner: StandingsRow<TPlayer> | null;
}

export interface StandingsRow<TPlayer extends PlayerIdentity = PlayerIdentity> {
  player: TPlayer;
  place: number | null;
  showPlace: boolean;
  progress: PlayerProgress;
  tiebreakerTotal: number;
  formattedTiebreaker: string;
}

export interface PlayerProgress {
  /** Next sequential Phase, or the default lowest Remaining Phase for selectable play. */
  currentPhase: number;
  isFinished: boolean;
  standingValue: number;
  selectable?: { resolvedPhases: number[]; totalPhases: number };
}

export interface PhaseGraphSeries {
  player: PlayerIdentity;
  points: PhaseGraphPoint[];
}

export interface PhaseGraphPoint extends PlayerProgress {
  roundNumber: number;
}

export interface TiebreakerGraphSeries {
  player: PlayerIdentity;
  points: TiebreakerGraphPoint[];
}

export interface TiebreakerGraphPoint {
  roundNumber: number;
  value: number;
  standingValue: number;
}
