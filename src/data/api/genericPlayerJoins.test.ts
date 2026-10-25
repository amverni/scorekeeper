import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GenericGameSettings } from "../../types";
import { closeDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

async function resetDatabase() {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
}

beforeEach(resetDatabase);
afterEach(resetDatabase);

async function setup(settings: GenericGameSettings) {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await genericGamesApi.create({ players: [amy.id, bob.id], settings });
  return { game, amy, bob, cam };
}

const pointsSettings: GenericGameSettings[] = [
  { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  { mode: "points", pointsDirection: "low", tiebreaker: null, dealer: true },
  ...(["high", "low"] as const).flatMap((pointsDirection) =>
    (["high", "low"] as const).map((direction) => ({
      mode: "points" as const,
      pointsDirection,
      tiebreaker: { direction },
      dealer: true,
    })),
  ),
];

it("inserts new seats among saved Players and locks them before any Round is recorded", async () => {
  const { game, amy, bob, cam } = await setup({
    mode: "points",
    pointsDirection: "high",
    tiebreaker: null,
    dealer: true,
  });
  const dora = await playersApi.create({ name: "Dora", color: "Ocean", isFavorite: 0 });
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [cam.id, amy.id, dora.id, bob.id],
  };
  expect(await genericGamesApi.previewEdit(input)).toEqual({ requiresConfirmation: false });
  await genericGamesApi.edit(input);
  closeDB();
  const saved = await genericGamesApi.getEditor(game.id);
  expect(saved?.players.map(({ id }) => id)).toEqual([cam.id, amy.id, dora.id, bob.id]);
  expect(saved?.game.playerJoins).toEqual([
    { playerId: cam.id, afterRoundNumber: 0 },
    { playerId: dora.id, afterRoundNumber: 0 },
  ]);
  expect((await genericGamesApi.getScoreboard(game.id))?.upcomingDealerId).toBe(cam.id);
  expect((await genericGamesApi.getScoreboard(game.id))?.players.map(({ id }) => id)).toEqual(
    input.players,
  );
  const eli = await playersApi.create({ name: "Eli", color: "Jam", isFavorite: 0 });
  if (!saved) throw new Error("Missing saved Game editor");
  for (const players of [
    [amy.id, cam.id, dora.id, bob.id, eli.id],
    [cam.id, dora.id, amy.id, bob.id, eli.id],
    [cam.id, amy.id, bob.id, eli.id],
  ]) {
    const invalid = { gameId: game.id, version: saved.version, players };
    await expect(genericGamesApi.previewEdit(invalid)).rejects.toThrow("Seating Order");
    await expect(genericGamesApi.edit(invalid)).rejects.toThrow("Seating Order");
    closeDB();
    expect(await genericGamesApi.getById(game.id)).toEqual(saved.game);
  }
});

it.each([
  "points",
  "singleRoundWinner",
  "passFail",
] as const)("uses inserted Seating Order for %s without changing earlier Rounds or breaking shared ties", async (mode) => {
  const { game, amy, bob, cam } = await setup(
    mode === "points"
      ? { mode, pointsDirection: "high", tiebreaker: null, dealer: true }
      : { mode, tiebreaker: null, dealer: true },
  );
  await genericRoundsApi.add(
    mode === "points"
      ? {
          gameId: game.id,
          mode,
          scores: [
            { playerId: amy.id, points: "0" },
            { playerId: bob.id, points: "0" },
          ],
        }
      : mode === "passFail"
        ? {
            gameId: game.id,
            mode,
            scores: [
              { playerId: amy.id, passed: false },
              { playerId: bob.id, passed: false },
            ],
          }
        : {
            gameId: game.id,
            mode,
            scores: [
              { playerId: amy.id, won: true },
              { playerId: bob.id, won: false },
            ],
          },
  );
  const history = await genericRoundsApi.getByGameId(game.id);
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [amy.id, cam.id, bob.id],
  };
  expect(await genericGamesApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await expect(genericGamesApi.edit(input)).rejects.toThrow("Confirm");
  expect(await genericGamesApi.getById(game.id)).toEqual(editor.game);
  await genericGamesApi.edit({ ...input, confirmImpact: true });
  closeDB();
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.players.map(({ id }) => id)).toEqual([amy.id, cam.id, bob.id]);
  expect(view?.rounds[0].scores.map(({ playerId }) => playerId)).toEqual([amy.id, bob.id]);
  expect(view?.rounds[0].dealerId).toBe(amy.id);
  expect(view?.upcomingDealerId).toBe(cam.id);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual(history);
  expect(view?.standings.map(({ player, place }) => [player.id, place])).toEqual(
    mode === "singleRoundWinner"
      ? [
          [amy.id, 1],
          [cam.id, 2],
          [bob.id, 2],
        ]
      : [
          [amy.id, 1],
          [cam.id, 1],
          [bob.id, 1],
        ],
  );
  const finished = await genericGamesApi.finish(game.id);
  closeDB();
  expect((await genericGamesApi.getById(game.id))?.players).toEqual(input.players);
  expect(finished.winnerIds).toEqual(
    mode === "singleRoundWinner" ? [amy.id] : [amy.id, cam.id, bob.id],
  );
});

