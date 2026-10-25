import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

async function resetDatabase() {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
}

beforeEach(resetDatabase);
afterEach(resetDatabase);

async function setup(initialPlayers = 2) {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await gamesApi.create({
    players: initialPlayers === 3 ? [amy.id, bob.id, cam.id] : [amy.id, bob.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["classic-1", "classic-2", "classic-3"],
    },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  return { game, amy, bob, cam };
}

it("saves a prospective seat with zero progress and totals, blank earlier cells and continuous dealing", async () => {
  const { game, amy, bob, cam } = await setup();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 2 },
      { playerId: bob.id, phaseStatus: "failed", score: 3 },
    ],
  });
  const history = await roundsApi.getByGameId(game.id);
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [amy.id, cam.id, bob.id],
  };
  expect(await gamesApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await expect(gamesApi.edit(input)).rejects.toThrow("Confirm");
  expect(await gamesApi.getById(game.id)).toEqual(editor.game);
  await gamesApi.edit({ ...input, confirmImpact: true });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.players.map(({ id }) => id)).toEqual(input.players);
  expect(
    view?.players.map(({ progress, tiebreakerTotal }) => [progress.currentPhase, tiebreakerTotal]),
  ).toEqual([
    [2, 2],
    [1, 0],
    [1, 3],
  ]);
  expect(view?.rounds[0].scores[1].source).toBeUndefined();
  expect(view?.rounds[0].dealerId).toBe(amy.id);
  expect(view?.upcomingDealerId).toBe(cam.id);
  expect(view?.playingPlayers.map(({ id }) => id)).toEqual(input.players);
  expect(await roundsApi.getByGameId(game.id)).toEqual(history);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: cam.id,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 1 },
      { playerId: cam.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 2 },
    ],
  });
  closeDB();
  const saved = await gamesApi.getView(game.id);
  expect(saved?.rounds[1].dealerId).toBe(cam.id);
  expect(saved?.players[1]).toMatchObject({ progress: { currentPhase: 2 }, tiebreakerTotal: 0 });
  expect(saved?.upcomingDealerId).toBe(bob.id);
});

it("uses historical membership for automatic completion and retains the late Join and excluded source entries", async () => {
  const { game, amy, bob, cam } = await setup();
  for (let number = 1; number <= 3; number++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: number === 1 ? "failed" : "completed", score: 1 },
        { playerId: bob.id, phaseStatus: "failed", score: 2 },
      ],
    });
  }
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  await gamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: [...game.players, cam.id],
    confirmImpact: true,
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 1 },
      { playerId: bob.id, phaseStatus: "failed", score: 2 },
      { playerId: cam.id, phaseStatus: "completed", score: 3 },
    ],
  });
  const history = await roundsApi.getByGameId(game.id);
  const round = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 1,
    version: round.version,
    roundWinnerId: null,
    scores: round.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" as const } : score,
    ),
    confirmImpact: true,
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.automaticCompletion).toBe(true);
  expect(view?.game).toMatchObject({
    status: "completed",
    winnerIds: [amy.id],
    players: [...game.players, cam.id],
    playerJoins: [{ playerId: cam.id, afterRoundNumber: 3 }],
  });
  expect(view?.gameEndingRound).toBe(3);
  expect(view?.players[2]).toMatchObject({
    place: null,
    tiebreakerTotal: 0,
    progress: { currentPhase: 1, isFinished: false },
  });
  expect(view?.standings.rows.map(({ player, place }) => [player.id, place])).toEqual([
    [amy.id, 1],
    [bob.id, 2],
    [cam.id, null],
  ]);
  expect(view?.rounds[3]).toMatchObject({
    counted: false,
    source: history[3],
    scores: [{ counted: false }, { counted: false }, { counted: false }],
  });
  expect(view?.standings.phaseGraphSeries[2].points).toEqual([]);
});

