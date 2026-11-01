import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CreateGenericGameInput, GenericGameSettings } from "../../types";
import { closeDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it.each([true, false])("handles solo rounds with Dealer enabled: %s", async (dealer) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [amy.id],
    settings: { mode: "points", pointsDirection: "low", tiebreaker: null, dealer },
  });
  const expectedDealer = dealer ? amy.id : null;
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    upcomingDealerId: expectedDealer,
  });
  for (const points of ["-1", "0", "10"]) {
    await genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: amy.id, points }],
    });
  }
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: amy.id, points: "" }],
    }),
  ).rejects.toThrow("Points");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { settings: { dealer } },
    rounds: [
      { roundNumber: 1, dealerId: expectedDealer },
      { roundNumber: 2, dealerId: expectedDealer },
      { roundNumber: 3, dealerId: expectedDealer },
    ],
    upcomingDealerId: expectedDealer,
  });
});

it("rotates from the saved First Dealer in Seating Order, not score or Player name order", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 1 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const zed = await playersApi.create({ name: "Zed", color: "Rose", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [zed.id, amy.id, bob.id],
    firstDealer: { type: "player", playerId: amy.id },
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: true },
  });
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { firstDealerId: amy.id },
    rounds: [],
    upcomingDealerId: amy.id,
  });
  for (const nextDealer of [bob.id, zed.id, amy.id, bob.id]) {
    await genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [
        { playerId: bob.id, points: "20" },
        { playerId: amy.id, points: "10" },
        { playerId: zed.id, points: "-1" },
      ],
    });
    closeDB();
    expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
      upcomingDealerId: nextDealer,
    });
  }
  await playersApi.update(zed.id, { name: "Aaron", isFavorite: 1 });
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    players: [{ id: zed.id }, { id: amy.id }, { id: bob.id }],
    rounds: [
      { roundNumber: 1, dealerId: amy.id },
      { roundNumber: 2, dealerId: bob.id },
      { roundNumber: 3, dealerId: zed.id },
      { roundNumber: 4, dealerId: amy.id },
    ],
    upcomingDealerId: bob.id,
    standings: [{ player: { id: bob.id } }, { player: { id: amy.id } }, { player: { id: zed.id } }],
  });
  const noDealer = await genericGamesApi.create({
    players: game.players,
    settings: { ...game.settings, dealer: false },
  });
  await genericRoundsApi.add({
    mode: "points",
    gameId: noDealer.id,
    scores: game.players.map((playerId) => ({ playerId, points: "0" })),
  });
  closeDB();
  expect(await genericGamesApi.getScoreboard(noDealer.id)).toMatchObject({
    rounds: [{ dealerId: null }],
    upcomingDealerId: null,
  });
});

async function resetDatabase() {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
}

it.each<GenericGameSettings>([
  { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: true },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  { mode: "passFail", tiebreaker: null, dealer: true },
])("resolves Random from the final roster once and persists it for $mode", async (settings) => {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam"].map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const ids = players.map(({ id }) => id);
  const random = vi.spyOn(Math, "random");
  for (const [outcome, playerId] of [
    [0, ids[0]],
    [0.5, ids[1]],
    [0.999999, ids[2]],
  ] as const) {
    random.mockReturnValue(outcome);
    const game = await genericGamesApi.create({
      players: ids,
      settings,
      firstDealer: { type: "random" },
    });
    expect(game.firstDealerId).toBe(playerId);
    random.mockImplementation(() => {
      throw new Error("Existing Games must not draw another First Dealer");
    });
    closeDB();
    expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
      game: { firstDealerId: playerId, players: ids },
      upcomingDealerId: playerId,
    });
    for (let index = 0; index < 3; index++) {
      await genericRoundsApi.add(
        settings.mode === "points"
          ? {
              gameId: game.id,
              mode: "points",
              scores: ids.map((playerId) => ({ playerId, points: "0" })),
            }
          : settings.mode === "passFail"
            ? {
                gameId: game.id,
                mode: "passFail",
                scores: ids.map((playerId) => ({ playerId, passed: false })),
              }
            : {
                gameId: game.id,
                mode: "singleRoundWinner",
                scores: ids.map((playerId) => ({ playerId, won: playerId === ids[0] })),
              },
      );
    }
    closeDB();
    expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
      game: { firstDealerId: playerId },
      upcomingDealerId: playerId,
    });
  }
  random.mockReturnValue(0.999999);
  const defaultRandom = await genericGamesApi.create({ players: ids, settings });
  expect(defaultRandom.firstDealerId).toBe(ids[2]);
});