it.each(
  pointsSettings,
)("keeps Points directions, optional Tiebreakers and shared wins correct after Join: %j", async (settings) => {
  const { game, amy, bob, cam } = await setup(settings);
  if (settings.mode !== "points") throw new Error("Expected Points settings");
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [
      { playerId: amy.id, points: "10", tiebreaker: "5" },
      { playerId: bob.id, points: "-3", tiebreaker: "-1" },
    ],
  });
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  await genericGamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: [...game.players, cam.id],
    confirmImpact: true,
  });
  closeDB();
  let view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.standings.map(({ player }) => player.id)).toEqual(
    settings.pointsDirection === "high" ? [amy.id, cam.id, bob.id] : [bob.id, cam.id, amy.id],
  );
  const second = await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [
      { playerId: amy.id, points: "-2", tiebreaker: "-3" },
      { playerId: bob.id, points: "11", tiebreaker: "5" },
      { playerId: cam.id, points: "8", tiebreaker: "2" },
    ],
  });
  closeDB();
  view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.standings.map(({ player, place }) => [player.id, place])).toEqual(
    !settings.tiebreaker
      ? [
          [amy.id, 1],
          [bob.id, 1],
          [cam.id, 1],
        ]
      : settings.tiebreaker.direction === "high"
        ? [
            [bob.id, 1],
            [amy.id, 2],
            [cam.id, 2],
          ]
        : [
            [amy.id, 1],
            [cam.id, 1],
            [bob.id, 3],
          ],
  );
  expect(view?.primaryGraph.series[2].points).toEqual([
    { roundNumber: 1, value: 0 },
    { roundNumber: 2, value: 8 },
  ]);
  if (!second.id) throw new Error("Missing Round identity");
  const roundEditor = await genericRoundsApi.getEditor(game.id, second.id);
  await genericRoundsApi.edit({
    gameId: game.id,
    roundId: second.id,
    version: roundEditor.version,
    mode: "points",
    confirmImpact: true,
    scores: [
      { playerId: amy.id, points: "-2", tiebreaker: "-3" },
      { playerId: bob.id, points: "11", tiebreaker: "3" },
      { playerId: cam.id, points: "8", tiebreaker: "2" },
    ],
  });
  const completed = await genericGamesApi.finish(game.id);
  closeDB();
  expect((await genericGamesApi.getById(game.id))?.status).toBe("completed");
  expect(completed.winnerIds).toEqual([amy.id, bob.id, cam.id]);
});

