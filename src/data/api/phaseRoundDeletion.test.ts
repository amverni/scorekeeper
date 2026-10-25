import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, expect, it, vi } from "vitest";
import type { GameTiebreaker } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

afterEach(async () => {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
});

it("deletes the latest and sole Rounds while retaining the same empty Active Game and initial progress", async () => {
  const { game, amy, bob } = await createHistory();
  const configured = await gamesApi.getById(game.id);
  for (const roundNumber of [3, 2, 1]) {
    const editor = await gamesApi.getRoundEditor(game.id, roundNumber);
    await gamesApi.deleteRound({
      gameId: game.id,
      roundId: editor.round.id,
      version: editor.version,
    });
    closeDB();
    expect((await gamesApi.getView(game.id))?.nextRoundNumber).toBe(roundNumber);
  }
  expect(await roundsApi.getByGameId(game.id)).toEqual([]);
  expect(await gamesApi.getById(game.id)).toEqual({
    ...configured,
    lastActivityAt: expect.any(Number),
  });
  expect(await gamesApi.getView(game.id)).toMatchObject({
    game: { id: game.id, status: "active", activePlayers: [amy.id, bob.id] },
    nextRoundNumber: 1,
    upcomingDealerId: amy.id,
    pendingFinishChoice: null,
    gameEndingRound: null,
    automaticCompletion: false,
    players: [
      { progress: { currentPhase: 1, isFinished: false }, tiebreakerTotal: 0, place: 1 },
      { progress: { currentPhase: 1, isFinished: false }, tiebreakerTotal: 0, place: 1 },
    ],
  });
  expect(
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: "satOut", score: 50 },
        { playerId: bob.id, phaseStatus: "satOut", score: 50 },
      ],
    }),
  ).toMatchObject({ round: { roundNumber: 1 } });
});

it("rejects missing, stale, duplicate and wrong-Game deletion without targeting a renumbered Round", async () => {
  const { game } = await createHistory();
  const second = await gamesApi.getRoundEditor(game.id, 2);
  const third = await gamesApi.getRoundEditor(game.id, 3);
  const before = await gamesApi.getView(game.id);
  const input = { gameId: game.id, roundId: second.round.id, version: second.version };
  for (const roundId of ["", "missing"]) {
    await expect(gamesApi.deleteRound({ ...input, roundId })).rejects.toThrow("Round not found");
    expect(await gamesApi.getView(game.id)).toEqual(before);
  }
  await expect(gamesApi.deleteRound({ ...input, gameId: "missing" })).rejects.toThrow();
  const otherGame = await gamesApi.create({
    players: game.players,
    phaseSet: game.phaseSet,
    settings: game.settings,
  });
  const otherView = await gamesApi.getView(otherGame.id);
  if (!otherView) throw new Error("Missing other Game.");
  await expect(
    gamesApi.deleteRound({ ...input, gameId: otherGame.id, version: otherView.version }),
  ).rejects.toThrow("Round not found");
  expect(await gamesApi.getView(otherGame.id)).toEqual(otherView);
  await expect(gamesApi.deleteRound({ ...input, version: "stale" })).rejects.toThrow(
    "history changed",
  );
  expect(await gamesApi.getView(game.id)).toEqual(before);
  const outcomes = await Promise.allSettled([
    gamesApi.deleteRound(input),
    gamesApi.deleteRound(input),
  ]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "rejected"]);
  closeDB();
  const saved = await gamesApi.getView(game.id);
  await expect(gamesApi.deleteRound({ ...input, roundId: third.round.id })).rejects.toThrow(
    "history changed",
  );
  await expect(
    gamesApi.editRound({
      gameId: game.id,
      roundNumber: 2,
      version: second.version,
      scores: second.round.scores,
      roundWinnerId: second.round.roundWinnerId,
      confirmImpact: true,
    }),
  ).rejects.toThrow("history changed");
  expect(await gamesApi.getView(game.id)).toEqual(saved);
  const current = await gamesApi.getRoundEditor(game.id, 2);
  expect(current.round.id).toBe(third.round.id);
  await expect(gamesApi.deleteRound({ ...input, version: current.version })).rejects.toThrow(
    "Round not found",
  );
  expect(await gamesApi.getView(game.id)).toEqual(saved);
  await gamesApi.finish(game.id);
  closeDB();
  const completed = await gamesApi.getView(game.id);
  await expect(
    gamesApi.deleteRound({ ...input, roundId: current.round.id, version: current.version }),
  ).rejects.toThrow("completed");
  expect(await gamesApi.getView(game.id)).toEqual(completed);
});

