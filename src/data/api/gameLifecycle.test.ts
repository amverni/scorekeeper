import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeDB } from "../db";
import { getGamePlayers } from "./gameResults";
import { gamesApi } from "./games";
import { phasesApi } from "./phases";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";
import { deriveStandings } from "./standings";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it("reopens an owned Phase Game and atomically captures all identities and its normal winner", async () => {
  const { game, amy, bob } = await createGame();
  const first = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "completed", score: 10 },
    ],
  });
  expect(first.outcome).toBe("roundAdded");
  expect(first.round).toMatchObject({ scorekeeper: "phase10", roundNumber: 1 });
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual({ ...game, lastActivityAt: expect.any(Number) });

  const result = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 20 },
    ],
  });
  expect(result.outcome).toBe("gameCompleted");
  closeDB();
  const completed = await gamesApi.getById(game.id);
  expect(completed).toMatchObject({
    scorekeeper: "phase10",
    status: "completed",
    completionType: "normal",
    completedAt: expect.any(Number),
    winnerIds: [amy.id],
    playerSnapshots: [
      { id: amy.id, name: "Amy", color: "Jam" },
      { id: bob.id, name: "Bob", color: "Ocean" },
    ],
  });
  expect(completed).not.toHaveProperty("activePlayers");
  expect(await roundsApi.getByGameId(game.id)).toMatchObject([
    { scorekeeper: "phase10", roundNumber: 1 },
    {
      scorekeeper: "phase10",
      roundNumber: 2,
      scores: [{ currentPhase: 2 }, { currentPhase: 2 }],
    },
  ]);
});

it("preserves completed scoreboard, Standings, graph and winner identities after saved Player edits/deletion", async () => {
  const { game, amy, bob } = await createGame();
  await finishGame(game.id, amy.id, bob.id);
  await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
  await playersApi.delete(bob.id);
  closeDB();
  const completed = await gamesApi.getById(game.id);
  if (!completed) throw new Error("Missing Completed Game");
  const livePlayers = await playersApi.getAll();
  const identities = [
    { id: amy.id, name: "Amy", color: "Jam" },
    { id: bob.id, name: "Bob", color: "Ocean" },
  ];
  expect(getGamePlayers(completed, livePlayers)).toEqual(identities);
  const standings = deriveStandings({
    game: completed,
    players: livePlayers,
    rounds: await roundsApi.getByGameId(game.id),
  });
  expect(standings.includedPlayers).toEqual(identities);
  expect(standings.rows.map((row) => row.player)).toEqual(identities);
  expect(standings.phaseGraphSeries.map((series) => series.player)).toEqual(identities);
  expect(standings.tiebreakerGraphSeries.map((series) => series.player)).toEqual(identities);
  expect(standings.gameWinner?.player).toEqual(identities[0]);
  await playersApi.delete(amy.id);
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(completed);
  expect(
    deriveStandings({
      game: completed,
      players: await playersApi.getAll(),
      rounds: await roundsApi.getByGameId(game.id),
    }).gameWinner?.player,
  ).toEqual(identities[0]);
});

it("keeps Active identities live and blocks deletion until every referencing Active Game is gone", async () => {
  const { game, amy, bob } = await createGame();
  const edited = await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
  expect(getGamePlayers(game, await playersApi.getAll())).toEqual([edited, bob]);
  await expect(playersApi.delete(amy.id)).rejects.toThrow(
    "Cannot delete this Player while an Active Game references them.",
  );
  const second = await gamesApi.create({
    players: game.players,
    phaseSet: game.phaseSet,
    settings: game.settings,
  });
  await finishGame(game.id, amy.id, bob.id);
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
  await gamesApi.delete(second.id);
  await playersApi.delete(amy.id);
  expect(await playersApi.getById(amy.id)).toBeUndefined();
});

