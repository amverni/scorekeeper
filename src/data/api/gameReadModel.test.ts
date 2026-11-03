import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CreateGameInput, GameTiebreaker } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it.each([
  true,
  false,
])("persists a non-first-seat First Dealer and wraps without changing seats or results (in-order: %s)", async (inOrderPhases) => {
  const [amy, bob, cam] = await Promise.all(
    ["Amy", "Bob", "Cam"].map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await gamesApi.create({
    players: [amy.id, bob.id, cam.id],
    firstDealer: { type: "player", playerId: bob.id },
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1"] },
    settings: { inOrderPhases, tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  expect(await gamesApi.getView(game.id)).toMatchObject({
    game: { firstDealerId: bob.id },
    upcomingDealerId: bob.id,
  });
  for (const upcomingDealerId of [cam.id, amy.id, bob.id, cam.id]) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, selectedPhase: 1, phaseStatus: "failed", score: 2 },
        { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 1 },
        { playerId: cam.id, selectedPhase: 1, phaseStatus: "failed", score: 3 },
      ],
    });
    closeDB();
    expect(await gamesApi.getView(game.id)).toMatchObject({ upcomingDealerId });
  }
  const view = await gamesApi.getView(game.id);
  expect(view?.game).toMatchObject({ firstDealerId: bob.id, players: game.players });
  expect(view?.players.map(({ id }) => id)).toEqual(game.players);
  expect(view?.rounds.map(({ dealerId }) => dealerId)).toEqual([bob.id, cam.id, amy.id, bob.id]);
  expect(
    view?.standings.rows.map(({ player, tiebreakerTotal }) => [player.id, tiebreakerTotal]),
  ).toEqual([
    [bob.id, 4],
    [amy.id, 8],
    [cam.id, 12],
  ]);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, selectedPhase: 1, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, selectedPhase: 1, phaseStatus: "completed", score: 4 },
      { playerId: cam.id, selectedPhase: 1, phaseStatus: "completed", score: 0 },
    ],
  });
  expect(await gamesApi.getView(game.id)).toMatchObject({
    game: { firstDealerId: bob.id, status: "completed", winnerIds: [amy.id] },
    players: [
      { id: amy.id, finishingPlace: 1 },
      { id: bob.id, finishingPlace: 2 },
      { id: cam.id, finishingPlace: 3 },
    ],
  });
  const completed = await gamesApi.getById(game.id);
  if (!completed) throw new Error("Missing completed Game");
  await gamesApi.reopen(game.id, JSON.stringify(completed));
  closeDB();
  expect(await gamesApi.getView(game.id)).toMatchObject({
    game: { firstDealerId: bob.id, status: "active", players: game.players },
    rounds: [
      { dealerId: bob.id },
      { dealerId: cam.id },
      { dealerId: amy.id },
      { dealerId: bob.id },
      { dealerId: cam.id },
    ],
  });
});

it("reads saved Round inputs, scorecard running values, Standings and graphs together after reload", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [bob.id, amy.id],
    firstDealer: { type: "player", playerId: bob.id },
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
  expect(view?.rounds[0].source.scores.every((score) => !("pointsCardBreakdown" in score))).toBe(
    true,
  );
});

it.each([
  "lowestPoints",
  "highestPoints",
] as const)("reloads different original card combinations with equal %s totals without inventing penalty cards", async (tiebreaker) => {
  const { amy, bob, game } = await createGame(tiebreaker, 3);
  await roundsApi.add({
    gameId: game.id,
    expectedRoundNumber: 1,
    roundWinnerId: null,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "completed",
        score: 55,
        pointsCardBreakdown: { p5: 1, p10: 1, skipCard: 1, wild: 1 },
      },
      {
        playerId: bob.id,
        phaseStatus: "completed",
        score: 55,
        pointsCardBreakdown: { p5: 3, p10: 0, skipCard: 1, wild: 1 },
      },
    ],
  });
  await roundsApi.add({
    gameId: game.id,
    expectedRoundNumber: 2,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "skipped", score: 100 },
      { playerId: bob.id, phaseStatus: "satOut", score: 50 },
    ],
  });
  closeDB();

  const view = await gamesApi.getView(game.id);
  expect(view?.rounds[0].scores.map((entry) => entry.source?.pointsCardBreakdown)).toEqual([
    { p5: 1, p10: 1, skipCard: 1, wild: 1 },
    { p5: 3, p10: 0, skipCard: 1, wild: 1 },
  ]);
  expect(view?.rounds[1].source.scores).toEqual([
    {
      playerId: amy.id,
      phaseStatus: "skipped",
      score: 100,
      currentPhase: 2,
      phaseOccurrenceId: game.phaseOccurrences[1].id,
    },
    {
      playerId: bob.id,
      phaseStatus: "satOut",
      score: 50,
      currentPhase: 2,
      phaseOccurrenceId: game.phaseOccurrences[1].id,
    },
  ]);
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual([155, 105]);
  expect(await roundsApi.getByGameId(game.id)).toEqual(view?.rounds.map((round) => round.source));
});