it("rolls back deletion and renumbering on storage failure and accepts the same recoverable command afterward", async () => {
  const { game } = await createHistory();
  const editor = await gamesApi.getRoundEditor(game.id, 2);
  const before = await gamesApi.getView(game.id);
  const input = { gameId: game.id, roundId: editor.round.id, version: editor.version };
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (value?.id === game.id) throw new DOMException("Storage unavailable", "QuotaExceededError");
    return put.call(this, value, key);
  });
  try {
    await expect(gamesApi.deleteRound(input)).rejects.toThrow("Storage unavailable");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await gamesApi.deleteRound(input);
  closeDB();
  expect((await gamesApi.getView(game.id))?.rounds).toHaveLength(2);
});

async function continuedHistory(tiebreaker: GameTiebreaker = "roundsWon") {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam", "Dan"].map((name) =>
      playersApi.create({ name, color: "Jam", isFavorite: 0 }),
    ),
  );
  const [amy, bob, cam, dan] = players;
  const game = await gamesApi.create({
    players: [amy.id, bob.id, cam.id, dan.id],
    phaseSet: {
      id: "two",
      type: "temporary",
      name: "Two",
      phases: ["classic-1", "classic-2"],
    },
    settings: { tiebreaker, roundSkipPenalty: 100, sitOutPenalty: 50 },
  });
  for (const winner of [bob, amy, amy, cam]) {
    const view = await gamesApi.getView(game.id);
    if (view?.pendingFinishChoice) {
      await gamesApi.resolveFinishChoice(game.id, "continue", view.pendingFinishChoice.token);
    }
    const playing = (await gamesApi.getView(game.id))?.playingPlayers;
    if (!playing) throw new Error("Missing Game.");
    const [first, ...rest] = playing.map((player) => ({
      playerId: player.id,
      phaseStatus: player.id === winner.id ? ("completed" as const) : ("failed" as const),
      score: player.id === winner.id ? 1 : 2,
    }));
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: winner.id,
      scores: [first, ...rest],
    });
  }
  return { game, amy, bob, cam, dan };
}

it("recalculates counted wins, finishing places and dealers while keeping actual participation gaps", async () => {
  const { game, amy, bob, cam } = await continuedHistory();
  const before = await roundsApi.getByGameId(game.id);
  const editor = await gamesApi.getRoundEditor(game.id, 2);
  await gamesApi.deleteRound({
    gameId: game.id,
    roundId: editor.round.id,
    version: editor.version,
  });
  closeDB();
  expect(await roundsApi.getByGameId(game.id)).toEqual([
    before[0],
    { ...before[2], roundNumber: 2 },
    { ...before[3], roundNumber: 3 },
  ]);
  expect(await gamesApi.getView(game.id)).toMatchObject({
    game: { status: "active", continuation: true },
    nextRoundNumber: 4,
    rounds: [
      { dealerId: amy.id },
      { dealerId: bob.id },
      {
        dealerId: cam.id,
        scores: [
          { source: undefined, counted: false },
          { counted: true },
          { counted: true },
          { counted: true },
        ],
      },
    ],
    players: [
      { id: amy.id, finishingRound: null, finishingPlace: null, tiebreakerTotal: 1 },
      { id: bob.id, finishingRound: null, tiebreakerTotal: 1 },
      { id: cam.id, finishingRound: null, tiebreakerTotal: 1 },
      { tiebreakerTotal: 0 },
    ],
  });
  const current = await gamesApi.getRoundEditor(game.id, 3);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 3,
    version: current.version,
    scores: current.round.scores.map((score) =>
      score.playerId === bob.id ? { ...score, phaseStatus: "completed" } : score,
    ),
    roundWinnerId: cam.id,
    confirmImpact: true,
  });
  expect((await gamesApi.getView(game.id))?.players[1]).toMatchObject({
    finishingRound: 3,
    finishingPlace: 1,
  });
});

