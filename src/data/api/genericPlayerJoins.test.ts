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

async function setup(settings: GenericGameSettings, withCam = false) {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: withCam ? [amy.id, bob.id, cam.id] : [amy.id, bob.id],
    settings,
  });
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

it("withdraws and rejoins a saved member before any Round without losing their seat or profile", async () => {
  const { amy, bob, cam } = await setup({
    mode: "points",
    pointsDirection: "high",
    tiebreaker: null,
    dealer: true,
  });
  const game = await genericGamesApi.create({
    players: [amy.id, bob.id, cam.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: true },
  });
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const withdrawal = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    withdrawnPlayers: [amy.id],
  };
  expect(await genericGamesApi.previewEdit(withdrawal)).toEqual({ requiresConfirmation: false });
  await genericGamesApi.edit(withdrawal);
  closeDB();
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.players.map(({ id }) => id)).toEqual(game.players);
  expect(view?.standings.map(({ player, place }) => [player.id, place])).toEqual([
    [bob.id, 1],
    [cam.id, 1],
    [amy.id, null],
  ]);
  expect(view?.upcomingDealerId).toBe(bob.id);
  expect(await playersApi.getById(amy.id)).toEqual(amy);
  const returning = await genericGamesApi.getEditor(game.id);
  if (!returning) throw new Error("Missing Game editor");
  await genericGamesApi.edit({
    ...withdrawal,
    version: returning.version,
    withdrawnPlayers: [],
  });
  closeDB();
  const restored = await genericGamesApi.getScoreboard(game.id);
  expect(restored?.players.map(({ id }) => id)).toEqual(game.players);
  expect(restored?.standings.map(({ player, place }) => [player.id, place])).toEqual([
    [amy.id, 1],
    [bob.id, 1],
    [cam.id, 1],
  ]);
  expect(restored?.upcomingDealerId).toBe(amy.id);
});

