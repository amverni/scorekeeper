import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { GameTiebreaker } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it("reads saved Round inputs, scorecard running values, Standings and graphs together after reload", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [bob.id, amy.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["phase-1", "phase-2", "phase-3"],
    },
    settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 50 },
  });
  const first = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 20 },
    ],
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: bob.id, phaseStatus: "skipped", score: 100 },
      { playerId: amy.id, phaseStatus: "satOut", score: 50 },
    ],
  });
  closeDB();

  const view = await gamesApi.getView(game.id);
  expect(view?.game.status).toBe("active");
  expect(
    view?.players.map(({ id, progress, tiebreakerTotal }) => ({
      id,
      phase: progress.currentPhase,
      total: tiebreakerTotal,
    })),
  ).toEqual([
    { id: bob.id, phase: 2, total: 120 },
    { id: amy.id, phase: 2, total: 50 },
  ]);
  expect(view?.nextRoundNumber).toBe(3);
  expect(view?.upcomingDealerId).toBe(bob.id);
  expect(view?.rounds[0].source).toEqual(first.round);
  expect(
    view?.rounds.map(({ dealerId, scores }) => ({
      dealerId,
      scores: scores.map(({ playerId, source, tiebreakerValue, runningTiebreakerTotal }) => ({
        playerId,
        phase: source?.currentPhase,
        value: tiebreakerValue,
        total: runningTiebreakerTotal,
      })),
    })),
  ).toEqual([
    {
      dealerId: bob.id,
      scores: [
        { playerId: bob.id, phase: 1, value: 20, total: 20 },
        { playerId: amy.id, phase: 1, value: 0, total: 0 },
      ],
    },
    {
      dealerId: amy.id,
      scores: [
        { playerId: bob.id, phase: 1, value: 100, total: 120 },
        { playerId: amy.id, phase: 2, value: 50, total: 50 },
      ],
    },
  ]);
  expect(
    view?.standings.rows.map((row) => ({
      id: row.player.id,
      place: row.place,
      phase: row.progress.currentPhase,
      total: row.tiebreakerTotal,
    })),
  ).toEqual([
    { id: amy.id, place: 1, phase: 2, total: 50 },
    { id: bob.id, place: 2, phase: 2, total: 120 },
  ]);
  expect(
    view?.standings.phaseGraphSeries.map(({ player, points }) => ({
      id: player.id,
      phases: points.map((point) => point.currentPhase),
    })),
  ).toEqual([
    { id: bob.id, phases: [1, 1, 2] },
    { id: amy.id, phases: [1, 2, 2] },
  ]);
  expect(
    view?.standings.tiebreakerGraphSeries.map(({ player, points }) => ({
      id: player.id,
      totals: points.map((point) => point.value),
    })),
  ).toEqual([
    { id: bob.id, totals: [0, 20, 120] },
    { id: amy.id, totals: [0, 0, 50] },
  ]);
  expect(view?.tiebreakerGraphPlayerOrder).toEqual([amy.id, bob.id]);
});

it("preserves shared manual wins and result snapshots across reloads and rejected repeat writes", async () => {
  const { amy, bob, game } = await createGame("lowestPoints", 3);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "completed", score: 0 },
    ],
  });
  await gamesApi.finish(game.id);
  await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
  await playersApi.delete(bob.id);
  closeDB();

  const view = await gamesApi.getView(game.id);
  expect(view?.game).toMatchObject({
    status: "completed",
    completionType: "manual",
    winnerIds: [bob.id, amy.id],
  });
  expect(
    view?.players.map(({ id, name, color, progress, tiebreakerTotal }) => ({
      id,
      name,
      color,
      phase: progress.currentPhase,
      finished: progress.isFinished,
      tiebreakerTotal,
    })),
  ).toEqual([
    { id: amy.id, name: "Amy", color: "Jam", phase: 2, finished: false, tiebreakerTotal: 0 },
    { id: bob.id, name: "Bob", color: "Ocean", phase: 2, finished: false, tiebreakerTotal: 0 },
  ]);
  expect(view?.standings.rows.map((row) => [row.player.name, row.place])).toEqual([
    ["Bob", 1],
    ["Amy", 1],
  ]);
  expect(view?.standings.gameWinner?.player.id).toBe(bob.id);
  expect(view?.upcomingDealerId).toBeNull();
  expect(
    view?.standings.phaseGraphSeries.map(({ player, points }) => [
      player.name,
      points.at(-1)?.currentPhase,
    ]),
  ).toEqual([
    ["Amy", 2],
    ["Bob", 2],
  ]);
  expect(
    view?.standings.tiebreakerGraphSeries.map(({ player, points }) => [
      player.name,
      points.at(-1)?.value,
    ]),
  ).toEqual([
    ["Amy", 0],
    ["Bob", 0],
  ]);

  await expect(gamesApi.finish(game.id)).rejects.toThrow("completed");
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [{ playerId: amy.id, phaseStatus: "skipped", score: 100 }],
    }),
  ).rejects.toThrow("completed");
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(view);
});