it("restores applicable excluded history, retains the excluded tail and persists any resulting first-finisher choice", async () => {
  const { game, amy, bob, cam, dan } = await continuedHistory("fewestWilds");
  const ordinary = await gamesApi.create({
    players: [amy.id, bob.id, cam.id, dan.id],
    phaseSet: game.phaseSet,
    settings: game.settings,
  });
  for (const winner of [bob, null, null, cam]) {
    const [first, ...rest] = [amy, bob, cam, dan].map((player) => ({
      playerId: player.id,
      phaseStatus: player.id === winner?.id ? ("completed" as const) : ("failed" as const),
      score: player.id === winner?.id ? 1 : 2,
    }));
    await roundsApi.add({
      gameId: ordinary.id,
      roundWinnerId: winner?.id ?? null,
      scores: [first, ...rest],
    });
  }
  // Save a later Passed entry before an earlier correction excludes it.
  for (const roundNumber of [3, 1, 2]) {
    const editor = await gamesApi.getRoundEditor(ordinary.id, roundNumber);
    await gamesApi.editRound({
      gameId: ordinary.id,
      roundNumber,
      version: editor.version,
      roundWinnerId: roundNumber === 3 ? amy.id : editor.round.roundWinnerId,
      scores: editor.round.scores.map((score) =>
        score.playerId === amy.id ? { ...score, phaseStatus: "completed" } : score,
      ),
      confirmImpact: true,
    });
  }
  const before = await gamesApi.getView(ordinary.id);
  expect(before?.rounds.map((round) => round.counted)).toEqual([true, true, false, false]);
  const first = await gamesApi.getRoundEditor(ordinary.id, 1);
  await gamesApi.deleteRound({
    gameId: ordinary.id,
    roundId: first.round.id,
    version: first.version,
  });
  closeDB();
  const after = await gamesApi.getView(ordinary.id);
  expect(after?.rounds.map((round) => round.counted)).toEqual([true, true, false]);
  expect(after?.rounds.map((round) => round.source)).toEqual(
    before?.rounds.slice(1).map((round, index) => ({ ...round.source, roundNumber: index + 1 })),
  );
  expect(after?.players[0]).toMatchObject({
    finishingRound: 2,
    finishingPlace: 1,
    tiebreakerTotal: 4,
  });
  expect(after?.pendingFinishChoice?.winner.id).toBe(amy.id);
  expect(after?.pendingFinishChoice?.token).not.toBe(before?.pendingFinishChoice?.token);
  expect(after?.nextRoundNumber).toBe(4);
});

