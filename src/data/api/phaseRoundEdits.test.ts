import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GameTiebreaker } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it("previews without writing and reloads an exact full-Round correction without warning for totals alone", async () => {
  const { game, amy, bob } = await createGame();
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
      {
        playerId: bob.id,
        phaseStatus: "failed",
        score: 100,
        pointsCardBreakdown: { p5: 0, p10: 10, skipCard: 0, wild: 0 },
      },
    ],
  });
  const before = await gamesApi.getView(game.id);
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  expect(editor.round.scores[0].pointsCardBreakdown).toEqual({
    p5: 1,
    p10: 1,
    skipCard: 1,
    wild: 1,
  });
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    roundWinnerId: null,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "completed" as const,
        score: 60,
        pointsCardBreakdown: { p5: 2, p10: 1, skipCard: 1, wild: 1 },
      },
      editor.round.scores[1],
    ],
  };
  expect(await gamesApi.previewRoundEdit(input)).toEqual({ requiresConfirmation: false });
  expect(await gamesApi.getView(game.id)).toEqual(before);
  expect((await gamesApi.editRound(input)).outcome).toBe("roundEdited");
  closeDB();
  const reloaded = await gamesApi.getView(game.id);
  expect(reloaded?.players.map((player) => player.tiebreakerTotal)).toEqual([60, 100]);
  expect(reloaded?.rounds[0].source.scores[0]).toMatchObject(input.scores[0]);
  expect(reloaded?.standings.tiebreakerGraphSeries[0].points.at(-1)?.value).toBe(60);
});

it("confirms changed finishes, retains excluded winning entries, and restores them when the correction is reversed", async () => {
  const { game, amy, bob, cam, dan } = await createContinuedHistory();
  const original = await gamesApi.getRoundEditor(game.id, 1);
  const before = await gamesApi.getView(game.id);
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: original.version,
    roundWinnerId: bob.id,
    scores: original.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" as const } : score,
    ),
  };
  expect(await gamesApi.previewRoundEdit(input)).toEqual({ requiresConfirmation: true });
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await expect(gamesApi.editRound(input)).rejects.toThrow("Confirm");
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await gamesApi.editRound({ ...input, confirmImpact: true });
  closeDB();
  const corrected = await gamesApi.getView(game.id);
  expect(corrected?.game.status).toBe("active");
  expect(corrected?.players.find((player) => player.id === amy.id)).toMatchObject({
    finishingRound: 2,
    finishingPlace: 1,
    tiebreakerTotal: 1,
  });
  expect(corrected?.rounds[2].scores.map(({ playerId, counted }) => [playerId, counted])).toEqual([
    [amy.id, false],
    [bob.id, true],
    [cam.id, true],
    [dan.id, true],
  ]);
  expect(corrected?.rounds[2].source).toEqual(before?.rounds[2].source);
  expect(corrected?.rounds[2].source.roundWinnerId).toBe(amy.id);
  expect((await gamesApi.getRoundEditor(game.id, 3)).countedPlayerIds).toEqual([
    bob.id,
    cam.id,
    dan.id,
  ]);
  expect(corrected?.standings.tiebreakerGraphSeries[0].points.at(-1)?.value).toBe(1);
  const reload = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.editRound({
    ...input,
    version: reload.version,
    scores: original.round.scores,
    confirmImpact: true,
  });
  closeDB();
  const restored = await gamesApi.getView(game.id);
  expect(restored?.players.find((player) => player.id === amy.id)).toMatchObject({
    finishingRound: 3,
    tiebreakerTotal: 2,
  });
  expect(restored?.rounds[2].scores.every((entry) => entry.counted)).toBe(true);
  expect(restored?.rounds[3].scores[0].source).toBeUndefined();
  expect(restored?.rounds[3].scores[0].tiebreakerValue).toBe(0);
});

