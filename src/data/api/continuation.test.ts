import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GameTiebreaker } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

beforeEach(resetDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

it("saves the first Finishing Round before restoring the unanswered choice after reload", async () => {
  const { game, players } = await createGame();
  const result = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: players[0].id,
    scores: [
      { playerId: players[0].id, phaseStatus: "completed", score: 0 },
      { playerId: players[1].id, phaseStatus: "failed", score: 10 },
      { playerId: players[2].id, phaseStatus: "failed", score: 20 },
      { playerId: players[3].id, phaseStatus: "failed", score: 30 },
    ],
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(result.outcome).toBe("roundAdded");
  expect(view?.game.status).toBe("active");
  expect(view?.rounds.map((round) => round.source)).toEqual([result.round]);
  expect(view?.pendingFinishChoice?.winner).toMatchObject({ id: players[0].id, name: "Amy" });
  expect(view?.upcomingDealerId).toBeNull();
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [{ playerId: players[1].id, phaseStatus: "failed", score: 0 }],
    }),
  ).rejects.toThrow("Finish Game");
  expect((await gamesApi.getView(game.id))?.rounds).toEqual(view?.rounds);
});

it("remembers Continuation, freezes Finished Players and skips their dealer turns until automatic completion", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
      { playerId: cam.id, phaseStatus: "failed", score: 20 },
      { playerId: dan.id, phaseStatus: "failed", score: 30 },
    ],
  });
  const choice = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!choice) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", choice.token);
  closeDB();
  const continued = await gamesApi.getView(game.id);
  expect(continued?.game).toMatchObject({ status: "active", continuation: true });
  expect(continued?.pendingFinishChoice).toBeNull();
  expect(continued?.upcomingDealerId).toBe(bob.id);
  expect(continued?.players.map((player) => player.finishingPlace)).toEqual([1, null, null, null]);

  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      { playerId: bob.id, phaseStatus: "completed", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  closeDB();
  const later = await gamesApi.getView(game.id);
  expect(later?.game.status).toBe("active");
  expect(later?.pendingFinishChoice).toBeNull();
  expect(later?.upcomingDealerId).toBe(cam.id);
  expect(later?.players.map((player) => [player.finishingRound, player.tiebreakerTotal])).toEqual([
    [1, 0],
    [2, 10],
    [null, 30],
    [null, 40],
  ]);
  expect(later?.rounds[1].scores[0]).toMatchObject({ source: undefined, counted: false });

  const result = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: cam.id,
    scores: [
      { playerId: cam.id, phaseStatus: "completed", score: 0 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  closeDB();
  const final = await gamesApi.getView(game.id);
  expect(result.outcome).toBe("gameCompleted");
  expect(final?.game).toMatchObject({
    status: "completed",
    completionType: "normal",
    winnerIds: [amy.id],
  });
  expect(final?.gameEndingRound).toBe(3);
  expect(final?.pendingFinishChoice).toBeNull();
  expect(final?.upcomingDealerId).toBeNull();
  expect(final?.standings.rows.map((row) => [row.player.id, row.place])).toEqual([
    [amy.id, 1],
    [bob.id, 2],
    [cam.id, 3],
    [dan.id, 4],
  ]);
});

it("preserves original Points Card Breakdowns when corrections exclude and restore a finisher's later entry", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame();
  const failedCards = { p5: 10, p10: 0, skipCard: 0, wild: 0 };
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "failed",
        score: 50,
        pointsCardBreakdown: failedCards,
      },
      { playerId: bob.id, phaseStatus: "completed", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 50 },
      { playerId: dan.id, phaseStatus: "failed", score: 50 },
    ],
  });
  const choice = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!choice) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", choice.token);
  const later = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "completed",
        score: 15,
        pointsCardBreakdown: { p5: 0, p10: 0, skipCard: 1, wild: 0 },
      },
      { playerId: cam.id, phaseStatus: "failed", score: 50 },
      { playerId: dan.id, phaseStatus: "failed", score: 50 },
    ],
  });
  await roundsApi.edit(game.id, 1, amy.id, {
    phaseStatus: "completed",
    score: 5,
    pointsCardBreakdown: { p5: 1, p10: 0, skipCard: 0, wild: 0 },
  });
  closeDB();
  const excluded = await gamesApi.getView(game.id);
  expect(excluded?.players[0]).toMatchObject({ finishingRound: 1, tiebreakerTotal: 5 });
  expect(excluded?.rounds[1].scores[0]).toMatchObject({
    source: later.round.scores[0],
    counted: false,
    tiebreakerValue: 0,
  });
  expect((await roundsApi.getByGameId(game.id))[1].scores[0]).toEqual(later.round.scores[0]);

  await roundsApi.edit(game.id, 1, amy.id, {
    phaseStatus: "failed",
    score: 50,
    pointsCardBreakdown: failedCards,
  });
  closeDB();
  const restored = await gamesApi.getView(game.id);
  expect(restored?.players[0]).toMatchObject({ finishingRound: 2, tiebreakerTotal: 65 });
  expect(restored?.rounds[1].scores[0]).toMatchObject({
    source: later.round.scores[0],
    counted: true,
    tiebreakerValue: 15,
  });
});