it.each([
  ...pointsSettings,
  { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  { mode: "passFail", tiebreaker: null, dealer: true },
] satisfies GenericGameSettings[])("preserves actual history, totals, shared wins and dealing through multiple absences: %j", async (settings) => {
  const { game, amy, bob, cam } = await setup(settings, true);
  async function membership(withdrawnPlayers: string[]) {
    const editor = await genericGamesApi.getEditor(game.id);
    if (!editor) throw new Error("Missing Game editor");
    const input = {
      gameId: game.id,
      version: editor.version,
      players: game.players,
      withdrawnPlayers,
    };
    const before = await genericRoundsApi.getByGameId(game.id);
    expect(await genericGamesApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
    await expect(genericGamesApi.edit(input)).rejects.toThrow("Confirm");
    await genericGamesApi.edit({ ...input, confirmImpact: true });
    closeDB();
    expect(await genericRoundsApi.getByGameId(game.id)).toEqual(before);
  }
  function add(ids: string[], points: number[], winnerId: string, tiebreakers: number[]) {
    return genericRoundsApi.add(
      settings.mode === "points"
        ? {
            gameId: game.id,
            mode: "points",
            scores: ids.map((playerId, index) => ({
              playerId,
              points: String(points[index]),
              tiebreaker: String(tiebreakers[index]),
            })),
          }
        : settings.mode === "passFail"
          ? {
              gameId: game.id,
              mode: "passFail",
              scores: ids.map((playerId) => ({ playerId, passed: playerId === winnerId })),
            }
          : {
              gameId: game.id,
              mode: "singleRoundWinner",
              scores: ids.map((playerId) => ({ playerId, won: playerId === winnerId })),
            },
    );
  }
  const first = await add(game.players, [10, 2, 2], amy.id, [2, 1, 1]);
  await membership([amy.id]);
  expect((await genericGamesApi.getScoreboard(game.id))?.standings.at(-1)).toMatchObject({
    player: { id: amy.id },
    place: null,
    ...(settings.mode === "points"
      ? { totalPoints: 10 }
      : settings.mode === "passFail"
        ? { totalPasses: 1 }
        : { totalWins: 1 }),
  });
  const second = await add([bob.id, cam.id], [3, 3], bob.id, [1, 1]);
  await membership([]);
  await add(game.players, [-5, 0, 0], cam.id, [0, 0, 0]);
  await membership([bob.id]);
  await add([amy.id, cam.id], [0, 0], amy.id, [0, 0]);
  await membership([]);
  await add(game.players, [0, 0, 0], bob.id, [0, 0, 0]);
  closeDB();
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.players.map(({ id }) => id)).toEqual(game.players);
  expect(view?.rounds.map(({ scores }) => scores.map(({ playerId }) => playerId))).toEqual([
    game.players,
    [bob.id, cam.id],
    game.players,
    [amy.id, cam.id],
    game.players,
  ]);
  expect(view?.rounds.map(({ dealerId }) => dealerId)).toEqual(
    settings.dealer ? [amy.id, bob.id, cam.id, amy.id, bob.id] : [null, null, null, null, null],
  );
  expect(view?.primaryGraph.series[0].points).toEqual(
    settings.mode === "points"
      ? [
          { roundNumber: 0, value: 0 },
          { roundNumber: 1, value: 10 },
          { roundNumber: 3, value: 5 },
          { roundNumber: 4, value: 5 },
          { roundNumber: 5, value: 5 },
        ]
      : [
          { roundNumber: 0, value: 0 },
          { roundNumber: 1, value: 1 },
          { roundNumber: 3, value: 1 },
          { roundNumber: 4, value: 2 },
          { roundNumber: 5, value: 2 },
        ],
  );
  if (settings.mode === "points" && settings.tiebreaker) {
    expect(
      view?.players.map((player) => "totalTiebreaker" in player && player.totalTiebreaker),
    ).toEqual([2, 2, 2]);
  }
  if (!first.id || !second.id) throw new Error("Missing Round identity");
  expect((await genericRoundsApi.getEditor(game.id, first.id)).players.map(({ id }) => id)).toEqual(
    game.players,
  );
  expect(
    (await genericRoundsApi.getEditor(game.id, second.id)).players.map(({ id }) => id),
  ).toEqual([bob.id, cam.id]);
  await membership([cam.id]);
  expect((await genericGamesApi.finish(game.id)).winnerIds).toEqual([amy.id, bob.id]);
  const completed = await genericGamesApi.getScoreboard(game.id);
  for (const id of game.players) await playersApi.delete(id);
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(completed);
  expect((await genericGamesApi.getDetail(game.id))?.players.map(({ id }) => id)).toEqual(
    game.players,
  );
});

it("keeps Join and multiple Withdrawal/Rejoin boundaries attached to surviving play when Rounds are deleted", async () => {
  const { game, amy, bob, cam } = await setup(
    {
      mode: "points",
      pointsDirection: "high",
      tiebreaker: null,
      dealer: true,
    },
    true,
  );
  const dora = await playersApi.create({ name: "Dora", color: "Jam", isFavorite: 0 });
  async function membership(players: string[], withdrawnPlayers: string[]) {
    const editor = await genericGamesApi.getEditor(game.id);
    if (!editor) throw new Error("Missing Game editor");
    await genericGamesApi.edit({
      gameId: game.id,
      version: editor.version,
      players,
      withdrawnPlayers,
      confirmImpact: true,
    });
  }
  function add(ids: string[]) {
    return genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: ids.map((playerId) => ({ playerId, points: "2" })),
    });
  }
  const first = await add(game.players);
  await membership(game.players, [amy.id]);
  const second = await add([bob.id, cam.id]);
  const seats = [amy.id, dora.id, bob.id, cam.id];
  await membership(seats, []);
  const third = await add(seats);
  await membership(seats, [bob.id]);
  const fourth = await add([amy.id, dora.id, cam.id]);
  const original = await genericGamesApi.getScoreboard(game.id);
  async function remove(id: string | undefined) {
    if (!id) throw new Error("Missing Round identity");
    const editor = await genericRoundsApi.getEditor(game.id, id);
    await genericRoundsApi.delete({ gameId: game.id, roundId: id, version: editor.version });
    closeDB();
  }
  await remove(first.id);
  const afterFirst = await genericGamesApi.getScoreboard(game.id);
  expect(
    afterFirst?.rounds.map(({ id, scores }) => [id, scores.map(({ playerId }) => playerId)]),
  ).toEqual([
    [second.id, [bob.id, cam.id]],
    [third.id, seats],
    [fourth.id, [amy.id, dora.id, cam.id]],
  ]);
  await remove(third.id);
  expect(
    (await genericGamesApi.getScoreboard(game.id))?.rounds.map(({ scores }) =>
      scores.map(({ playerId }) => playerId),
    ),
  ).toEqual([
    [bob.id, cam.id],
    [amy.id, dora.id, cam.id],
  ]);
  await remove(second.id);
  await remove(fourth.id);
  const empty = await genericGamesApi.getScoreboard(game.id);
  expect(empty?.game.id).toBe(game.id);
  expect(empty?.game.players).toEqual(seats);
  expect(empty?.withdrawnPlayers).toEqual(original?.withdrawnPlayers);
  expect(empty?.upcomingDealerId).toBe(amy.id);
  await add([amy.id, dora.id, cam.id]);
  closeDB();
  expect(
    (await genericGamesApi.getScoreboard(game.id))?.rounds[0].scores.map(
      ({ playerId }) => playerId,
    ),
  ).toEqual([amy.id, dora.id, cam.id]);
});