it("rejects invalid Round Winners, duplicate Players and stale edits without changing saved history", async () => {
  const { game, amy, bob } = await createContinuedHistory();
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const before = await gamesApi.getView(game.id);
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    scores: editor.round.scores,
    roundWinnerId: bob.id,
    confirmImpact: true,
  };
  for (const roundWinnerId of [null, amy.id, "missing"]) {
    await expect(gamesApi.editRound({ ...input, roundWinnerId })).rejects.toThrow("Round Winner");
    expect(await gamesApi.getView(game.id)).toEqual(before);
  }
  await expect(
    gamesApi.editRound({
      ...input,
      scores: [editor.round.scores[0], editor.round.scores[0]],
    }),
  ).rejects.toThrow("entry");
  await expect(gamesApi.editRound({ ...input, version: "stale" })).rejects.toThrow(
    "history changed",
  );
  await gamesApi.editRound(input);
  closeDB();
  const saved = await gamesApi.getView(game.id);
  await expect(gamesApi.editRound(input)).rejects.toThrow("history changed");
  expect(await gamesApi.getView(game.id)).toEqual(saved);
});

it("restores a whole excluded tail after an Active Game correction reverses an earlier ending", async () => {
  const { game, amy, bob, cam, dan } = await createContinuedHistory("fewestWilds");
  // Undo the first finish, then restore the ordinary non-continuing policy in a separate Game.
  const plain = await gamesApi.create({
    players: [amy.id, bob.id, cam.id, dan.id],
    phaseSet: game.phaseSet,
    settings: game.settings,
  });
  for (const round of (await gamesApi.getView(game.id))?.rounds ?? []) {
    await roundsApi.add({
      gameId: plain.id,
      roundWinnerId: round.source.roundNumber === 3 ? null : round.source.roundWinnerId,
      scores: [amy, bob, cam, dan].map((player) => {
        const source = round.source.scores.find((score) => score.playerId === player.id);
        return {
          playerId: player.id,
          score: source?.score ?? 0,
          phaseStatus:
            round.source.roundNumber === 3 && player.id === amy.id
              ? "failed"
              : (source?.phaseStatus ?? "failed"),
        };
      }) as Parameters<typeof roundsApi.add>[0]["scores"],
    });
  }
  const before = await gamesApi.getView(plain.id);
  const editor = await gamesApi.getRoundEditor(plain.id, 1);
  await gamesApi.editRound({
    gameId: plain.id,
    roundNumber: 1,
    version: editor.version,
    roundWinnerId: bob.id,
    confirmImpact: true,
    scores: editor.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" } : score,
    ),
  });
  closeDB();
  const ended = await gamesApi.getView(plain.id);
  expect(ended?.game.status).toBe("active");
  expect(ended?.gameEndingRound).toBe(2);
  expect((await gamesApi.getRoundEditor(plain.id, 4)).countedPlayerIds).toEqual([]);
  expect(ended?.rounds.map((round) => round.counted)).toEqual([true, true, false, false]);
  expect(ended?.rounds.slice(2).map((round) => round.source)).toEqual(
    before?.rounds.slice(2).map((round) => round.source),
  );
  expect(ended?.pendingFinishChoice?.winner.id).toBe(amy.id);
  const current = await gamesApi.getRoundEditor(plain.id, 1);
  await gamesApi.editRound({
    gameId: plain.id,
    roundNumber: 1,
    version: current.version,
    scores: editor.round.scores,
    roundWinnerId: bob.id,
    confirmImpact: true,
  });
  closeDB();
  const restored = await gamesApi.getView(plain.id);
  expect(restored?.rounds.map((round) => round.counted)).toEqual([true, true, true, true]);
  expect(restored?.pendingFinishChoice).toBeNull();
  expect(restored?.nextRoundNumber).toBe(5);
  expect(restored?.players.map((player) => player.tiebreakerTotal)).toEqual(
    before?.players.map((player) => player.tiebreakerTotal),
  );
});

