import { describe, expect, it } from "vitest";
import type { ActiveGame, CompletedGame, GameTiebreaker, Player, Round } from "../../types";
import { formatTiebreakerValue } from "../../utils";
import { deriveStandings } from "./standings";

const players = {
  amy: makePlayer("amy", "Amy", 0),
  bob: makePlayer("bob", "Bob", 1),
  cam: makePlayer("cam", "Cam", 2),
};

describe("deriveStandings", () => {
  it("derives a no-round active game from active players tied for first place", () => {
    const game = makeActiveGame({
      players: [players.amy.id, players.bob.id, players.cam.id],
      activePlayers: [players.bob.id, players.amy.id],
    });

    const standings = deriveStandings({
      game,
      players: [players.amy, players.bob, players.cam],
      rounds: [],
    });

    expect(standings.includedPlayers.map((player) => player.id)).toEqual(["amy", "bob"]);
    expect(
      standings.rows.map((row) => ({
        playerId: row.player.id,
        place: row.place,
        showPlace: row.showPlace,
        currentPhase: row.progress.currentPhase,
        isFinished: row.progress.isFinished,
        tiebreakerTotal: row.tiebreakerTotal,
      })),
    ).toEqual([
      {
        playerId: "amy",
        place: 1,
        showPlace: true,
        currentPhase: 1,
        isFinished: false,
        tiebreakerTotal: 0,
      },
      {
        playerId: "bob",
        place: 1,
        showPlace: false,
        currentPhase: 1,
        isFinished: false,
        tiebreakerTotal: 0,
      },
    ]);
    expect(
      standings.phaseGraphSeries.map((series) => ({
        playerId: series.player.id,
        points: series.points,
      })),
    ).toEqual([
      {
        playerId: "amy",
        points: [
          {
            roundNumber: 0,
            currentPhase: 1,
            isFinished: false,
            standingValue: 1,
          },
        ],
      },
      {
        playerId: "bob",
        points: [
          {
            roundNumber: 0,
            currentPhase: 1,
            isFinished: false,
            standingValue: 1,
          },
        ],
      },
    ]);
    expect(standings.gameWinner).toBeNull();
  });

  it("carries after-round progress and tiebreaker totals forward into a finished state", () => {
    const game = makeActiveGame({
      players: [players.amy.id, players.bob.id],
      activePlayers: [players.amy.id, players.bob.id],
    });
    const rounds: Round[] = [
      makeRound(4, players.amy.id, [
        { playerId: players.amy.id, currentPhase: 3, phaseStatus: "completed", score: 8 },
        { playerId: players.bob.id, currentPhase: 3, phaseStatus: "failed", score: 5 },
      ]),
      makeRound(2, players.bob.id, [
        { playerId: players.bob.id, currentPhase: 2, phaseStatus: "completed", score: 30 },
      ]),
      makeRound(1, players.bob.id, [
        { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 10 },
        { playerId: players.bob.id, currentPhase: 1, phaseStatus: "completed", score: 20 },
      ]),
      makeRound(3, players.amy.id, [
        { playerId: players.amy.id, currentPhase: 2, phaseStatus: "skipped", score: 5 },
        { playerId: players.bob.id, currentPhase: 3, phaseStatus: "failed", score: 0 },
      ]),
    ];

    const standings = deriveStandings({
      game,
      players: [players.amy, players.bob],
      rounds,
    });

    expect(
      standings.rows.map((row) => ({
        playerId: row.player.id,
        place: row.place,
        currentPhase: row.progress.currentPhase,
        isFinished: row.progress.isFinished,
        standingValue: row.progress.standingValue,
        tiebreakerTotal: row.tiebreakerTotal,
      })),
    ).toEqual([
      {
        playerId: "amy",
        place: 1,
        currentPhase: 3,
        isFinished: true,
        standingValue: 4,
        tiebreakerTotal: 23,
      },
      {
        playerId: "bob",
        place: 2,
        currentPhase: 3,
        isFinished: false,
        standingValue: 3,
        tiebreakerTotal: 55,
      },
    ]);
    expect(standings.hasFinishedPlayers).toBe(true);
    expect(standings.gameWinner?.player.id).toBe("amy");
    expect(
      standings.phaseGraphSeries.map((series) => ({
        playerId: series.player.id,
        points: series.points,
      })),
    ).toEqual([
      {
        playerId: "amy",
        points: [
          { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
          { roundNumber: 1, currentPhase: 2, isFinished: false, standingValue: 2 },
          { roundNumber: 2, currentPhase: 2, isFinished: false, standingValue: 2 },
          { roundNumber: 3, currentPhase: 3, isFinished: false, standingValue: 3 },
          { roundNumber: 4, currentPhase: 3, isFinished: true, standingValue: 4 },
        ],
      },
      {
        playerId: "bob",
        points: [
          { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
          { roundNumber: 1, currentPhase: 2, isFinished: false, standingValue: 2 },
          { roundNumber: 2, currentPhase: 3, isFinished: false, standingValue: 3 },
          { roundNumber: 3, currentPhase: 3, isFinished: false, standingValue: 3 },
          { roundNumber: 4, currentPhase: 3, isFinished: false, standingValue: 3 },
        ],
      },
    ]);
    expect(
      standings.tiebreakerGraphSeries.map((series) => ({
        playerId: series.player.id,
        points: series.points,
      })),
    ).toEqual([
      {
        playerId: "amy",
        points: [
          { roundNumber: 0, value: 0, standingValue: 0 },
          { roundNumber: 1, value: 10, standingValue: -10 },
          { roundNumber: 2, value: 10, standingValue: -10 },
          { roundNumber: 3, value: 15, standingValue: -15 },
          { roundNumber: 4, value: 23, standingValue: -23 },
        ],
      },
      {
        playerId: "bob",
        points: [
          { roundNumber: 0, value: 0, standingValue: 0 },
          { roundNumber: 1, value: 20, standingValue: -20 },
          { roundNumber: 2, value: 50, standingValue: -50 },
          { roundNumber: 3, value: 50, standingValue: -50 },
          { roundNumber: 4, value: 55, standingValue: -55 },
        ],
      },
    ]);
  });

  it("continues from carried progress when a later score has stale current phase data", () => {
    const game = makeActiveGame({
      players: [players.amy.id],
      activePlayers: [players.amy.id],
    });

    const standings = deriveStandings({
      game,
      players: [players.amy],
      rounds: [
        makeRound(1, players.amy.id, [
          { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 4 },
        ]),
        makeRound(2, players.amy.id, [
          { playerId: players.bob.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
        ]),
        makeRound(3, players.amy.id, [
          { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 6 },
        ]),
      ],
    });

    expect(standings.rows[0]?.progress).toEqual({
      currentPhase: 3,
      isFinished: false,
      standingValue: 3,
    });
    expect(standings.phaseGraphSeries[0]?.points).toEqual([
      { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
      { roundNumber: 1, currentPhase: 2, isFinished: false, standingValue: 2 },
      { roundNumber: 2, currentPhase: 2, isFinished: false, standingValue: 2 },
      { roundNumber: 3, currentPhase: 3, isFinished: false, standingValue: 3 },
    ]);
    expect(standings.rows[0]?.tiebreakerTotal).toBe(10);
  });

  it("does not count a rounds-won tiebreaker when the player is missing a score entry", () => {
    const game = makeActiveGame({
      players: [players.amy.id],
      activePlayers: [players.amy.id],
      settings: {
        tiebreaker: "roundsWon",
        roundSkipPenalty: 100,
        sitOutPenalty: 50,
      },
    });

    const standings = deriveStandings({
      game,
      players: [players.amy],
      rounds: [
        makeRound(1, players.amy.id, [
          { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
        ]),
        makeRound(2, players.amy.id, [
          { playerId: players.bob.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
        ]),
      ],
    });

    expect(standings.rows[0]?.tiebreakerTotal).toBe(1);
    expect(standings.tiebreakerGraphSeries[0]?.points).toEqual([
      { roundNumber: 0, value: 0, standingValue: 0 },
      { roundNumber: 1, value: 1, standingValue: 1 },
      { roundNumber: 2, value: 1, standingValue: 1 },
    ]);
  });

  it("formats tiebreaker totals with domain-specific units", () => {
    expect(formatTiebreakerValue(12, "lowestPoints")).toBe("12 pts");
    expect(formatTiebreakerValue(12, "highestPoints")).toBe("12 pts");
    expect(formatTiebreakerValue(1, "fewestWilds")).toBe("1 wild");
    expect(formatTiebreakerValue(3, "fewestWilds")).toBe("3 wilds");
    expect(formatTiebreakerValue(1, "fewestSkips")).toBe("1 skip");
    expect(formatTiebreakerValue(3, "fewestSkips")).toBe("3 skips");
    expect(formatTiebreakerValue(1, "mostSkipped")).toBe("1 skip");
    expect(formatTiebreakerValue(3, "mostSkipped")).toBe("3 skips");
    expect(formatTiebreakerValue(1, "roundsWon")).toBe("1 win");
    expect(formatTiebreakerValue(3, "roundsWon")).toBe("3 wins");
  });

  it("derives a completed game from finalized players", () => {
    const game = makeCompletedGame({
      players: [players.bob.id, players.amy.id],
    });

    const standings = deriveStandings({
      game,
      players: [players.amy, players.bob, players.cam],
      rounds: [],
    });

    expect(standings.includedPlayers.map((player) => player.id)).toEqual(["bob", "amy"]);
    expect(standings.rows.map((row) => row.player.id)).toEqual(["bob", "amy"]);
  });

  it("uses finalized Game Winner id for a Completed Game without a Finished Player state", () => {
    const game = makeCompletedGame({
      players: [players.amy.id, players.bob.id],
      winnerIds: [players.bob.id],
    });

    const standings = deriveStandings({
      game,
      players: [players.amy, players.bob],
      rounds: [],
    });

    expect(standings.hasFinishedPlayers).toBe(false);
    expect(standings.gameWinner?.player.id).toBe(players.bob.id);
  });

  it.each([
    {
      tiebreaker: "lowestPoints",
      amyScore: 2,
      bobScore: 5,
      roundWinnerId: players.bob.id,
      expectedOrder: ["amy", "bob"],
    },
    {
      tiebreaker: "highestPoints",
      amyScore: 2,
      bobScore: 5,
      roundWinnerId: players.amy.id,
      expectedOrder: ["bob", "amy"],
    },
    {
      tiebreaker: "fewestSkips",
      amyScore: 2,
      bobScore: 5,
      roundWinnerId: players.bob.id,
      expectedOrder: ["amy", "bob"],
    },
    {
      tiebreaker: "mostSkipped",
      amyScore: 2,
      bobScore: 5,
      roundWinnerId: players.amy.id,
      expectedOrder: ["bob", "amy"],
    },
    {
      tiebreaker: "fewestWilds",
      amyScore: 2,
      bobScore: 5,
      roundWinnerId: players.bob.id,
      expectedOrder: ["amy", "bob"],
    },
    {
      tiebreaker: "roundsWon",
      amyScore: 0,
      bobScore: 0,
      roundWinnerId: players.bob.id,
      expectedOrder: ["bob", "amy"],
    },
  ] satisfies Array<{
    tiebreaker: GameTiebreaker;
    amyScore: number;
    bobScore: number;
    roundWinnerId: string;
    expectedOrder: string[];
  }>)("uses $tiebreaker direction to order finished players and select the Game Winner", ({
    tiebreaker,
    amyScore,
    bobScore,
    roundWinnerId,
    expectedOrder,
  }) => {
    const game = makeActiveGame({
      players: [players.amy.id, players.bob.id],
      activePlayers: [players.amy.id, players.bob.id],
      phaseSet: {
        id: "phase-set-1",
        name: "One phase",
        phases: ["phase-1"],
        type: "temporary",
      },
      settings: {
        tiebreaker,
        roundSkipPenalty: 100,
        sitOutPenalty: 50,
      },
    });

    const standings = deriveStandings({
      game,
      players: [players.amy, players.bob],
      rounds: [
        makeRound(1, roundWinnerId, [
          {
            playerId: players.amy.id,
            currentPhase: 1,
            phaseStatus: "completed",
            score: amyScore,
          },
          {
            playerId: players.bob.id,
            currentPhase: 1,
            phaseStatus: "completed",
            score: bobScore,
          },
        ]),
      ],
    });

    expect(standings.rows.map((row) => row.player.id)).toEqual(expectedOrder);
    expect(standings.gameWinner?.player.id).toBe(expectedOrder[0]);
  });

  it("uses competition places while ordering equal places by recent Round Winner", () => {
    const game = makeActiveGame({
      players: [players.amy.id, players.bob.id, players.cam.id],
      activePlayers: [players.amy.id, players.bob.id, players.cam.id],
    });

    const standings = deriveStandings({
      game,
      players: [players.amy, players.bob, players.cam],
      rounds: [
        makeRound(1, players.bob.id, [
          { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
          { playerId: players.bob.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
          { playerId: players.cam.id, currentPhase: 1, phaseStatus: "failed", score: 0 },
        ]),
      ],
    });

    expect(
      standings.rows.map((row) => ({
        playerId: row.player.id,
        place: row.place,
        showPlace: row.showPlace,
      })),
    ).toEqual([
      { playerId: "bob", place: 1, showPlace: true },
      { playerId: "amy", place: 1, showPlace: false },
      { playerId: "cam", place: 3, showPlace: true },
    ]);
  });
});

function makePlayer(id: string, name: string, index: number): Player {
  return {
    id,
    name,
    color: `color-${index}`,
    createdAt: index,
    isFavorite: 0,
  };
}

function makeActiveGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    phaseOccurrences: (overrides.phaseSet?.phases ?? ["phase-1", "phase-2", "phase-3"]).map(
      (phaseId, index) => ({ id: `game-1-phase-${index}`, phaseId }),
    ),
    firstDealerId: overrides.players?.[0] ?? players.amy.id,
    scorekeeper: "phase10",
    id: "game-1",
    status: "active",
    players: [players.amy.id, players.bob.id, players.cam.id],
    activePlayers: [players.amy.id, players.bob.id, players.cam.id],
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
}

function makeCompletedGame(overrides: Partial<CompletedGame> = {}): CompletedGame {
  return {
    phaseOccurrences: (overrides.phaseSet?.phases ?? ["phase-1", "phase-2", "phase-3"]).map(
      (phaseId, index) => ({ id: `game-1-phase-${index}`, phaseId }),
    ),
    firstDealerId: overrides.players?.[0] ?? players.amy.id,
    scorekeeper: "phase10",
    id: "game-1",
    status: "completed",
    players: [players.amy.id, players.bob.id, players.cam.id],
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
    completionType: "normal",
    winnerIds: [players.amy.id],
    playerSnapshots: [
      { id: "amy", name: "Amy", color: players.amy.color },
      { id: "bob", name: "Bob", color: players.bob.color },
      { id: "cam", name: "Cam", color: players.cam.color },
    ],
    completedAt: 1,
    createdAt: 0,
    lastActivityAt: 1,
    ...overrides,
  };
}

function makeRound(roundNumber: number, roundWinnerId: string, scores: Round["scores"]): Round {
  return {
    scorekeeper: "phase10",
    gameId: "game-1",
    roundNumber,
    roundWinnerId,
    scores,
  };
}
