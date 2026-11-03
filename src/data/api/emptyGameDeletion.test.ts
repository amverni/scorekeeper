import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ScorekeeperId, StoredGame } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { phasesApi } from "./phases";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it.each([
  "phase10",
  "generic",
] as const)("quick-deletes a zero-Round %s Game without deleting saved Players", async (owner) => {
  const { api, game, players } = await createGame(owner);
  await api.deleteEmpty(game.id);
  closeDB();
  expect(await api.getById(game.id)).toBeUndefined();
  expect(await playersApi.getAll()).toEqual(players);
});

it.each([
  "phase10",
  "generic",
] as const)("rejects a stale zero-Round %s deletion and keeps normal Games-list deletion available", async (owner) => {
  const { api, game } = await createGame(owner);
  await saveRound(game);
  const before = await api.getById(game.id);
  await expect(api.deleteEmpty(game.id)).rejects.toThrow("saved Rounds");
  closeDB();
  expect(await api.getById(game.id)).toEqual(before);
  expect(await roundCount(game)).toBe(1);
  await api.delete(game.id);
  expect(await api.getById(game.id)).toBeUndefined();
});

it.each([
  "phase10",
  "generic",
] as const)("rejects quick deletion of a Completed, missing, or foreign %s Game", async (owner) => {
  const { api, game } = await createGame(owner);
  const foreign = owner === "phase10" ? genericGamesApi : gamesApi;
  await expect(foreign.deleteEmpty(game.id)).rejects.toThrow("another Scorekeeper");
  await expect(api.deleteEmpty("missing")).rejects.toThrow("no longer exists");
  expect(await api.getById(game.id)).toEqual(game);
  await saveRound(game);
  const completed = await api.finish(game.id);
  await expect(api.deleteEmpty(game.id)).rejects.toThrow("Completed Game");
  expect(await api.getById(game.id)).toEqual(completed);
  expect(await roundCount(game)).toBe(1);
});

it.each([
  { owner: "phase10", saveFirst: true },
  { owner: "phase10", saveFirst: false },
  { owner: "generic", saveFirst: true },
  { owner: "generic", saveFirst: false },
] as const)("serializes competing $owner save and quick-delete (save first: $saveFirst)", async ({
  owner,
  saveFirst,
}) => {
  const { api, game, players } = await createGame(owner);
  const outcomes = await Promise.allSettled(
    saveFirst
      ? [saveRound(game), api.deleteEmpty(game.id)]
      : [api.deleteEmpty(game.id), saveRound(game)],
  );
  expect(outcomes[0].status).toBe("fulfilled");
  expect(outcomes[1].status).toBe("rejected");
  closeDB();
  if (saveFirst) {
    expect(await api.getById(game.id)).toMatchObject({ id: game.id, status: "active" });
    expect(await roundCount(game)).toBe(1);
  } else {
    expect(await api.getById(game.id)).toBeUndefined();
    expect(await roundCount(game)).toBe(0);
  }
  expect(await playersApi.getAll()).toEqual(players);
});

it.each([
  "phase10",
  "generic",
] as const)("retains the %s Game after a failed quick-delete and permits retry", async (owner) => {
  const { api, game, players } = await createGame(owner);
  const remove = IDBObjectStore.prototype.delete;
  const failure = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange,
  ) {
    if (this.name === "games") throw new DOMException("Cleanup failed", "UnknownError");
    return remove.call(this, key);
  });
  try {
    await expect(api.deleteEmpty(game.id)).rejects.toThrow("Cleanup failed");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await api.getById(game.id)).toEqual(game);
  expect(await playersApi.getAll()).toEqual(players);
  await api.deleteEmpty(game.id);
  expect(await api.getById(game.id)).toBeUndefined();
});

it("cleans up owned temporary Phases atomically while preserving another Game's Phases", async () => {
  const { game, players } = await createGame("phase10");
  if (game.scorekeeper !== "phase10") throw new Error("Expected a Phase 10 Game");
  const owned = await phasesApi.create({
    type: "temporary",
    requirements: [{ type: "set", count: 3, isSameColor: false, quantity: 1 }],
  });
  const shared = await phasesApi.create({
    type: "temporary",
    requirements: [{ type: "run", count: 4, isSameColor: false, quantity: 1 }],
  });
  await gamesApi.addPhase(game.id, owned.id);
  await gamesApi.addPhase(game.id, shared.id);
  const other = await gamesApi.create({
    players: game.players,
    phaseSet: { ...game.phaseSet, phases: [shared.id] },
    settings: game.settings,
  });
  const before = await gamesApi.getById(game.id);
  const remove = IDBObjectStore.prototype.delete;
  const failure = vi.spyOn(IDBObjectStore.prototype, "delete");
  failure.mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
    if (this.name === "customPhases")
      throw new DOMException("Phase cleanup failed", "UnknownError");
    return remove.call(this, key);
  });
  try {
    await expect(gamesApi.deleteEmpty(game.id)).rejects.toThrow("Phase cleanup failed");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(before);
  expect(await phasesApi.getById(owned.id)).toEqual(owned);
  await gamesApi.deleteEmpty(game.id);
  expect(await phasesApi.getById(owned.id)).toBeUndefined();
  expect(await phasesApi.getById(shared.id)).toEqual(shared);
  expect(await gamesApi.getById(other.id)).toEqual(other);
  expect(await playersApi.getAll()).toEqual(players);
});

function saveRound(game: StoredGame) {
  if (game.scorekeeper === "generic") {
    return genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: game.players.map((playerId) => ({ playerId, points: "5" })),
    });
  }
  return roundsApi.add({
    gameId: game.id,
    roundWinnerId: game.players[0],
    scores: [
      { playerId: game.players[0], phaseStatus: "completed", score: 0 },
      { playerId: game.players[1], phaseStatus: "completed", score: 0 },
    ],
  });
}

async function roundCount(game: StoredGame) {
  if (game.scorekeeper === "phase10") return (await roundsApi.getByGameId(game.id)).length;
  return (await genericGamesApi.getScoreboard(game.id))?.rounds.length ?? 0;
}

async function createGame(owner: ScorekeeperId) {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const players = [amy, bob];
  if (owner === "phase10") {
    const game = await gamesApi.create({
      players: [amy.id, bob.id],
      phaseSet: {
        id: "short",
        type: "temporary",
        name: "Short",
        phases: ["classic-1", "classic-2"],
      },
      settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 },
    });
    return { api: gamesApi, game, players };
  }
  const game = await genericGamesApi.create({
    players: [amy.id, bob.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  return { api: genericGamesApi, game, players };
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
