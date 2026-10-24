import type { ActiveGameMetadata, CompletedGameMetadata } from "./gameLifecycle";
import type { GenericRoundId } from "./genericRound";
import type { PlayerId, PlayerIdentity } from "./player";

export type GenericScoringMode = "points" | "singleRoundWinner" | "passFail";
export type GenericScoreDirection = "high" | "low";

export interface GenericTiebreakerSettings {
  direction: GenericScoreDirection;
}

export interface GenericScoringSettings {
  mode: GenericScoringMode;
  tiebreaker: GenericTiebreakerSettings | null;
  dealer: boolean;
}

export interface GenericPointsSettings extends GenericScoringSettings {
  mode: "points";
  pointsDirection: GenericScoreDirection;
  tiebreaker: GenericTiebreakerSettings | null;
}

export interface GenericPassFailSettings extends GenericScoringSettings {
  mode: "passFail";
  tiebreaker: null;
}

export interface GenericSingleRoundWinnerSettings extends GenericScoringSettings {
  mode: "singleRoundWinner";
  tiebreaker: null;
}

export type GenericGameSettings =
  | GenericPointsSettings
  | GenericSingleRoundWinnerSettings
  | GenericPassFailSettings;

interface GenericGameFields {
  scorekeeper: "generic";
  name?: string;
  settings: GenericGameSettings;
}

export interface ActiveGenericGame extends ActiveGameMetadata<"generic">, GenericGameFields {}

export interface CompletedGenericGame extends CompletedGameMetadata<"generic">, GenericGameFields {
  completionType: "manual";
}

export type GenericGame = ActiveGenericGame | CompletedGenericGame;

export interface CreateGenericGameInput {
  name?: string;
  players: PlayerId[];
  settings: GenericGameSettings;
}

export interface GenericGameView {
  game: GenericGame;
  players: PlayerIdentity[];
}

export type GenericScoreTotal =
  | { totalPoints: number; totalTiebreaker?: number }
  | { totalWins: number }
  | { totalPasses: number };

export interface GenericGraphPoint {
  roundNumber: number;
  value: number;
}

export interface GenericGraphSeries {
  player: PlayerIdentity;
  points: GenericGraphPoint[];
}

export interface GenericGraph {
  metric: "Points" | "Rounds Won" | "Passes" | "Tiebreaker";
  direction: GenericScoreDirection;
  series: GenericGraphSeries[];
}

export interface GenericScoreboardView {
  game: GenericGame;
  primaryGraph: GenericGraph;
  tiebreakerGraph: GenericGraph | null;
  upcomingDealerId: PlayerId | null;
  players: Array<PlayerIdentity & GenericScoreTotal>;
  rounds: Array<{
    roundNumber: number;
    id?: GenericRoundId;
    dealerId: PlayerId | null;
    scores: Array<
      | {
          playerId: PlayerId;
          points: number;
          totalPoints: number;
          tiebreaker?: number;
          totalTiebreaker?: number;
        }
      | { playerId: PlayerId; won: boolean; totalWins: number }
      | { playerId: PlayerId; passed: boolean; totalPasses: number }
    >;
  }>;
  standings: Array<{ player: PlayerIdentity; place: number } & GenericScoreTotal>;
}
