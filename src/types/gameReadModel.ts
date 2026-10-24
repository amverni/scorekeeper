import type { Game } from "./game";
import type { PlayerId, PlayerIdentity } from "./player";
import type { Round, RoundScore } from "./round";
import type { PlayerProgress, StandingsDerivation } from "./standings";

export interface GameReadModel {
  game: Game;
  players: GamePlayerView[];
  rounds: GameRoundView[];
  nextRoundNumber: number;
  upcomingDealerId: PlayerId | null;
  standings: StandingsDerivation;
  tiebreakerGraphPlayerOrder: PlayerId[];
}

export interface GamePlayerView extends PlayerIdentity {
  progress: PlayerProgress;
  tiebreakerTotal: number;
  formattedTiebreaker: string;
}

export interface GameRoundView {
  source: Round;
  dealerId: PlayerId | null;
  scores: GameRoundScoreView[];
}

export interface GameRoundScoreView {
  playerId: PlayerId;
  source: RoundScore | undefined;
  tiebreakerValue: number;
  runningTiebreakerTotal: number;
}