it("returns an unfinished Player to the next Round without fabricating entries in genuine gaps", async () => {
  const { game, amy } = await createContinuedHistory("fewestWilds");
  const editor = await gamesApi.getRoundEditor(game.id, 2);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 2,
    version: editor.version,
    scores: editor.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "failed", score: 3 } : score,
    ),
    roundWinnerId: null,
    confirmImpact: true,
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.players.find((player) => player.id === amy.id)).toMatchObject({
    finishingRound: null,
    tiebreakerTotal: 3,
    progress: { currentPhase: 2, isFinished: false },
  });
  expect(view?.rounds[2].scores[0]).toMatchObject({ counted: true, phaseNumber: 1 });
  expect(view?.rounds[3].scores[0]).toMatchObject({
    source: undefined,
    counted: false,
    tiebreakerValue: 0,
    runningTiebreakerTotal: 3,
  });
  expect(view?.playingPlayers.map((player) => player.id)).toContain(amy.id);
  expect(view?.nextRoundNumber).toBe(5);
});

it("finalizes an automatic completion atomically and protects the reloaded Completed Game", async () => {
  const { amy, bob } = await createGame("fewestWilds");
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: { id: "two", type: "temporary", name: "Two", phases: ["phase-1", "phase-2"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 100, sitOutPenalty: 50 },
  });
  for (const status of ["failed", "completed", "failed"] as const) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: status, score: 1 },
        { playerId: bob.id, phaseStatus: "failed", score: 2 },
      ],
    });
  }
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const result = await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    roundWinnerId: amy.id,
    scores: [{ playerId: amy.id, phaseStatus: "completed", score: 1 }, editor.round.scores[1]],
    confirmImpact: true,
  });
  expect(result.outcome).toBe("gameCompleted");
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.game).toMatchObject({ status: "completed", winnerIds: [amy.id] });
  expect(view?.gameEndingRound).toBe(2);
  expect(view?.rounds.map((round) => round.counted)).toEqual([true, true, false]);
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual([2, 4]);
  await expect(gamesApi.getRoundEditor(game.id, 1)).rejects.toThrow("completed");
  await expect(
    gamesApi.editRound({
      gameId: game.id,
      roundNumber: 1,
      version: editor.version,
      scores: editor.round.scores,
      roundWinnerId: null,
      confirmImpact: true,
    }),
  ).rejects.toThrow("completed");
  expect(await gamesApi.getView(game.id)).toEqual(view);
});

it("keeps legacy Points history read-only rather than inventing original counters", async () => {
  const { game, amy, bob } = await createGame();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 50 },
      { playerId: bob.id, phaseStatus: "failed", score: 55 },
    ],
  });
  const before = await gamesApi.getView(game.id);
  await expect(gamesApi.getRoundEditor(game.id, 1)).rejects.toThrow("Legacy Round");
  expect(await gamesApi.getView(game.id)).toEqual(before);
});

it("rejects invalid counters and penalties without accepting an impact override", async () => {
  const { game, amy, bob } = await createGame();
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
      {
        playerId: bob.id,
        phaseStatus: "failed",
        score: 100,
        pointsCardBreakdown: { p5: 0, p10: 10, skipCard: 0, wild: 0 },
      },
    ],
  });
  const before = await gamesApi.getView(game.id);
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  for (const invalid of [
    { playerId: amy.id, phaseStatus: "skipped" as const, score: 99 },
    { playerId: amy.id, phaseStatus: "satOut" as const, score: 0 },
    {
      playerId: amy.id,
      phaseStatus: "completed" as const,
      score: 55,
      pointsCardBreakdown: { p5: -1, p10: 2, skipCard: 1, wild: 1 },
    },
    { playerId: amy.id, phaseStatus: "completed" as const, score: 55 },
  ]) {
    await expect(
      gamesApi.editRound({
        gameId: game.id,
        roundNumber: 1,
        version: editor.version,
        confirmImpact: true,
        scores: [invalid, editor.round.scores[1]],
        roundWinnerId: null,
      }),
    ).rejects.toThrow();
    closeDB();
    expect(await gamesApi.getView(game.id)).toEqual(before);
  }
});