it.each([
  "singleRoundWinner",
  "passFail",
] as const)("keeps historical %s outcomes, shared places and final wins correct after Join", async (mode) => {
  const { game, amy, bob, cam } = await setup({ mode, tiebreaker: null, dealer: true });
  const first = await genericRoundsApi.add(
    mode === "passFail"
      ? {
          gameId: game.id,
          mode,
          scores: [
            { playerId: amy.id, passed: true },
            { playerId: bob.id, passed: false },
          ],
        }
      : {
          gameId: game.id,
          mode,
          scores: [
            { playerId: amy.id, won: true },
            { playerId: bob.id, won: false },
          ],
        },
  );
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor || !first.id) throw new Error("Missing editor or Round");
  await genericGamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: [...game.players, cam.id],
    confirmImpact: true,
  });
  const historical = await genericRoundsApi.getEditor(game.id, first.id);
  expect(historical.players.map(({ id }) => id)).toEqual([amy.id, bob.id]);
  await genericRoundsApi.edit(
    mode === "passFail"
      ? {
          gameId: game.id,
          roundId: first.id,
          version: historical.version,
          mode,
          scores: [
            { playerId: amy.id, passed: true },
            { playerId: bob.id, passed: false },
          ],
        }
      : {
          gameId: game.id,
          roundId: first.id,
          version: historical.version,
          mode,
          scores: [
            { playerId: amy.id, won: true },
            { playerId: bob.id, won: false },
          ],
        },
  );
  await genericRoundsApi.add(
    mode === "passFail"
      ? {
          gameId: game.id,
          mode,
          scores: [
            { playerId: amy.id, passed: false },
            { playerId: bob.id, passed: true },
            { playerId: cam.id, passed: true },
          ],
        }
      : {
          gameId: game.id,
          mode,
          scores: [
            { playerId: amy.id, won: false },
            { playerId: bob.id, won: false },
            { playerId: cam.id, won: true },
          ],
        },
  );
  closeDB();
  expect(
    (await genericGamesApi.getScoreboard(game.id))?.standings.map(({ player, place }) => [
      player.id,
      place,
    ]),
  ).toEqual(
    mode === "passFail"
      ? [
          [amy.id, 1],
          [bob.id, 1],
          [cam.id, 1],
        ]
      : [
          [amy.id, 1],
          [cam.id, 1],
          [bob.id, 3],
        ],
  );
  expect((await genericGamesApi.finish(game.id)).winnerIds).toEqual(
    mode === "passFail" ? [amy.id, bob.id, cam.id] : [amy.id, cam.id],
  );
});

it("preserves actual participation across deleting and renumbering Rounds, including deleting all history", async () => {
  const { game, amy, bob, cam } = await setup({
    mode: "points",
    pointsDirection: "high",
    tiebreaker: null,
    dealer: true,
  });
  const add = (ids: string[], points: string) =>
    genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: ids.map((playerId) => ({ playerId, points })),
    });
  const first = await add(game.players, "2");
  const second = await add(game.players, "3");
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  await genericGamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: [...game.players, cam.id],
    confirmImpact: true,
  });
  const third = await add([...game.players, cam.id], "7");
  async function remove(id: string | undefined) {
    if (!id) throw new Error("Missing Round identity");
    const editor = await genericRoundsApi.getEditor(game.id, id);
    await genericRoundsApi.delete({ gameId: game.id, roundId: id, version: editor.version });
    closeDB();
  }
  await remove(second.id);
  const old = await genericRoundsApi.getEditor(game.id, first.id ?? "");
  expect(old.players.map(({ id }) => id)).toEqual([amy.id, bob.id]);
  await genericRoundsApi.edit({
    gameId: game.id,
    roundId: old.round.id,
    version: old.version,
    confirmImpact: true,
    mode: "points",
    scores: [
      { playerId: amy.id, points: "1" },
      { playerId: bob.id, points: "2" },
    ],
  });
  let view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.rounds.map(({ scores }) => scores.map(({ playerId }) => playerId))).toEqual([
    game.players,
    [...game.players, cam.id],
  ]);
  expect(view?.players[2]).toMatchObject({ totalPoints: 7 });
  await remove(first.id);
  view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.rounds).toMatchObject([
    {
      roundNumber: 1,
      id: third.id,
      scores: [{ totalPoints: 7 }, { totalPoints: 7 }, { totalPoints: 7 }],
    },
  ]);
  await remove(third.id);
  expect((await genericGamesApi.getScoreboard(game.id))?.game.players).toEqual([
    ...game.players,
    cam.id,
  ]);
  await add([...game.players, cam.id], "0");
  expect((await genericGamesApi.getScoreboard(game.id))?.rounds).toHaveLength(1);
});