it("keeps corrected entries and genuine gaps, restores counted results and remembers Continuation when the winner changes", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame(2);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 10 },
      { playerId: bob.id, phaseStatus: "completed", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 20 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  const third = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "completed", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  const pending = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!pending) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", pending.token);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });

  await roundsApi.edit(game.id, 1, amy.id, { phaseStatus: "completed" });
  closeDB();
  const earlier = await gamesApi.getView(game.id);
  expect(
    earlier?.players.map((player) => [
      player.finishingRound,
      player.finishingPlace,
      player.tiebreakerTotal,
    ]),
  ).toEqual([
    [2, 1, 10],
    [3, 2, 20],
    [null, null, 40],
    [null, null, 40],
  ]);
  expect(earlier?.rounds[2].scores[0]).toMatchObject({
    source: third.round.scores[0],
    counted: false,
    tiebreakerValue: 0,
  });
  expect(earlier?.rounds[2].scores[1].counted).toBe(true);
  expect(earlier?.rounds[3].scores[0].source).toBeUndefined();
  expect(earlier?.pendingFinishChoice).toBeNull();
  expect(earlier?.standings.tiebreakerGraphSeries[0].points.map((point) => point.value)).toEqual([
    0, 10, 10,
  ]);

  await roundsApi.edit(game.id, 1, amy.id, { phaseStatus: "failed" });
  closeDB();
  const restored = await gamesApi.getView(game.id);
  expect(restored?.players[0].finishingRound).toBe(3);
  expect(restored?.rounds[2].scores[0].counted).toBe(true);
  expect(restored?.rounds[3].scores[0].source).toBeUndefined();
  expect(restored?.standings.gameWinner?.player.id).toBe(amy.id);
  await roundsApi.edit(game.id, 2, amy.id, { phaseStatus: "failed" });
  closeDB();
  const changedWinner = await gamesApi.getView(game.id);
  expect(changedWinner?.standings.gameWinner?.player.id).toBe(bob.id);
  expect(changedWinner?.players[0]).toMatchObject({
    progress: { currentPhase: 2, isFinished: false },
    finishingRound: null,
    tiebreakerTotal: 10,
  });
  expect(changedWinner?.rounds[3].scores[0]).toMatchObject({ source: undefined, counted: false });
  expect(changedWinner?.pendingFinishChoice).toBeNull();
  expect(changedWinner?.upcomingDealerId).toBe(amy.id);
});