it("restores a retained late Join and its exact source results when another correction extends counted history", async () => {
  const { game, amy, bob, cam } = await setup(3);
  const dora = await playersApi.create({ name: "Dora", color: "Jam", isFavorite: 0 });
  for (let number = 1; number <= 3; number++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: number === 1 ? "failed" : "completed", score: 1 },
        { playerId: bob.id, phaseStatus: "failed", score: 2 },
        { playerId: cam.id, phaseStatus: "failed", score: 0 },
      ],
    });
  }
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  await gamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: [dora.id, ...game.players],
    confirmImpact: true,
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: dora.id,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 1 },
      { playerId: bob.id, phaseStatus: "failed", score: 2 },
      { playerId: cam.id, phaseStatus: "failed", score: 0 },
      { playerId: dora.id, phaseStatus: "completed", score: 4 },
    ],
  });
  const before = await gamesApi.getView(game.id);
  const original = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 1,
    version: original.version,
    roundWinnerId: null,
    confirmImpact: true,
    scores: original.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" as const } : score,
    ),
  });
  closeDB();
  const corrected = await gamesApi.getView(game.id);
  expect(corrected?.game.status).toBe("active");
  expect(corrected?.gameEndingRound).toBe(3);
  expect(corrected?.players[0]).toMatchObject({ id: dora.id, place: null, tiebreakerTotal: 0 });
  expect(corrected?.rounds[3].source).toEqual(before?.rounds[3].source);
  expect(corrected?.rounds[3].scores.every((score) => !score.counted)).toBe(true);
  const fresh = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 1,
    version: fresh.version,
    roundWinnerId: null,
    confirmImpact: true,
    scores: original.round.scores,
  });
  closeDB();
  const restored = await gamesApi.getView(game.id);
  expect(restored?.gameEndingRound).toBeNull();
  expect(restored?.players[0]).toMatchObject({
    id: dora.id,
    place: 2,
    tiebreakerTotal: 4,
    progress: { currentPhase: 2 },
  });
  expect(restored?.rounds[3].source).toEqual(before?.rounds[3].source);
  expect(restored?.rounds[3].scores.every((score) => score.counted)).toBe(true);
  expect(restored?.rounds.map(({ dealerId }) => dealerId)).toEqual([
    amy.id,
    bob.id,
    cam.id,
    dora.id,
  ]);
  expect(restored?.standings.tiebreakerGraphSeries[0].points).toEqual([
    { roundNumber: 3, value: 0, standingValue: 0 },
    { roundNumber: 4, value: 4, standingValue: -4 },
  ]);
});

it("locks every saved seat, rejects invalid and duplicate saves atomically, and does not backdate an empty Game Join", async () => {
  const { game, amy, bob, cam } = await setup();
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = { gameId: game.id, version: editor.version, players: [cam.id, amy.id, bob.id] };
  for (const players of [
    [],
    [amy.id],
    [bob.id, amy.id, cam.id],
    [amy.id, bob.id, bob.id],
    [...game.players, "missing"],
  ]) {
    await expect(gamesApi.previewEdit({ ...input, players })).rejects.toThrow();
    await expect(gamesApi.edit({ ...input, players })).rejects.toThrow();
    closeDB();
    expect(await gamesApi.getById(game.id)).toEqual(game);
  }
  expect(await gamesApi.previewEdit(input)).toEqual({ requiresConfirmation: false });
  const outcomes = await Promise.allSettled([gamesApi.edit(input), gamesApi.edit(input)]);
  expect(outcomes.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
  closeDB();
  const saved = await gamesApi.getEditor(game.id);
  expect(saved?.game).toMatchObject({
    players: input.players,
    playerJoins: [{ playerId: cam.id, afterRoundNumber: 0 }],
  });
  expect((await gamesApi.getView(game.id))?.upcomingDealerId).toBe(cam.id);
  const dora = await playersApi.create({ name: "Dora", color: "Jam", isFavorite: 0 });
  if (!saved) throw new Error("Missing Game editor");
  await expect(
    gamesApi.edit({
      gameId: game.id,
      version: saved.version,
      players: [amy.id, cam.id, bob.id, dora.id],
    }),
  ).rejects.toThrow("Seating Order");
  expect(await gamesApi.getById(game.id)).toEqual(saved.game);
});

it("rejects stale history, rolls back failed storage and preserves a retryable Join", async () => {
  const { game, cam } = await setup();
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [...game.players, cam.id],
    confirmImpact: true,
  };
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: game.players[0], phaseStatus: "failed", score: 1 },
      { playerId: game.players[1], phaseStatus: "failed", score: 2 },
    ],
  });
  await expect(gamesApi.edit(input)).rejects.toThrow("history changed");
  const fresh = await gamesApi.getEditor(game.id);
  if (!fresh) throw new Error("Missing Game editor");
  const before = await gamesApi.getView(game.id);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (value?.id === game.id) {
      throw new DOMException("Membership storage unavailable", "QuotaExceededError");
    }
    return put.call(this, value, key);
  });
  await expect(gamesApi.edit({ ...input, version: fresh.version })).rejects.toThrow(
    "Membership storage unavailable",
  );
  vi.restoreAllMocks();
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await gamesApi.edit({ ...input, version: fresh.version });
  closeDB();
  expect((await gamesApi.getById(game.id))?.players).toEqual(input.players);
});

