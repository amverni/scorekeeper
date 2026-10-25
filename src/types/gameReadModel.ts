import type { Game } from "./game";
import type { PlayerId, PlayerIdentity } from "./player";
import type { Round, RoundScore } from "./round";
import type { PlayerProgress, StandingsDerivation } from "./standings";

export interface GameReadModel {
  game: Game;
  version: string;
  players: GamePlayerView[];
  rounds: GameRoundView[];
  nextRoundNumber: number;
  upcomingDealerId: PlayerId | null;
  standings: StandingsDerivation;
  tiebreakerGraphPlayerOrder: PlayerId[];
  pendingFinishChoice: { winner: PlayerIdentity; token: string } | null;
  gameEndingRound: number | null;
  automaticCompletion: boolean;
  playingPlayers: GamePlayerView[];
}

export interface GamePlayerView extends PlayerIdentity {
  progress: PlayerProgress;
  tiebreakerTotal: number;
  formattedTiebreaker: string;
  finishingRound: number | null;
  finishingPlace: number | null;
  place: number;
}

export interface GameRoundView {
  source: Round;
  dealerId: PlayerId | null;
  scores: GameRoundScoreView[];
  counted: boolean;
}

export interface GameRoundScoreView {
  playerId: PlayerId;
  source: RoundScore | undefined;
  phaseNumber: number | null;
  tiebreakerValue: number;
  runningTiebreakerTotal: number;
  counted: boolean;
  sourceTiebreakerValue: number;
}