it("atomically finalizes a deletion that restores an automatic finish without dropping the excluded tail", async () => {
  const { game: setup, amy, bob, cam, dan } = await continuedHistory("fewestWilds");
  const game = await gamesApi.create({
    players: [amy.id, bob.id, cam.id, dan.id],
    phaseSet: setup.phaseSet,
    settings: setup.settings,
  });
  for (let index = 0; index < 4; index++) {
    const [first, ...rest] = [amy, bob, cam, dan].map((player) => ({
      playerId: player.id,
      phaseStatus: "failed" as const,
      score: 1,
    }));
    await roundsApi.add({ gameId: game.id, roundWinnerId: null, scores: [first, ...rest] });
  }
  for (const [roundNumber, passedIds] of [
    [1, [amy.id]],
    [2, [amy.id, bob.id, cam.id]],
    [3, [amy.id, bob.id, cam.id]],
  ] as const) {
    const editor = await gamesApi.getRoundEditor(game.id, roundNumber);
    await gamesApi.editRound({
      gameId: game.id,
      roundNumber,
      version: editor.version,
      scores: editor.round.scores.map((score) => ({
        ...score,
        phaseStatus: passedIds.some((id) => id === score.playerId) ? "completed" : "failed",
      })),
      roundWinnerId: null,
      confirmImpact: true,
    });
  }
  const before = await gamesApi.getView(game.id);
  expect(before?.game.status).toBe("active");
  expect(before?.rounds.map((round) => round.counted)).toEqual([true, true, false, false]);
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const input = { gameId: game.id, roundId: editor.round.id, version: editor.version };
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (value?.id === game.id && value.status === "completed") {
      throw new DOMException("Completion unavailable", "QuotaExceededError");
    }
    return put.call(this, value, key);
  });
  try {
    await expect(gamesApi.deleteRound(input)).rejects.toThrow("Completion unavailable");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  expect(await gamesApi.deleteRound(input)).toMatchObject({
    outcome: "gameCompleted",
    completedGame: { id: game.id, status: "completed", winnerIds: [amy.id] },
  });
  closeDB();
  const completed = await gamesApi.getView(game.id);
  expect(completed).toMatchObject({
    game: {
      status: "completed",
      completionType: "normal",
      winnerIds: [amy.id],
      playerSnapshots: [
        { id: amy.id, name: "Amy" },
        { id: bob.id, name: "Bob" },
        { id: cam.id, name: "Cam" },
        { id: dan.id, name: "Dan" },
      ],
    },
    gameEndingRound: 2,
    automaticCompletion: true,
    players: [
      { finishingRound: 2, finishingPlace: 1, tiebreakerTotal: 2 },
      { finishingRound: 2, finishingPlace: 2, tiebreakerTotal: 2 },
      { finishingRound: 2, finishingPlace: 3, tiebreakerTotal: 2 },
      { finishingRound: null, finishingPlace: null, tiebreakerTotal: 2 },
    ],
  });
  expect(completed?.rounds.map((round) => round.counted)).toEqual([true, true, false]);
  expect(completed?.rounds.map((round) => round.source)).toEqual(
    before?.rounds.slice(1).map((round, index) => ({ ...round.source, roundNumber: index + 1 })),
  );
});

async function createHistory() {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "three",
      type: "temporary",
      name: "Three",
      phases: ["classic-1", "classic-2", "classic-3"],
    },
    settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 50 },
  });
  for (const winner of [amy, bob, amy]) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: winner.id,
      scores: [
        {
          playerId: amy.id,
          phaseStatus: winner.id === amy.id ? "completed" : "failed",
          score: winner.id === amy.id ? 0 : 100,
          pointsCardBreakdown: { p5: 0, p10: winner.id === amy.id ? 0 : 10, skipCard: 0, wild: 0 },
        },
        {
          playerId: bob.id,
          phaseStatus: winner.id === bob.id ? "completed" : "failed",
          score: winner.id === bob.id ? 0 : 100,
          pointsCardBreakdown: { p5: 0, p10: winner.id === bob.id ? 0 : 10, skipCard: 0, wild: 0 },
        },
      ],
    });
  }
  return { game, amy, bob };
}

it("deletes only the chosen middle Round and reloads stable surviving inputs with recalculated progress, totals and dealers", async () => {
  const { game, amy, bob } = await createHistory();
  const before = await roundsApi.getByGameId(game.id);
  const editor = await gamesApi.getRoundEditor(game.id, 2);
  await gamesApi.deleteRound({
    gameId: game.id,
    roundId: editor.round.id,
    version: editor.version,
  });
  closeDB();
  expect(await roundsApi.getByGameId(game.id)).toEqual([
    before[0],
    { ...before[2], roundNumber: 2 },
  ]);
  expect(await gamesApi.getView(game.id)).toMatchObject({
    game: { id: game.id, status: "active", players: game.players, settings: game.settings },
    nextRoundNumber: 3,
    upcomingDealerId: amy.id,
    players: [
      { id: amy.id, progress: { currentPhase: 3 }, tiebreakerTotal: 0, place: 1 },
      { id: bob.id, progress: { currentPhase: 1 }, tiebreakerTotal: 200, place: 2 },
    ],
    rounds: [{ dealerId: amy.id }, { dealerId: bob.id }],
    standings: {
      tiebreakerGraphSeries: [
        { points: [{ value: 0 }, { value: 0 }, { value: 0 }] },
        { points: [{ value: 0 }, { value: 100 }, { value: 200 }] },
      ],
    },
  });
  const moved = await gamesApi.getRoundEditor(game.id, 2);
  expect(moved.round.id).toBe(before[2].id);
  expect(moved.round.id).not.toBe(editor.round.id);
});
