import type { ActiveGame, PhaseGraphSeries, Player, Round } from "../../types";

export const phaseGraphPlayers = {
  amy: makePhaseGraphPlayer("amy", "Amy", "Jam", 0),
  bob: makePhaseGraphPlayer("bob", "Bob", "Santorini", 1),
  cam: makePhaseGraphPlayer("cam", "Cam", "Spearmint", 2),
};

export function makePhaseGraphGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  const game = {
    id: "game-1",
    scorekeeper: "phase10",
    status: "active",
    firstDealerId: overrides.players?.[0] ?? phaseGraphPlayers.amy.id,
    players: [phaseGraphPlayers.amy.id, phaseGraphPlayers.bob.id, phaseGraphPlayers.cam.id],
    activePlayers: [phaseGraphPlayers.amy.id, phaseGraphPlayers.bob.id, phaseGraphPlayers.cam.id],
    phaseSet: {
      id: "phase-set-1",
      name: "Test phases",
      phases: ["phase-1", "phase-2", "phase-3"],
      type: "temporary",
    },
    settings: {
      tiebreaker: "lowestPoints",
      roundSkipPenalty: 100,
      sitOutPenalty: 50,
    },
    createdAt: 0,
    lastActivityAt: 0,
    ...overrides,
  };
  return game as ActiveGame;
}

export function makePhaseGraphRound(
  roundNumber: number,
  roundWinnerId: string,
  scores: Round["scores"],
): Round {
  return {
    gameId: "game-1",
    scorekeeper: "phase10",
    roundNumber,
    roundWinnerId,
    scores,
  } as Round;
}

export function makePhaseGraphSeries(
  roundCount: number,
  player = phaseGraphPlayers.amy,
): PhaseGraphSeries {
  return {
    player,
    points: Array.from({ length: roundCount }, (_, index) => ({
      roundNumber: index,
      currentPhase: Math.min(index + 1, 3),
      isFinished: index > 3,
      standingValue: Math.min(index + 1, 4),
    })),
  };
}

function makePhaseGraphPlayer(id: string, name: string, color: string, index: number): Player {
  return {
    id,
    name,
    color,
    createdAt: index,
    isFavorite: 0,
  };
}