it("keeps Finished Players out of new Rounds and dealing after a Join, without reopening a reached finish", async () => {
  const { game, amy, bob, cam } = await setup(3);
  for (let number = 1; number <= 3; number++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: amy.id,
      scores: [
        { playerId: amy.id, phaseStatus: "completed", score: 1 },
        { playerId: bob.id, phaseStatus: "failed", score: 2 },
        { playerId: cam.id, phaseStatus: "failed", score: 0 },
      ],
    });
  }
  const dora = await playersApi.create({ name: "Dora", color: "Jam", isFavorite: 0 });
  const pending = await gamesApi.getEditor(game.id);
  if (!pending) throw new Error("Missing Game editor");
  await expect(
    gamesApi.edit({
      gameId: game.id,
      version: pending.version,
      players: [...game.players, dora.id],
      confirmImpact: true,
    }),
  ).rejects.toThrow("Finish Game");
  const choice = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!choice) throw new Error("Missing Finish Game choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", choice.token);
  const continued = await gamesApi.getEditor(game.id);
  if (!continued) throw new Error("Missing Game editor");
  await gamesApi.edit({
    gameId: game.id,
    version: continued.version,
    players: [...game.players, dora.id],
    confirmImpact: true,
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.players[0]).toMatchObject({
    finishingRound: 3,
    finishingPlace: 1,
    tiebreakerTotal: 3,
  });
  expect(view?.playingPlayers.map(({ id }) => id)).toEqual([bob.id, cam.id, dora.id]);
  expect(view?.upcomingDealerId).toBe(dora.id);
  const ending = await gamesApi.finish(game.id);
  await expect(
    gamesApi.edit({
      gameId: game.id,
      version: continued.version,
      players: [...game.players, dora.id],
      confirmImpact: true,
    }),
  ).rejects.toThrow("completed");
  expect(await gamesApi.getById(game.id)).toEqual(ending);
});

it.each([
  "latest",
  "all",
] as const)("preserves prospective Join eligibility when deleting %s history and recording replacement play", async (deletion) => {
  const { game, amy, bob, cam } = await setup();
  for (let number = 1; number <= 2; number++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: "failed", score: 1 },
        { playerId: bob.id, phaseStatus: "failed", score: 2 },
      ],
    });
  }
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  await gamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: [amy.id, cam.id, bob.id],
    confirmImpact: true,
  });
  if (deletion === "latest") await roundsApi.delete(game.id, 2);
  else await roundsApi.deleteByGameId(game.id);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: cam.id,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 1 },
      { playerId: cam.id, phaseStatus: "completed", score: 3 },
      { playerId: bob.id, phaseStatus: "failed", score: 2 },
    ],
  });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.players[1]).toMatchObject({
    id: cam.id,
    progress: { currentPhase: 2 },
    tiebreakerTotal: 3,
  });
  expect(view?.rounds.at(-1)?.scores[1].counted).toBe(true);
  expect(view?.rounds.at(-1)?.dealerId).toBe(deletion === "latest" ? cam.id : amy.id);
  expect(view?.game.playerJoins).toEqual([
    { playerId: cam.id, afterRoundNumber: deletion === "latest" ? 1 : 0 },
  ]);
});