it("automatically finalizes a corrected earlier ending without deleting retained Rounds or counting their winners", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame(2);
  for (let index = 0; index < 3; index++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: index === 2 ? amy.id : null,
      scores: [
        { playerId: amy.id, phaseStatus: index === 0 ? "failed" : "completed", score: 0 },
        { playerId: bob.id, phaseStatus: index === 0 ? "failed" : "completed", score: 0 },
        { playerId: cam.id, phaseStatus: index === 0 ? "completed" : "failed", score: 10 },
        { playerId: dan.id, phaseStatus: "failed", score: 10 },
      ],
    });
  }
  const choice = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!choice) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", choice.token);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  await roundsApi.edit(game.id, 1, amy.id, { phaseStatus: "completed" });
  await roundsApi.edit(game.id, 1, bob.id, { phaseStatus: "completed" });
  await roundsApi.edit(game.id, 2, cam.id, { phaseStatus: "completed" });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.game).toMatchObject({
    status: "completed",
    completionType: "normal",
    winnerIds: [amy.id],
  });
  expect(view?.gameEndingRound).toBe(2);
  expect(view?.rounds.map((round) => round.counted)).toEqual([true, true, false, false]);
  expect(view?.rounds[2].source.roundWinnerId).toBe(amy.id);
  expect(view?.rounds[2].scores.every((score) => !score.counted)).toBe(true);
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual([0, 0, 20, 20]);
  expect(view?.standings.tiebreakerGraphSeries[3].points.map((point) => point.value)).toEqual([
    0, 10, 20,
  ]);
  expect((await roundsApi.getByGameId(game.id)).length).toBe(4);
});

it("applies the automatic threshold when Keep playing makes retained Rounds count again", async () => {
  const {
    game,
    players: [amy, bob, cam],
  } = await createGame(2, "lowestPoints", 3);
  for (let index = 0; index < 3; index++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: index === 1 ? "completed" : "failed", score: 0 },
        { playerId: bob.id, phaseStatus: index === 1 ? "failed" : "completed", score: 10 },
        { playerId: cam.id, phaseStatus: "failed", score: 10 },
      ],
    });
  }
  await roundsApi.edit(game.id, 1, amy.id, { phaseStatus: "completed" });
  const corrected = await gamesApi.getView(game.id);
  expect(corrected?.rounds.map((round) => round.counted)).toEqual([true, true, false]);
  if (!corrected?.pendingFinishChoice) throw new Error("Missing corrected choice");
  const result = await gamesApi.resolveFinishChoice(
    game.id,
    "continue",
    corrected.pendingFinishChoice.token,
  );
  closeDB();
  expect(result).toMatchObject({ status: "completed", continuation: true, winnerIds: [amy.id] });
  const final = await gamesApi.getView(game.id);
  expect(final?.gameEndingRound).toBe(3);
  expect(final?.rounds.map((round) => round.counted)).toEqual([true, true, true]);
  expect(final?.players.map((player) => player.finishingRound)).toEqual([2, 3, null]);
});

it.each([
  "continue",
  "finish",
] as const)("keeps a failed %s choice retryable without changing the durable Round", async (action) => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  const before = await gamesApi.getView(game.id);
  if (!before?.pendingFinishChoice) throw new Error("Missing first-finisher choice");
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === "games") {
      failure.mockRestore();
      throw new DOMException("Choice storage unavailable", "QuotaExceededError");
    }
    return put.call(this, value, key);
  });
  await expect(
    gamesApi.resolveFinishChoice(game.id, action, before.pendingFinishChoice.token),
  ).rejects.toThrow("Choice storage unavailable");
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await gamesApi.resolveFinishChoice(game.id, action, before.pendingFinishChoice.token);
  closeDB();
  const retried = await gamesApi.getView(game.id);
  expect(retried?.game.status).toBe(action === "finish" ? "completed" : "active");
  expect(retried?.pendingFinishChoice).toBeNull();
  expect(retried?.rounds.map((round) => round.source)).toEqual(
    before.rounds.map((round) => round.source),
  );
});