it.each([
  "fewestWilds",
  "fewestSkips",
  "mostSkipped",
  "roundsWon",
] as const)("keeps %s event values separate from remaining-card counters", async (tiebreaker) => {
  const { amy, bob, game } = await createGame(tiebreaker, 3);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 3 },
      { playerId: bob.id, phaseStatus: "failed", score: 2 },
    ],
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.rounds[0].source.scores).toEqual([
    {
      playerId: amy.id,
      phaseStatus: "completed",
      score: 3,
      currentPhase: 1,
      phaseOccurrenceId: game.phaseOccurrences[0].id,
    },
    {
      playerId: bob.id,
      phaseStatus: "failed",
      score: 2,
      currentPhase: 1,
      phaseOccurrenceId: game.phaseOccurrences[0].id,
    },
  ]);
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual(
    tiebreaker === "roundsWon" ? [1, 0] : [3, 2],
  );
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: amy.id,
      scores: [
        {
          playerId: amy.id,
          phaseStatus: "completed",
          score: 0,
          pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 0, wild: 0 },
        },
        { playerId: bob.id, phaseStatus: "failed", score: 2 },
      ],
    }),
  ).rejects.toThrow("Points Card Breakdown");
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(view);
});

it.each([
  {
    reason: "negative counters",
    phaseStatus: "completed",
    score: 5,
    pointsCardBreakdown: { p5: -1, p10: 1, skipCard: 0, wild: 0 },
  },
  {
    reason: "fractional counters",
    phaseStatus: "completed",
    score: 5,
    pointsCardBreakdown: { p5: 0, p10: 0.5, skipCard: 0, wild: 0 },
  },
  {
    reason: "non-finite counters",
    phaseStatus: "completed",
    score: 5,
    pointsCardBreakdown: { p5: Number.NaN, p10: 0, skipCard: 0, wild: 0 },
  },
  {
    reason: "a total that differs from the cards",
    phaseStatus: "completed",
    score: 10,
    pointsCardBreakdown: { p5: 1, p10: 0, skipCard: 0, wild: 0 },
  },
  {
    reason: "too few cards for Failed",
    phaseStatus: "failed",
    score: 5,
    pointsCardBreakdown: { p5: 1, p10: 0, skipCard: 0, wild: 0 },
  },
  {
    reason: "too many cards for Passed",
    phaseStatus: "completed",
    score: 50,
    pointsCardBreakdown: { p5: 10, p10: 0, skipCard: 0, wild: 0 },
  },
  {
    reason: "remaining cards for a Round Winner",
    phaseStatus: "completed",
    score: 5,
    pointsCardBreakdown: { p5: 1, p10: 0, skipCard: 0, wild: 0 },
    winner: true,
  },
  {
    reason: "remaining cards for Round Skip",
    phaseStatus: "skipped",
    score: 100,
    pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 0, wild: 0 },
  },
  {
    reason: "remaining cards for Sit Out",
    phaseStatus: "satOut",
    score: 50,
    pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 0, wild: 0 },
  },
] as const)("rejects $reason without changing the saved Game", async ({
  phaseStatus,
  score,
  pointsCardBreakdown,
  ...scenario
}) => {
  const { amy, bob, game } = await createGame("lowestPoints", 3);
  const before = await gamesApi.getView(game.id);
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: "winner" in scenario ? amy.id : null,
      scores: [
        { playerId: amy.id, phaseStatus, score, pointsCardBreakdown },
        {
          playerId: bob.id,
          phaseStatus: "completed",
          score: 0,
          pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 0, wild: 0 },
        },
      ],
    }),
  ).rejects.toThrow(/cards|Card|Points/);
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
});