it.each([
  true,
  false,
])("serializes competing Player deletion and Game creation (create first: %s)", async (createFirst) => {
  const { game, amy, bob } = await createGame();
  await gamesApi.delete(game.id);
  const create = () =>
    gamesApi.create({
      players: [amy.id, bob.id],
      phaseSet: game.phaseSet,
      settings: game.settings,
    });
  const remove = () => playersApi.delete(amy.id);
  const operations = createFirst ? [create(), remove()] : [remove(), create()];
  const outcomes = await Promise.allSettled(operations);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  const remaining = await playersApi.getById(amy.id);
  const games = await gamesApi.getActive();
  if (remaining) {
    expect(games).toHaveLength(1);
    expect(games[0].players).toEqual([amy.id, bob.id]);
  } else {
    expect(games).toEqual([]);
  }
});

it("rolls back the finishing Round and completion metadata when the result write fails", async () => {
  const { game, amy, bob } = await createGame();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
    ],
  });
  const before = await gamesApi.getById(game.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === "games") throw new DOMException("Result write failed", "QuotaExceededError");
    return put.call(this, value, key);
  });
  try {
    await expect(
      roundsApi.add({
        gameId: game.id,
        roundWinnerId: amy.id,
        scores: [
          { playerId: amy.id, phaseStatus: "completed", score: 0 },
          { playerId: bob.id, phaseStatus: "failed", score: 20 },
        ],
      }),
    ).rejects.toThrow("Result write failed");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(before);
  expect(await roundsApi.getByGameId(game.id)).toHaveLength(1);
  expect(await playersApi.getAll()).toEqual([amy, bob]);
  await expect(playersApi.delete(bob.id)).rejects.toThrow("Active Game");
});

it("does not allow persistence-level Round mutations to rewrite a Completed Game", async () => {
  const { game, amy, bob } = await createGame();
  await finishGame(game.id, amy.id, bob.id);
  const rounds = await roundsApi.getByGameId(game.id);
  const completed = await gamesApi.getById(game.id);
  await expect(roundsApi.edit(game.id, 1, amy.id, { score: 999 })).rejects.toThrow("completed");
  await expect(roundsApi.delete(game.id, 2)).rejects.toThrow("completed");
  await expect(roundsApi.deleteByGameId(game.id)).rejects.toThrow("completed");
  expect(await roundsApi.getByGameId(game.id)).toEqual(rounds);
  expect(await gamesApi.getById(game.id)).toEqual(completed);
});

it("deletes Game-owned records together without removing another Game's temporary Phase", async () => {
  const { game, amy, bob } = await createGame();
  const temporary = await phasesApi.create({
    type: "temporary",
    requirements: [{ type: "set", count: 3, isSameColor: false, quantity: 1 }],
  });
  await gamesApi.addPhase(game.id, temporary.id);
  const other = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: { ...game.phaseSet, phases: [temporary.id] },
    settings: game.settings,
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
    ],
  });
  await gamesApi.delete(game.id);
  expect(await gamesApi.getById(game.id)).toBeUndefined();
  expect(await roundsApi.getByGameId(game.id)).toEqual([]);
  expect(await phasesApi.getById(temporary.id)).toEqual(temporary);
  expect(await gamesApi.getById(other.id)).toEqual(other);
  await gamesApi.delete(other.id);
  expect(await phasesApi.getById(temporary.id)).toBeUndefined();
  expect(await playersApi.getAll()).toEqual([amy, bob]);
});

it("preserves Game and Round records if Game-owned cleanup fails", async () => {
  const { game, amy, bob } = await createGame();
  await finishGame(game.id, amy.id, bob.id);
  const completed = await gamesApi.getById(game.id);
  const rounds = await roundsApi.getByGameId(game.id);
  const remove = IDBObjectStore.prototype.delete;
  const failure = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange,
  ) {
    if (this.name === "games") throw new DOMException("Cleanup failed", "UnknownError");
    return remove.call(this, key);
  });
  try {
    await expect(gamesApi.delete(game.id)).rejects.toThrow("Cleanup failed");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(completed);
  expect(await roundsApi.getByGameId(game.id)).toEqual(rounds);
});

async function finishGame(gameId: string, amyId: string, bobId: string) {
  for (let round = 0; round < 2; round++) {
    await roundsApi.add({
      gameId,
      roundWinnerId: amyId,
      scores: [
        { playerId: amyId, phaseStatus: "completed", score: 0 },
        { playerId: bobId, phaseStatus: "failed", score: 20 },
      ],
    });
  }
}

async function createGame() {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
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
  return { game, amy, bob };
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