it("does not complete an empty or unfinished solo roster, while preserving a solo Player's actual finish", async () => {
  const { game: empty } = await createGame(1, "lowestPoints", 0);
  expect(await gamesApi.getView(empty.id)).toMatchObject({
    automaticCompletion: false,
    pendingFinishChoice: null,
    standings: { gameWinner: null },
  });
  await expect(gamesApi.finish(empty.id)).rejects.toThrow();
  const {
    game: solo,
    players: [amy],
  } = await createGame(1, "lowestPoints", 1);
  await roundsApi.add({
    gameId: solo.id,
    roundWinnerId: null,
    scores: [{ playerId: amy.id, phaseStatus: "failed", score: 10 }],
  });
  expect(await gamesApi.getView(solo.id)).toMatchObject({
    game: { status: "active" },
    automaticCompletion: false,
    pendingFinishChoice: null,
  });
  await roundsApi.add({
    gameId: solo.id,
    roundWinnerId: null,
    scores: [{ playerId: amy.id, phaseStatus: "completed", score: 0 }],
  });
  closeDB();
  expect((await gamesApi.getView(solo.id))?.game).toMatchObject({
    status: "completed",
    winnerIds: [amy.id],
  });
  expect((await gamesApi.getView(empty.id))?.game.status).toBe("active");
});

it("rejects a new-Round draft after a correction changes phase assignments without changing its Round number", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame(3);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 10 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  });
  const loaded = await gamesApi.getView(game.id);
  if (!loaded) throw new Error("Missing Game view");
  const draft = {
    gameId: game.id,
    roundWinnerId: null,
    expectedRoundNumber: loaded.nextRoundNumber,
    expectedVersion: loaded.version,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  } satisfies Parameters<typeof roundsApi.add>[0];
  await roundsApi.edit(game.id, 1, amy.id, { phaseStatus: "completed" });
  const corrected = await gamesApi.getView(game.id);
  expect(corrected?.nextRoundNumber).toBe(2);
  expect(corrected?.players[0].progress.currentPhase).toBe(2);
  await expect(roundsApi.add(draft)).rejects.toThrow("history changed");
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(corrected);
});

it("rejects stale decisions and duplicate saves atomically without losing the saved Round", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame(2);
  const input = {
    gameId: game.id,
    expectedRoundNumber: 1,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
      { playerId: cam.id, phaseStatus: "failed", score: 10 },
      { playerId: dan.id, phaseStatus: "failed", score: 10 },
    ],
  } satisfies Parameters<typeof roundsApi.add>[0];
  const saves = await Promise.allSettled([roundsApi.add(input), roundsApi.add(input)]);
  expect(saves.map((save) => save.status)).toEqual(["fulfilled", "rejected"]);
  closeDB();
  expect((await gamesApi.getView(game.id))?.rounds.length).toBe(1);
  await roundsApi.add({ ...input, expectedRoundNumber: 2 });
  const view = await gamesApi.getView(game.id);
  const choice = view?.pendingFinishChoice;
  if (!choice) throw new Error("Missing first-finisher choice");
  await roundsApi.edit(game.id, 1, bob.id, { score: 20 });
  await expect(gamesApi.resolveFinishChoice(game.id, "continue", choice.token)).rejects.toThrow(
    "changed",
  );
  closeDB();
  const corrected = await gamesApi.getView(game.id);
  expect(corrected?.game).not.toHaveProperty("continuation");
  if (!corrected?.pendingFinishChoice) throw new Error("Missing corrected choice");
  const finished = await gamesApi.resolveFinishChoice(
    game.id,
    "finish",
    corrected.pendingFinishChoice.token,
  );
  expect(finished).toMatchObject({
    status: "completed",
    completionType: "normal",
    winnerIds: [amy.id],
  });
  await expect(
    gamesApi.resolveFinishChoice(game.id, "continue", corrected.pendingFinishChoice.token),
  ).rejects.toThrow("completed");
  closeDB();
  expect((await gamesApi.getView(game.id))?.game).toEqual(finished);
});

