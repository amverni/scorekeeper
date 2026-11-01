import type { ActiveGame, Player, Round } from "../../types";

export const completionPlayers = {
  amy: makePlayer("amy", "Amy"),
  bob: makePlayer("bob", "Bob"),
  cam: makePlayer("cam", "Cam"),
};

export function makeActiveGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  const playerIds = [completionPlayers.amy.id, completionPlayers.bob.id];
  const game = {
    id: "game-1",
    scorekeeper: "phase10",
    status: "active",
    phaseSet: {
      id: "phase-set-1",
      type: "temporary",
      name: "Short game",
      phases: ["phase-1", "phase-2"],
    },
    players: playerIds,
    firstDealerId: overrides.players?.[0] ?? playerIds[0],
    activePlayers: playerIds,
    settings: {
      tiebreaker: "lowestPoints",
      roundSkipPenalty: 100,
      sitOutPenalty: 50,
    },
    createdAt: 10,
    lastActivityAt: 10,
    ...overrides,
  };
  return game as ActiveGame;
}

export function makeRound(
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

function makePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    color: "Jam",
    createdAt: 0,
    isFavorite: 0,
  };
}