it("rejects a stale Add Round submission instead of saving the same card entry twice", async () => {
  const { amy, bob, game } = await createGame("lowestPoints", 3);
  const draft = {
    gameId: game.id,
    expectedRoundNumber: 1,
    roundWinnerId: null,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "completed",
        score: 55,
        pointsCardBreakdown: { p5: 1, p10: 1, skipCard: 1, wild: 1 },
      },
      {
        playerId: bob.id,
        phaseStatus: "failed",
        score: 50,
        pointsCardBreakdown: { p5: 10, p10: 0, skipCard: 0, wild: 0 },
      },
    ],
  } satisfies Parameters<typeof roundsApi.add>[0] & { expectedRoundNumber: number };
  const outcomes = await Promise.allSettled([roundsApi.add(draft), roundsApi.add(draft)]);
  expect(outcomes.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(outcomes[1]).toMatchObject({
    reason: new Error("Round history changed. Reload before saving."),
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.rounds).toHaveLength(1);
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual([55, 50]);
  const saved = view;
  await expect(roundsApi.add(draft)).rejects.toThrow("Round history changed");
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(saved);
});

it("keeps saved card source consistent when the existing Round edit API changes an entry", async () => {
  const { amy, bob, game } = await createGame("lowestPoints", 3);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "completed",
        score: 55,
        pointsCardBreakdown: { p5: 1, p10: 1, skipCard: 1, wild: 1 },
      },
      { playerId: bob.id, phaseStatus: "failed", score: 50 },
    ],
  });
  const before = await gamesApi.getView(game.id);
  await expect(roundsApi.edit(game.id, 1, amy.id, { score: 50 })).rejects.toThrow(
    "Points must match cards",
  );
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await roundsApi.edit(game.id, 1, amy.id, {
    score: 50,
    pointsCardBreakdown: { p5: 0, p10: 1, skipCard: 1, wild: 1 },
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.rounds[0].scores[0].source).toMatchObject({
    score: 50,
    pointsCardBreakdown: { p5: 0, p10: 1, skipCard: 1, wild: 1 },
  });
  expect(view?.players[0].tiebreakerTotal).toBe(50);
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
    firstDealer: { type: "player", playerId: amy.id },
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
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
}

it.each([
  2, 3,
])("resolves Random once from the final %s-Player roster, then persists it through reload and Manual Finish", async (count) => {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam"]
      .slice(0, count)
      .map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const ids = players.map(({ id }) => id);
  const random = vi.spyOn(Math, "random");
  for (const [index, playerId] of ids.entries()) {
    random.mockReturnValue((index + 0.5) / count);
    const game = await gamesApi.create({
      players: ids,
      ...(index === 0 ? {} : { firstDealer: { type: "random" as const } }),
      phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1"] },
      settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
    });
    expect(game.firstDealerId).toBe(playerId);
    random.mockImplementation(() => {
      throw new Error("Existing Games must not draw another First Dealer");
    });
    closeDB();
    expect(await gamesApi.getView(game.id)).toMatchObject({
      game: { firstDealerId: playerId, players: ids },
      upcomingDealerId: playerId,
    });
    const [first, ...rest] = ids.map((playerId) => ({
      playerId,
      phaseStatus: "failed" as const,
      score: 0,
    }));
    await roundsApi.add({ gameId: game.id, roundWinnerId: null, scores: [first, ...rest] });
    const completed = await gamesApi.finish(game.id);
    expect(completed.firstDealerId).toBe(playerId);
    await gamesApi.reopen(game.id, JSON.stringify(completed));
    closeDB();
    expect(await gamesApi.getView(game.id)).toMatchObject({
      game: { firstDealerId: playerId, status: "active", players: ids },
      rounds: [{ dealerId: playerId }],
      upcomingDealerId: ids[(index + 1) % count],
    });
  }
});

it("rejects invalid First Dealer choices without saving, and never draws for a named choice", async () => {
  const { amy, bob, game } = await createGame("fewestWilds", 1);
  const input: CreateGameInput = {
    players: [amy.id, bob.id],
    phaseSet: game.phaseSet,
    settings: game.settings,
  };
  for (const firstDealer of [
    { type: "player", playerId: "outside-roster" },
    { type: "player", playerId: "" },
    { type: "unsupported" },
    null,
  ]) {
    const invalid = { ...input };
    Object.assign(invalid, { firstDealer });
    await expect(gamesApi.create(invalid)).rejects.toThrow("First Dealer");
  }
  await expect(gamesApi.create({ ...input, players: [] })).rejects.toThrow("First Dealer");
  await expect(gamesApi.create({ ...input, players: [amy.id, amy.id] })).rejects.toThrow("unique");
  expect(await gamesApi.getAll()).toEqual([game]);
  vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Named choice must not draw");
  });
  expect(
    await gamesApi.create({
      ...input,
      firstDealer: { type: "player", playerId: bob.id },
    }),
  ).toMatchObject({ firstDealerId: bob.id });
});