it("rejects invalid First Dealer choices without saving a Game or weakening roster validation", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const settings = {
    mode: "points",
    pointsDirection: "high",
    tiebreaker: null,
    dealer: true,
  } as const;
  for (const firstDealer of [
    { type: "player", playerId: bob.id },
    { type: "player", playerId: "" },
    { type: "unsupported" },
    null,
  ]) {
    const input: CreateGenericGameInput = { players: [amy.id], settings };
    Object.assign(input, { firstDealer });
    await expect(genericGamesApi.create(input)).rejects.toThrow("First Dealer");
  }
  await expect(genericGamesApi.create({ players: [], settings })).rejects.toThrow(
    "at least one Player",
  );
  await expect(genericGamesApi.create({ players: [amy.id, amy.id], settings })).rejects.toThrow(
    "unique",
  );
  expect(await genericGamesApi.getList()).toEqual([]);
});

it("never draws for a named choice or disabled Dealer tracking", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("No Random selection requested");
  });
  for (const dealer of [true, false]) {
    const game = await genericGamesApi.create({
      players: [amy.id],
      settings: { mode: "passFail", tiebreaker: null, dealer },
      firstDealer: { type: "player", playerId: amy.id },
    });
    expect(game.firstDealerId).toBe(dealer ? amy.id : null);
    if (!dealer) {
      const randomDisabled = await genericGamesApi.create({
        players: [amy.id],
        settings: game.settings,
      });
      expect(randomDisabled.firstDealerId).toBeNull();
    }
  }
});

it("retains a non-first-seat starting point through Join, Withdrawal, Rejoin, gaps and first-Round deletion", async () => {
  const [amy, bob, cam, dee] = await Promise.all(
    ["Amy", "Bob", "Cam", "Dee"].map((name) =>
      playersApi.create({ name, color: "Jam", isFavorite: 0 }),
    ),
  );
  const game = await genericGamesApi.create({
    players: [amy.id, bob.id, cam.id],
    settings: { mode: "passFail", tiebreaker: null, dealer: true },
    firstDealer: { type: "player", playerId: bob.id },
  });
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
  async function add() {
    const view = await genericGamesApi.getScoreboard(game.id);
    if (!view) throw new Error("Missing scoreboard");
    return genericRoundsApi.add({
      gameId: game.id,
      mode: "passFail",
      scores: view.eligiblePlayers.map(({ id }) => ({ playerId: id, passed: false })),
    });
  }
  await membership(game.players, [bob.id]);
  expect((await genericGamesApi.getScoreboard(game.id))?.upcomingDealerId).toBe(cam.id);
  const first = await add();
  const seats = [amy.id, bob.id, dee.id, cam.id];
  await membership(seats, [bob.id]);
  await add();
  await membership(seats, []);
  await add();
  await add();
  await add();
  closeDB();
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.game.firstDealerId).toBe(bob.id);
  expect(view?.players.map(({ id }) => id)).toEqual(seats);
  expect(view?.rounds.map(({ dealerId }) => dealerId)).toEqual([
    cam.id,
    amy.id,
    bob.id,
    dee.id,
    cam.id,
  ]);
  expect(view?.rounds.map(({ scores }) => scores.map(({ playerId }) => playerId))).toEqual([
    [amy.id, cam.id],
    [amy.id, dee.id, cam.id],
    seats,
    seats,
    seats,
  ]);
  if (!first.id) throw new Error("Missing Round identity");
  const editor = await genericRoundsApi.getEditor(game.id, first.id);
  await genericRoundsApi.delete({
    gameId: game.id,
    roundId: first.id,
    version: editor.version,
  });
  closeDB();
  const corrected = await genericGamesApi.getScoreboard(game.id);
  expect(corrected?.game.firstDealerId).toBe(bob.id);
  expect(corrected?.rounds.map(({ dealerId }) => dealerId)).toEqual([
    dee.id,
    cam.id,
    amy.id,
    bob.id,
  ]);
  expect(corrected?.upcomingDealerId).toBe(dee.id);
  expect(corrected?.rounds.map(({ scores }) => scores.map(({ playerId }) => playerId))).toEqual([
    [amy.id, dee.id, cam.id],
    seats,
    seats,
    seats,
  ]);
});