it("rolls back a failed Game write and accepts the same recoverable correction afterward", async () => {
  const { game } = await createContinuedHistory();
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const before = await gamesApi.getView(game.id);
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    scores: editor.round.scores,
    roundWinnerId: editor.round.roundWinnerId,
  };
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
    await expect(gamesApi.editRound(input)).rejects.toThrow("Storage unavailable");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await gamesApi.editRound(input);
  closeDB();
  expect((await gamesApi.getRoundEditor(game.id, 1)).version).not.toBe(editor.version);
});

it.each([
  "fewestWilds",
  "fewestSkips",
  "mostSkipped",
] as const)("restores recorded %s event values without adding card counters or warning for totals alone", async (tiebreaker) => {
  const { game, amy, bob } = await createGame(tiebreaker);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 3 },
      { playerId: bob.id, phaseStatus: "failed", score: 4 },
    ],
  });
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    roundWinnerId: amy.id,
    scores: [{ ...editor.round.scores[0], score: 2 }, editor.round.scores[1]],
  };
  expect(await gamesApi.previewRoundEdit(input)).toEqual({ requiresConfirmation: false });
  await gamesApi.editRound(input);
  closeDB();
  const saved = await gamesApi.getRoundEditor(game.id, 1);
  expect(saved.round.scores[0].score).toBe(2);
  expect(saved.round.scores[0].pointsCardBreakdown).toBeUndefined();
  expect((await gamesApi.getView(game.id))?.players[0].tiebreakerTotal).toBe(2);
});

it("does not warn merely because an unchanged historical winner is already excluded", async () => {
  const { game, amy } = await createContinuedHistory();
  const first = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 1,
    version: first.version,
    roundWinnerId: first.round.roundWinnerId,
    confirmImpact: true,
    scores: first.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" } : score,
    ),
  });
  const editor = await gamesApi.getRoundEditor(game.id, 3);
  const input = {
    gameId: game.id,
    roundNumber: 3,
    version: editor.version,
    scores: editor.round.scores,
    roundWinnerId: amy.id,
  };
  expect(await gamesApi.previewRoundEdit(input)).toEqual({ requiresConfirmation: false });
  await gamesApi.editRound(input);
  closeDB();
  expect((await gamesApi.getView(game.id))?.players[0].tiebreakerTotal).toBe(1);
});

async function createContinuedHistory(tiebreaker: GameTiebreaker = "roundsWon") {
  const { amy, bob } = await createGame();
  const cam = await playersApi.create({ name: "Cam", color: "Grass", isFavorite: 0 });
  const dan = await playersApi.create({ name: "Dan", color: "Ocean", isFavorite: 0 });
  const players = [amy, bob, cam, dan];
  const game = await gamesApi.create({
    players: [amy.id, bob.id, cam.id, dan.id],
    phaseSet: { id: "two", type: "temporary", name: "Two", phases: ["phase-1", "phase-2"] },
    settings: { tiebreaker, roundSkipPenalty: 100, sitOutPenalty: 50 },
  });
  for (const winner of [bob, amy, amy]) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: winner.id,
      scores: players.map((player) => ({
        playerId: player.id,
        phaseStatus: player.id === winner.id ? "completed" : "failed",
        score: 0,
      })) as Parameters<typeof roundsApi.add>[0]["scores"],
    });
  }
  const pending = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!pending) throw new Error("Expected first-finisher choice.");
  await gamesApi.resolveFinishChoice(game.id, "continue", pending.token);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: cam.id,
    scores: [bob, cam, dan].map((player) => ({
      playerId: player.id,
      phaseStatus: player.id === cam.id ? "completed" : "failed",
      score: 0,
    })) as Parameters<typeof roundsApi.add>[0]["scores"],
  });
  return { game, amy, bob, cam, dan };
}

async function createGame(tiebreaker: GameTiebreaker = "lowestPoints") {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "three",
      type: "temporary",
      name: "Three",
      phases: ["phase-1", "phase-2", "phase-3"],
    },
    settings: { tiebreaker, roundSkipPenalty: 100, sitOutPenalty: 50 },
  });
  return { game, amy, bob };
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