it("validates Withdrawal batches atomically, rejects stale and duplicate saves, and preserves solo creation", async () => {
  const { game, amy, bob, cam } = await setup({
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
    players: game.players,
    withdrawnPlayers: [amy.id],
  };
  for (const invalid of [
    input,
    { ...input, players: [...game.players, cam.id], withdrawnPlayers: [amy.id, bob.id] },
    { ...input, withdrawnPlayers: [amy.id, amy.id] },
    { ...input, withdrawnPlayers: ["missing"] },
    { ...input, players: [...game.players, cam.id], withdrawnPlayers: [cam.id] },
    { ...input, withdrawnPlayers: [] },
  ]) {
    await expect(genericGamesApi.previewEdit(invalid)).rejects.toThrow();
    await expect(genericGamesApi.edit(invalid)).rejects.toThrow();
    closeDB();
    expect(await genericGamesApi.getById(game.id)).toEqual(game);
  }
  const batch = { ...input, players: [amy.id, cam.id, bob.id] };
  const results = await Promise.allSettled([
    genericGamesApi.edit(batch),
    genericGamesApi.edit(batch),
  ]);
  expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
  closeDB();
  const saved = await genericGamesApi.getScoreboard(game.id);
  expect(saved?.players.map(({ id }) => id)).toEqual(batch.players);
  expect(saved?.withdrawnPlayers).toEqual([amy.id]);
  expect(saved?.upcomingDealerId).toBe(cam.id);
  await expect(genericGamesApi.edit(batch)).rejects.toThrow("history changed");
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
  expect(await playersApi.getById(amy.id)).toEqual(amy);
  const solo = await genericGamesApi.create({ players: [amy.id], settings: game.settings });
  await genericRoundsApi.add({
    gameId: solo.id,
    mode: "points",
    scores: [{ playerId: amy.id, points: "5" }],
  });
  expect((await genericGamesApi.finish(solo.id)).winnerIds).toEqual([amy.id]);
});

it("edits historical participation while withdrawn and rejects stale or fabricated absence entries without partial writes", async () => {
  const { game, amy, bob, cam } = await setup(
    {
      mode: "points",
      pointsDirection: "low",
      tiebreaker: { direction: "high" },
      dealer: true,
    },
    true,
  );
  const first = await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: game.players.map((playerId) => ({ playerId, points: "5", tiebreaker: "2" })),
  });
  if (!first.id) throw new Error("Missing Round identity");
  const staleRound = await genericRoundsApi.getEditor(game.id, first.id);
  const gameEditor = await genericGamesApi.getEditor(game.id);
  if (!gameEditor) throw new Error("Missing Game editor");
  await genericGamesApi.edit({
    gameId: game.id,
    version: gameEditor.version,
    players: game.players,
    withdrawnPlayers: [amy.id],
    confirmImpact: true,
  });
  await expect(
    genericRoundsApi.edit({
      gameId: game.id,
      roundId: first.id,
      version: staleRound.version,
      mode: "points",
      scores: game.players.map((playerId) => ({ playerId, points: "0", tiebreaker: "0" })),
    }),
  ).rejects.toThrow("history changed");
  const historical = await genericRoundsApi.getEditor(game.id, first.id);
  await genericRoundsApi.edit({
    gameId: game.id,
    roundId: first.id,
    version: historical.version,
    mode: "points",
    scores: [
      { playerId: amy.id, points: "-3", tiebreaker: "9" },
      { playerId: bob.id, points: "5", tiebreaker: "2" },
      { playerId: cam.id, points: "5", tiebreaker: "2" },
    ],
  });
  const before = await genericGamesApi.getScoreboard(game.id);
  await expect(
    genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: game.players.map((playerId) => ({ playerId, points: "0", tiebreaker: "0" })),
    }),
  ).rejects.toThrow("every Player");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  const absent = await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [bob.id, cam.id].map((playerId) => ({ playerId, points: "1", tiebreaker: "0" })),
  });
  if (!absent.id) throw new Error("Missing Round identity");
  const absentEditor = await genericRoundsApi.getEditor(game.id, absent.id);
  await expect(
    genericRoundsApi.edit({
      gameId: game.id,
      roundId: absent.id,
      version: absentEditor.version,
      mode: "points",
      confirmImpact: true,
      scores: game.players.map((playerId) => ({ playerId, points: "0", tiebreaker: "0" })),
    }),
  ).rejects.toThrow("every Player");
  const returning = await genericGamesApi.getEditor(game.id);
  if (!returning) throw new Error("Missing Game editor");
  await genericGamesApi.edit({
    gameId: game.id,
    version: returning.version,
    players: game.players,
    withdrawnPlayers: [],
    confirmImpact: true,
  });
  closeDB();
  expect((await genericGamesApi.getScoreboard(game.id))?.standings[0]).toMatchObject({
    player: { id: amy.id },
    totalPoints: -3,
    totalTiebreaker: 9,
    place: 1,
  });
  expect(await genericRoundsApi.getByGameId(game.id)).toHaveLength(2);
});

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

it.each([
  "Join",
  "Withdrawal",
])("rejects a stale %s after history changes and rolls back a failed write for retry", async (operation) => {
  const { game, amy, cam } = await setup(
    {
      mode: "points",
      pointsDirection: "high",
      tiebreaker: null,
      dealer: true,
    },
    operation === "Withdrawal",
  );
  const editor = await genericGamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: operation === "Join" ? [cam.id, ...game.players] : game.players,
    withdrawnPlayers: operation === "Withdrawal" ? [amy.id] : [],
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
  expect((await genericGamesApi.getById(game.id))?.players).toEqual(input.players);
  expect((await genericGamesApi.getScoreboard(game.id))?.withdrawnPlayers).toEqual(
    input.withdrawnPlayers,
  );
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