it.each<{ tiebreaker: GameTiebreaker; totals: [number, number]; winner: "amy" | "bob" }>([
  { tiebreaker: "lowestPoints", totals: [3, 2], winner: "bob" },
  { tiebreaker: "highestPoints", totals: [3, 2], winner: "amy" },
  { tiebreaker: "fewestSkips", totals: [3, 2], winner: "bob" },
  { tiebreaker: "mostSkipped", totals: [3, 2], winner: "amy" },
  { tiebreaker: "fewestWilds", totals: [3, 2], winner: "bob" },
  { tiebreaker: "roundsWon", totals: [1, 1], winner: "bob" },
])("keeps saved $tiebreaker totals and normal completion consistent with both graph series", async ({
  tiebreaker,
  totals,
  winner,
}) => {
  const { amy, bob, game } = await createGame(tiebreaker, 2);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 1 },
      { playerId: bob.id, phaseStatus: "completed", score: 2 },
    ],
  });
  const result = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 2 },
      { playerId: bob.id, phaseStatus: "completed", score: 0 },
    ],
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  const winnerId = winner === "amy" ? amy.id : bob.id;
  expect(result).toMatchObject({ outcome: "gameCompleted", gameWinner: { id: winnerId } });
  expect(view?.game).toMatchObject({
    status: "completed",
    completionType: "normal",
    winnerIds: [winnerId],
  });
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual(totals);
  expect(view?.players.map((player) => player.progress)).toEqual([
    { currentPhase: 2, isFinished: true, standingValue: 3 },
    { currentPhase: 2, isFinished: true, standingValue: 3 },
  ]);
  expect(view?.rounds[1].scores.map((score) => score.runningTiebreakerTotal)).toEqual(totals);
  expect(view?.standings.gameWinner?.player.id).toBe(winnerId);
  expect(view?.standings.rows[0].tiebreakerTotal).toBe(winner === "amy" ? totals[0] : totals[1]);
  expect(
    view?.standings.tiebreakerGraphSeries.map(({ points }) => points.map((point) => point.value)),
  ).toEqual(
    tiebreaker === "roundsWon"
      ? [
          [0, 1, 1],
          [0, 0, 1],
        ]
      : [
          [0, 1, 3],
          [0, 2, 2],
        ],
  );
  expect(
    view?.standings.phaseGraphSeries.map(({ points }) =>
      points.map((point) => point.standingValue),
    ),
  ).toEqual([
    [1, 2, 3],
    [1, 2, 3],
  ]);
  expect(view?.tiebreakerGraphPlayerOrder).toEqual([bob.id, amy.id]);
});

it("retains Game Creation Order as the normal winner fallback without inventing a Round Winner", async () => {
  const { amy, bob, game } = await createGame("roundsWon", 1);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: bob.id, phaseStatus: "skipped", score: 100 },
      { playerId: amy.id, phaseStatus: "skipped", score: 100 },
    ],
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.game).toMatchObject({ completionType: "normal", winnerIds: [amy.id] });
  expect(view?.rounds[0].source.roundWinnerId).toBeNull();
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual([0, 0]);
  expect(view?.tiebreakerGraphPlayerOrder).toEqual([amy.id, bob.id]);
});

it("reads empty Active Games and live Player presentation without deriving results", async () => {
  const { amy, bob, game } = await createGame("lowestPoints", 3);
  await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(
    view?.players.map(({ name, progress, tiebreakerTotal }) => ({
      name,
      phase: progress.currentPhase,
      finished: progress.isFinished,
      tiebreakerTotal,
    })),
  ).toEqual([
    { name: "Amelia", phase: 1, finished: false, tiebreakerTotal: 0 },
    { name: "Bob", phase: 1, finished: false, tiebreakerTotal: 0 },
  ]);
  expect(view?.rounds).toEqual([]);
  expect(view?.nextRoundNumber).toBe(1);
  expect(view?.upcomingDealerId).toBe(amy.id);
  expect(view?.standings.rows.map((row) => [row.player.id, row.place])).toEqual([
    [amy.id, 1],
    [bob.id, 1],
  ]);
  expect(view?.standings.gameWinner).toBeNull();
});

async function createGame(tiebreaker: GameTiebreaker, phaseCount: number) {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["phase-1", ...Array.from({ length: phaseCount - 1 }, (_, i) => `phase-${i + 2}`)],
    },
    settings: { tiebreaker, roundSkipPenalty: 100, sitOutPenalty: 50 },
  });
  return { amy, bob, game };
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
