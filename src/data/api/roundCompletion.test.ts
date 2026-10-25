import { describe, expect, it } from "vitest";
import type { Round } from "../../types";
import {
  makeActiveGame,
  makeRound,
  completionPlayers as players,
} from "./gameCompletionTestFixtures";
import { resolveGameCompletion } from "./roundCompletion";

describe("resolveGameCompletion", () => {
  it("does not complete an Active Game when no player has finished the final Phase", () => {
    const game = makeActiveGame();
    const rounds: Round[] = [
      makeRound(1, players.amy.id, [
        { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
        { playerId: players.bob.id, currentPhase: 1, phaseStatus: "failed", score: 20 },
      ]),
    ];

    expect(
      resolveGameCompletion({
        game,
        players: [players.amy, players.bob],
        rounds,
        completedAt: 123,
      }),
    ).toBeNull();
  });

  it("completes an Active Game with its Standings Game Winner", () => {
    const game = makeActiveGame({
      players: [players.amy.id, players.bob.id, players.cam.id],
      activePlayers: [players.amy.id, players.bob.id],
    });
    const rounds: Round[] = [
      makeRound(1, players.bob.id, [
        { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 5 },
        { playerId: players.bob.id, currentPhase: 1, phaseStatus: "completed", score: 10 },
      ]),
      makeRound(2, players.amy.id, [
        { playerId: players.amy.id, currentPhase: 2, phaseStatus: "completed", score: 0 },
        { playerId: players.bob.id, currentPhase: 2, phaseStatus: "completed", score: 2 },
      ]),
    ];

    const resolution = resolveGameCompletion({
      game,
      players: [players.amy, players.bob, players.cam],
      rounds,
      completedAt: 456,
    });

    expect(resolution).toEqual({
      completedGame: {
        id: game.id,
        scorekeeper: "phase10",
        status: "completed",
        phaseSet: game.phaseSet,
        players: [players.amy.id, players.bob.id],
        settings: game.settings,
        createdAt: game.createdAt,
        lastActivityAt: 456,
        completedAt: 456,
        completionType: "normal",
        winnerIds: [players.amy.id],
        playerSnapshots: [
          { id: "amy", name: "Amy", color: "Jam" },
          { id: "bob", name: "Bob", color: "Jam" },
        ],
      },
      gameWinner: players.amy,
    });
  });

  it.each([
    { fallback: "most recent Round Winner", roundWinnerId: "amy", expectedWinnerId: "amy" },
    { fallback: "Game Creation Order", roundWinnerId: "cam", expectedWinnerId: "bob" },
  ])("uses $fallback when Finished Players tie on their Tiebreaker", ({
    roundWinnerId,
    expectedWinnerId,
  }) => {
    const game = makeActiveGame({
      players: [players.bob.id, players.amy.id, players.cam.id],
      activePlayers: [players.amy.id, players.bob.id, players.cam.id],
    });
    const resolution = resolveGameCompletion({
      game,
      players: [players.amy, players.bob, players.cam],
      rounds: [
        makeRound(1, roundWinnerId, [
          { playerId: players.amy.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
          { playerId: players.bob.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
          { playerId: players.cam.id, currentPhase: 1, phaseStatus: "failed", score: 0 },
        ]),
        makeRound(2, roundWinnerId, [
          { playerId: players.amy.id, currentPhase: 2, phaseStatus: "completed", score: 0 },
          { playerId: players.bob.id, currentPhase: 2, phaseStatus: "completed", score: 0 },
          { playerId: players.cam.id, currentPhase: 1, phaseStatus: "completed", score: 0 },
        ]),
      ],
      completedAt: 456,
    });

    expect(resolution?.completedGame.winnerIds).toEqual([expectedWinnerId]);
    expect(resolution?.gameWinner.id).toBe(expectedWinnerId);
  });
});