it.each<GameTiebreaker>([
  "lowestPoints",
  "highestPoints",
  "fewestWilds",
  "fewestSkips",
  "mostSkipped",
  "roundsWon",
])("assigns distinct same-Round places by %s, counted winner and Seating Order", async (tiebreaker) => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame(1, tiebreaker);
  const lowerIsBetter = ["lowestPoints", "fewestWilds", "fewestSkips"].includes(tiebreaker);
  const result = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: lowerIsBetter ? 2 : 1 },
      { playerId: bob.id, phaseStatus: "completed", score: lowerIsBetter ? 1 : 2 },
      { playerId: cam.id, phaseStatus: "completed", score: lowerIsBetter ? 1 : 2 },
      { playerId: dan.id, phaseStatus: "failed", score: 0 },
    ],
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  const expectedOrder =
    tiebreaker === "roundsWon"
      ? [amy.id, bob.id, cam.id, dan.id]
      : [bob.id, cam.id, amy.id, dan.id];
  expect(result.outcome).toBe("gameCompleted");
  expect(view?.standings.rows.map((row) => [row.player.id, row.place, row.showPlace])).toEqual(
    expectedOrder.map((id, index) => [id, index + 1, true]),
  );
  expect(view?.game).toMatchObject({ winnerIds: [expectedOrder[0]] });
});

it("keeps earlier finishers ahead of better later totals and preserves unfinished shared places on Manual Finish", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "skipped", score: 100 },
      { playerId: bob.id, phaseStatus: "failed", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 0 },
      { playerId: dan.id, phaseStatus: "failed", score: 0 },
    ],
  });
  const choice = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!choice) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", choice.token);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      { playerId: bob.id, phaseStatus: "completed", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 0 },
      { playerId: dan.id, phaseStatus: "failed", score: 0 },
    ],
  });
  expect((await gamesApi.getView(game.id))?.standings.gameWinner?.player.id).toBe(amy.id);
  const finished = await gamesApi.finish(game.id);
  closeDB();
  const final = await gamesApi.getView(game.id);
  expect(finished).toMatchObject({ completionType: "manual", winnerIds: [amy.id] });
  expect(
    final?.standings.rows.map((row) => [row.player.id, row.place, row.progress.isFinished]),
  ).toEqual([
    [amy.id, 1, true],
    [bob.id, 2, true],
    [cam.id, 3, false],
    [dan.id, 3, false],
  ]);
});

it("rejects missing, duplicate, finished or invalid entries without any partial Round or result changes", async () => {
  const {
    game,
    players: [amy, bob, cam, dan],
  } = await createGame();
  const input = {
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
      { playerId: cam.id, phaseStatus: "failed", score: 20 },
      { playerId: dan.id, phaseStatus: "failed", score: 30 },
    ],
  } satisfies Parameters<typeof roundsApi.add>[0];
  await roundsApi.add(input);
  const choice = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!choice) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", choice.token);
  const before = await gamesApi.getView(game.id);
  const valid = input.scores.slice(1);
  const [first, ...rest] = valid;
  for (const scores of [
    [first],
    [first, first, ...rest],
    input.scores,
    [{ ...first, score: Number.NaN }, ...rest],
    [{ ...first, score: -1 }, ...rest],
  ]) {
    await expect(
      roundsApi.add({ ...input, scores: [scores[0], ...scores.slice(1)] }),
    ).rejects.toThrow();
    closeDB();
    expect(await gamesApi.getView(game.id)).toEqual(before);
  }
});

async function createGame(
  phaseCount = 1,
  tiebreaker: GameTiebreaker = "lowestPoints",
  playerCount = 4,
) {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam", "Dan"]
      .slice(0, playerCount)
      .map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await gamesApi.create({
    players: players.map((player) => player.id),
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: [
        "phase-1",
        ...Array.from({ length: phaseCount - 1 }, (_, index) => `phase-${index + 2}`),
      ],
    },
    settings: { tiebreaker, roundSkipPenalty: 100, sitOutPenalty: 0 },
  });
  return { game, players };
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