it("rejects invalid, unavailable, stale and duplicate roster saves atomically", async () => {
  const { game, amy, bob, cam } = await setup({
    mode: "points",
    pointsDirection: "high",
    tiebreaker: null,
    dealer: false,
  });
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = { gameId: game.id, version: editor.version, players: [amy.id, cam.id, bob.id] };
  for (const ids of [
    [],
    [amy.id],
    [bob.id, amy.id, cam.id],
    [amy.id, bob.id, bob.id],
    [...game.players, "missing"],
  ]) {
    await expect(genericGamesApi.edit({ ...input, players: ids })).rejects.toThrow();
    closeDB();
    expect(await genericGamesApi.getById(game.id)).toEqual(game);
  }
  expect(await genericGamesApi.previewEdit(input)).toEqual({ requiresConfirmation: false });
  const outcomes = await Promise.allSettled([
    genericGamesApi.edit(input),
    genericGamesApi.edit(input),
  ]);
  expect(outcomes.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
  closeDB();
  const saved = await genericGamesApi.getById(game.id);
  await expect(genericGamesApi.edit(input)).rejects.toThrow("history changed");
  expect(saved?.players).toEqual([amy.id, cam.id, bob.id]);
  expect(await genericGamesApi.getById(game.id)).toEqual(saved);
  expect(await genericGamesApi.getEditor("missing")).toBeNull();
});

it("rejects a stale Join after history changes and rolls back a failed write for retry", async () => {
  const { game, cam } = await setup({
    mode: "points",
    pointsDirection: "high",
    tiebreaker: null,
    dealer: true,
  });
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [cam.id, ...game.players],
    confirmImpact: true,
  };
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: game.players.map((playerId) => ({ playerId, points: "2" })),
  });
  await expect(genericGamesApi.edit(input)).rejects.toThrow("history changed");
  const fresh = await genericGamesApi.getEditor(game.id);
  if (!fresh) throw new Error("Missing Game editor");
  const before = await genericGamesApi.getScoreboard(game.id);
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
  await expect(genericGamesApi.edit({ ...input, version: fresh.version })).rejects.toThrow(
    "Membership storage unavailable",
  );
  vi.restoreAllMocks();
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  await genericGamesApi.edit({ ...input, version: fresh.version });
  closeDB();
  expect((await genericGamesApi.getById(game.id))?.players).toEqual([cam.id, ...game.players]);
});
it("joins next Round without backfilling Points or restarting dealing, and survives reload", async () => {
  const { game, amy, bob, cam } = await setup({
    mode: "points",
    pointsDirection: "low",
    tiebreaker: { direction: "high" },
    dealer: true,
  });
  for (let index = 0; index < 2; index++) {
    await genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: [
        { playerId: amy.id, points: "5", tiebreaker: "2" },
        { playerId: bob.id, points: "3", tiebreaker: "4" },
      ],
    });
  }
  const history = await genericRoundsApi.getByGameId(game.id);
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [amy.id, bob.id, cam.id],
  };
  expect(await genericGamesApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await expect(genericGamesApi.edit(input)).rejects.toThrow("Confirm");
  expect(await genericGamesApi.getById(game.id)).toEqual(editor.game);
  await genericGamesApi.edit({ ...input, confirmImpact: true });
  closeDB();
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.players).toEqual([
    { id: amy.id, name: "Amy", color: "Jam", totalPoints: 10, totalTiebreaker: 4 },
    { id: bob.id, name: "Bob", color: "Ocean", totalPoints: 6, totalTiebreaker: 8 },
    { id: cam.id, name: "Cam", color: "Lime", totalPoints: 0, totalTiebreaker: 0 },
  ]);
  expect(view?.standings.map(({ player, place }) => [player.id, place])).toEqual([
    [cam.id, 1],
    [bob.id, 2],
    [amy.id, 3],
  ]);
  expect(view?.rounds.map(({ dealerId }) => dealerId)).toEqual([amy.id, bob.id]);
  expect(view?.upcomingDealerId).toBe(cam.id);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual(history);
  const oldRound = history[0];
  if (!oldRound.id) throw new Error("Missing Round identity");
  expect(
    (await genericRoundsApi.getEditor(game.id, oldRound.id)).players.map(({ id }) => id),
  ).toEqual([amy.id, bob.id]);
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [
      { playerId: amy.id, points: "0", tiebreaker: "0" },
      { playerId: bob.id, points: "0", tiebreaker: "0" },
      { playerId: cam.id, points: "7", tiebreaker: "9" },
    ],
  });
  closeDB();
  expect((await genericGamesApi.getScoreboard(game.id))?.upcomingDealerId).toBe(amy.id);
});
