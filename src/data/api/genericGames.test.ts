import "fake-indexeddb/auto";
import { QueryClient } from "@tanstack/react-query";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  CompletedGenericGame,
  CreateGenericGameInput,
  GameId,
  GenericPointsSettings,
  GenericRound,
  PlayerId,
  Round,
} from "../../types";
import { closeDB, getDB } from "../db";
import { gameDetailOptions, gameViewOptions } from "../hooks/useGames";
import {
  activeGenericGamesOptions,
  genericGameDetailOptions,
  genericGameKeys,
} from "../hooks/useGenericGames";
import { getGamePlayers } from "./gameResults";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { phasesApi } from "./phases";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";
import { deriveStandings } from "./standings";

beforeEach(resetDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

it.each([
  { name: "  Friday cards  ", expected: "Friday cards" },
  { name: "", expected: undefined },
  { name: " \t\n ", expected: undefined },
  { name: undefined, expected: undefined },
])("persists an optional Game name, normalizing $name on creation", async ({ name, expected }) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const input = { name, players: [amy.id], settings: pointsSettings() };
  const game = await genericGamesApi.create(input);
  expect(game).toMatchObject({ name: expected });
  closeDB();
  expect(await genericGamesApi.getDetail(game.id)).toMatchObject({
    game: { name: expected },
  });
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { name: expected },
  });
  expect(await genericGamesApi.getList({ activeOnly: true })).toMatchObject([
    { id: game.id, name: expected },
  ]);
  const duplicate = await genericGamesApi.create(input);
  expect(duplicate).toMatchObject({ name: expected });
  expect(duplicate.id).not.toBe(game.id);
});

it("reopens and finishes existing unnamed Generic Games without requiring a name field", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const legacy = await genericGamesApi.create({
    players: [amy.id],
    settings: pointsSettings(),
  });
  delete legacy.name;
  await (await getDB()).put("games", legacy);
  closeDB();
  expect(await genericGamesApi.getById(legacy.id)).toEqual(legacy);
  expect(await genericGamesApi.getDetail(legacy.id)).toMatchObject({ game: legacy });
  expect(await genericGamesApi.getList({ activeOnly: true })).toMatchObject([
    { id: legacy.id, name: undefined },
  ]);
  await genericRoundsApi.add({
    mode: "points",
    gameId: legacy.id,
    scores: [{ playerId: amy.id, points: "0" }],
  });
  await genericGamesApi.finish(legacy.id);
  closeDB();
  expect(await genericGamesApi.getById(legacy.id)).not.toHaveProperty("name");
  expect(await genericGamesApi.getList()).toMatchObject([
    { id: legacy.id, status: "completed", name: undefined },
  ]);
});

it.each([
  "high",
  "low",
] as const)("manually finishes %s Points with the accumulated winner and every Player snapshot", async (direction) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 1 });
  const game = await genericGamesApi.create({
    players: [bob.id, amy.id],
    settings: pointsSettings(direction),
  });
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: amy.id, points: "-10" },
      { playerId: bob.id, points: "15" },
    ],
  });
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: bob.id, points: "-20" },
      { playerId: amy.id, points: "20" },
    ],
  });
  expect(await genericGamesApi.getById(game.id)).toMatchObject({ status: "active" });
  const clock = vi.spyOn(Date, "now").mockReturnValue(100);
  let completed: CompletedGenericGame;
  try {
    completed = await genericGamesApi.finish(game.id);
  } finally {
    clock.mockRestore();
  }
  expect(completed).toEqual({
    ...game,
    status: "completed",
    completionType: "manual",
    completedAt: 100,
    lastActivityAt: 100,
    completionOrder: 100,
    winnerIds: [direction === "high" ? amy.id : bob.id],
    playerSnapshots: [
      { id: bob.id, name: "Bob", color: "Ocean" },
      { id: amy.id, name: "Amy", color: "Jam" },
    ],
  });
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(completed);
  expect((await genericGamesApi.getScoreboard(game.id))?.players).toMatchObject([
    { id: bob.id, totalPoints: -5 },
    { id: amy.id, totalPoints: 10 },
  ]);
  expect(await genericGamesApi.getActive()).toEqual([]);
});

it.each([
  "high",
  "low",
] as const)("awards every tied first-place Player in Game Creation Order for %s Points", async (direction) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Moss", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [cam.id, bob.id, amy.id],
    settings: pointsSettings(direction),
  });
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: amy.id, points: "-5" },
      { playerId: bob.id, points: direction === "high" ? "-10" : "0" },
      { playerId: cam.id, points: "-5" },
    ],
  });
  expect(await genericGamesApi.getById(game.id)).toMatchObject({ status: "active" });
  const completed = await genericGamesApi.finish(game.id);
  expect(completed.winnerIds).toEqual([cam.id, amy.id]);
  expect(completed.playerSnapshots).toEqual([
    { id: cam.id, name: "Cam", color: "Moss" },
    { id: bob.id, name: "Bob", color: "Ocean" },
    { id: amy.id, name: "Amy", color: "Jam" },
  ]);
  closeDB();
  expect((await genericGamesApi.getScoreboard(game.id))?.standings).toMatchObject([
    { player: { id: cam.id }, place: 1, totalPoints: -5 },
    { player: { id: amy.id }, place: 1, totalPoints: -5 },
    { player: { id: bob.id }, place: 3, totalPoints: direction === "high" ? -10 : 0 },
  ]);
});

it("rejects unplayed completion and prevents repeat completion or new Rounds from rewriting results", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow("at least one saved Round");
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
  const input = {
    mode: "points" as const,
    gameId: game.id,
    scores: [{ playerId: amy.id, points: "0" }],
  };
  const round = await genericRoundsApi.add(input);
  const completed = await genericGamesApi.finish(game.id);
  expect(completed.winnerIds).toEqual([amy.id]);
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow("Completed Game");
  await expect(genericRoundsApi.add(input)).rejects.toThrow("Completed Game");
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(completed);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
});

it.each([
  false,
  true,
])("rejects wrong-owner saved Rounds during generic finish (also has a generic Round: %s)", async (hasGenericRound) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  if (hasGenericRound) {
    await genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: amy.id, points: "0" }],
    });
  }
  const before = await genericGamesApi.getById(game.id);
  await (await getDB()).put("rounds", {
    ...makePhaseRound(game.id, amy.id),
    roundNumber: 2,
  });
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow("another Scorekeeper");
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(before);
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
});

it("creates and reopens a solo Points Game without Phase 10 fields", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [amy.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  expect(game).toMatchObject({
    scorekeeper: "generic",
    status: "active",
    players: [amy.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
    createdAt: expect.any(Number),
    lastActivityAt: expect.any(Number),
  });
  expect(game).not.toHaveProperty("phaseSet");
  expect(game).not.toHaveProperty("activePlayers");
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
  expect(await genericGamesApi.getDetail(game.id)).toEqual({
    game,
    players: [amy],
  });
});

it("locks creation order, Low wins, and Dealer at creation and preserves them after reopening", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 1 });
  const input: CreateGenericGameInput = {
    players: [bob.id, amy.id],
    settings: { ...pointsSettings("low"), dealer: true },
  };
  const creating = genericGamesApi.create(input);
  input.players.reverse();
  if (input.settings.mode !== "points") throw new Error("Expected Points settings");
  input.settings.pointsDirection = "high";
  input.settings.dealer = false;
  const game = await creating;
  if (game.settings.mode !== "points") throw new Error("Expected Points settings");
  expect(game.players).toEqual([bob.id, amy.id]);
  expect(game.settings.pointsDirection).toBe("low");
  expect(game.settings.dealer).toBe(true);
  game.players.reverse();
  game.settings.pointsDirection = "high";
  game.settings.dealer = false;
  closeDB();
  expect(await genericGamesApi.getDetail(game.id)).toMatchObject({
    game: { players: [bob.id, amy.id], settings: { ...pointsSettings("low"), dealer: true } },
    players: [bob, amy],
  });
});

it("rejects zero Players and duplicate Players", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  await expect(genericGamesApi.create({ players: [], settings: pointsSettings() })).rejects.toThrow(
    "at least one Player",
  );
  await expect(
    genericGamesApi.create({ players: [amy.id, amy.id], settings: pointsSettings() }),
  ).rejects.toThrow("unique");
});

it("rejects a missing Player without saving a partial Game", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  await expect(
    genericGamesApi.create({ players: [amy.id, "missing"], settings: pointsSettings() }),
  ).rejects.toThrow("Player no longer exists");
  expect(await genericGamesApi.getActive()).toEqual([]);
});

it.each([
  { mode: "singleRoundWinner" },
  { mode: "passFail" },
  { mode: "unknown" },
  { pointsDirection: "sideways" },
  { pointsDirection: undefined },
  { tiebreaker: { direction: "sideways" } },
  { tiebreaker: {} },
  { tiebreaker: [] },
  { tiebreaker: true },
  { tiebreaker: "high" },
  { tiebreaker: undefined },
  { dealer: "true" },
  { dealer: 1 },
  { dealer: null },
  { dealer: undefined },
])("rejects unsupported Points settings: %j", async (unsupported) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const settings = Object.assign(pointsSettings(), unsupported);
  await expect(genericGamesApi.create({ players: [amy.id], settings })).rejects.toThrow("settings");
  expect(await genericGamesApi.getActive()).toEqual([]);
});

it("allows a large roster without an arbitrary maximum", async () => {
  const players = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      playersApi.create({ name: `Player ${index}`, color: "Jam", isFavorite: 0 }),
    ),
  );
  const ids = players.map((player) => player.id);
  const game = await genericGamesApi.create({ players: ids, settings: pointsSettings() });
  expect((await genericGamesApi.getDetail(game.id))?.players.map((player) => player.id)).toEqual(
    ids,
  );
});

it("returns missing and wrong-owner detail results without crossing experiences", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id, bob.id]);
  const generic = await genericGamesApi.create({
    players: [amy.id],
    settings: pointsSettings(),
  });
  expect(await genericGamesApi.getById(phase.id)).toBeUndefined();
  expect(await genericGamesApi.getDetail(phase.id)).toBeNull();
  expect(await genericGamesApi.getById("missing")).toBeUndefined();
  expect(await genericGamesApi.getDetail("missing")).toBeNull();
  await expect(genericGamesApi.finish(phase.id)).rejects.toThrow("not found");
  await expect(genericGamesApi.finish("missing")).rejects.toThrow("not found");
  expect(await gamesApi.getById(generic.id)).toBeUndefined();
  expect(await gamesApi.getAll()).toEqual([phase]);
  expect(await gamesApi.getActive()).toEqual([phase]);
  expect(await genericGamesApi.getActive()).toEqual([generic]);
  expect(await genericGamesApi.getActiveViews()).toEqual([{ game: generic, players: [amy] }]);
});

it("lists only Active generic Games ordered by activity then creation time", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const first = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  const second = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  const third = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  const completed = await genericGamesApi.create({
    players: [amy.id],
    settings: pointsSettings(),
  });
  const db = await getDB();
  await db.put("games", { ...first, createdAt: 10, lastActivityAt: 40 });
  await db.put("games", { ...second, createdAt: 30, lastActivityAt: 30 });
  await db.put("games", { ...third, createdAt: 20, lastActivityAt: 40 });
  await db.put("games", {
    ...completed,
    status: "completed",
    completionType: "manual",
    completedAt: 100,
    lastActivityAt: 100,
    winnerIds: [amy.id],
    playerSnapshots: [amy],
  });
  closeDB();
  expect((await genericGamesApi.getActive()).map((game) => game.id)).toEqual([
    third.id,
    first.id,
    second.id,
  ]);
  expect((await genericGamesApi.getActiveViews()).map(({ game }) => game.id)).toEqual([
    third.id,
    first.id,
    second.id,
  ]);
});

it("lists only generic Games in mixed activity order with creation fallback and snapshot identities", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(50);
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const input = { players: [amy.id], settings: pointsSettings() };
  const oldest = await genericGamesApi.create(input);
  clock.mockReturnValue(100);
  const result = await genericGamesApi.create(input);
  await genericRoundsApi.add({
    mode: "points",
    gameId: result.id,
    scores: [{ playerId: amy.id, points: "-5" }],
  });
  clock.mockReturnValue(200);
  const newest = await genericGamesApi.create(input);
  const completed = await genericGamesApi.finish(result.id);
  clock.mockReturnValue(500);
  await createPhaseGame([amy.id]);
  const edited = await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
  closeDB();

  expect(await genericGamesApi.getList()).toEqual([
    { id: newest.id, status: "active", lastActivityAt: 200, players: [edited] },
    {
      id: result.id,
      status: "completed",
      lastActivityAt: 200,
      players: [{ id: amy.id, name: "Amy", color: "Jam" }],
    },
    { id: oldest.id, status: "active", lastActivityAt: 50, players: [edited] },
  ]);
  expect((await genericGamesApi.getList({ activeOnly: true })).map((game) => game.id)).toEqual([
    newest.id,
    oldest.id,
  ]);
  expect((await genericGamesApi.getActiveViews()).map(({ game }) => game.id)).toEqual([
    newest.id,
    oldest.id,
  ]);
  expect(await genericGamesApi.getById(result.id)).toEqual(completed);
});

it("reports missing Player data instead of a successful incomplete scoreboard", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  const db = await getDB();
  await db.delete("players", amy.id);
  await expect(genericGamesApi.getDetail(game.id)).rejects.toThrow("Player no longer exists");
  await expect(genericGamesApi.getActiveViews()).rejects.toThrow("Player no longer exists");
  await expect(genericGamesApi.getList()).rejects.toThrow("Player no longer exists");
});

it("prevents every Phase Game write from changing a Generic Game", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const generic = await genericGamesApi.create({
    players: [amy.id],
    settings: pointsSettings(),
  });
  await expect(gamesApi.addPhase(generic.id, "phase-1")).rejects.toThrow("not found");
  await expect(gamesApi.removePhase(generic.id, "phase-1")).rejects.toThrow("not found");
  await expect(gamesApi.finish(generic.id)).rejects.toThrow("not found");
  await expect(gamesApi.delete(generic.id)).rejects.toThrow("another Scorekeeper");
  await expect(
    roundsApi.add({
      gameId: generic.id,
      scores: [{ playerId: amy.id, score: 0, phaseStatus: "completed" }],
      roundWinnerId: amy.id,
    }),
  ).rejects.toThrow("not found");
  await expect(roundsApi.edit(generic.id, 1, amy.id, { score: 5 })).rejects.toThrow("not found");
  await expect(roundsApi.delete(generic.id, 1)).rejects.toThrow("not found");
  await expect(roundsApi.deleteByGameId(generic.id)).rejects.toThrow("not found");
  expect(await genericGamesApi.getById(generic.id)).toEqual(generic);
  expect(await genericRoundsApi.getByGameId(generic.id)).toEqual([]);
});

it("scopes round reads to both Game and Round ownership", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id, bob.id]);
  const generic = await genericGamesApi.create({
    players: [amy.id],
    settings: pointsSettings(),
  });
  const db = await getDB();
  const phaseRound = makePhaseRound(phase.id, amy.id);
  const genericRound = makeGenericRound(generic.id, amy.id);
  await db.put("rounds", phaseRound);
  await db.put("rounds", genericRound);
  await db.put("rounds", { ...phaseRound, gameId: generic.id, roundNumber: 2 });
  await db.put("rounds", { ...genericRound, gameId: phase.id, roundNumber: 2 });
  await db.put("rounds", { ...phaseRound, gameId: "missing" });
  await db.put("rounds", { ...genericRound, gameId: "missing", roundNumber: 2 });
  expect(await roundsApi.getByGameId(generic.id)).toEqual([]);
  expect(await roundsApi.hasRounds(generic.id)).toBe(false);
  expect(await genericRoundsApi.getByGameId(phase.id)).toEqual([]);
  expect(await genericRoundsApi.hasRounds(phase.id)).toBe(false);
  expect(await roundsApi.getByGameId("missing")).toEqual([]);
  expect(await genericRoundsApi.getByGameId("missing")).toEqual([]);
  expect(await roundsApi.getByGameId(phase.id)).toEqual([phaseRound]);
  expect(await genericRoundsApi.getByGameId(generic.id)).toEqual([genericRound]);
});

it("rejects Phase mutation of wrong-owner Round data even under a Phase Game id", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id, bob.id]);
  const db = await getDB();
  await db.put("rounds", makeGenericRound(phase.id, amy.id));
  await expect(
    roundsApi.add({
      gameId: phase.id,
      scores: [{ playerId: amy.id, score: 0, phaseStatus: "completed" }],
      roundWinnerId: amy.id,
    }),
  ).rejects.toThrow("another Scorekeeper");
  await expect(roundsApi.edit(phase.id, 1, amy.id, { score: 5 })).rejects.toThrow(
    "another Scorekeeper",
  );
  await expect(roundsApi.delete(phase.id, 1)).rejects.toThrow("another Scorekeeper");
  await expect(roundsApi.deleteByGameId(phase.id)).rejects.toThrow("another Scorekeeper");
  await expect(gamesApi.finish(phase.id)).rejects.toThrow("another Scorekeeper");
});

it("rejects Generic ownership in the public Phase Standings boundary", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const generic = await genericGamesApi.create({
    players: [amy.id],
    settings: pointsSettings(),
  });
  expect(() =>
    // @ts-expect-error The Phase identity boundary must also reject a wrong-scorekeeper Game.
    getGamePlayers(generic, [amy]),
  ).toThrow("Phase 10");
  expect(() =>
    // @ts-expect-error Simulate wrong-scorekeeper data reaching the public runtime boundary.
    deriveStandings({ game: generic, players: [amy], rounds: [] }),
  ).toThrow("Phase 10");
  const phase = await createPhaseGame([amy.id]);
  expect(() =>
    deriveStandings({
      game: phase,
      players: [amy],
      // @ts-expect-error Simulate wrong-scorekeeper Round input.
      rounds: [makeGenericRound(phase.id, amy.id)],
    }),
  ).toThrow("Phase 10");
});

it("keeps completed generic names and scoreboard, Standings and list identities independent of saved Players", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const active = await genericGamesApi.create({
    name: "Friday cards",
    players: [bob.id, amy.id],
    settings: pointsSettings("low"),
  });
  await genericRoundsApi.add({
    mode: "points",
    gameId: active.id,
    scores: [
      { playerId: amy.id, points: "-10" },
      { playerId: bob.id, points: "20" },
    ],
  });
  await playersApi.update(bob.id, { name: "Bobby", color: "Moss" });
  const completed = await genericGamesApi.finish(active.id);
  await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
  const beforeDeletion = await genericGamesApi.getScoreboard(active.id);
  await playersApi.delete(bob.id);
  await playersApi.delete(amy.id);
  closeDB();
  expect(await genericGamesApi.getActiveViews()).toEqual([]);
  expect(await genericGamesApi.getDetail(active.id)).toEqual({
    game: completed,
    players: [
      { id: bob.id, name: "Bobby", color: "Moss" },
      { id: amy.id, name: "Amy", color: "Jam" },
    ],
  });
  expect(await genericGamesApi.getScoreboard(active.id)).toEqual(beforeDeletion);
  expect(beforeDeletion).toMatchObject({
    game: { name: "Friday cards", winnerIds: [amy.id] },
    players: [
      { id: bob.id, name: "Bobby", color: "Moss", totalPoints: 20 },
      { id: amy.id, name: "Amy", color: "Jam", totalPoints: -10 },
    ],
    standings: [
      { player: { id: amy.id, name: "Amy", color: "Jam" }, place: 1, totalPoints: -10 },
      { player: { id: bob.id, name: "Bobby", color: "Moss" }, place: 2, totalPoints: 20 },
    ],
  });
  expect(await genericGamesApi.getList()).toEqual([
    {
      id: active.id,
      name: "Friday cards",
      status: "completed",
      lastActivityAt: completed.completedAt,
      players: [
        { id: bob.id, name: "Bobby", color: "Moss" },
        { id: amy.id, name: "Amy", color: "Jam" },
      ],
    },
  ]);
});

it("guards generic deletion and atomically cleans only its Game and Rounds", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id, bob.id]);
  const temporary = await phasesApi.create({
    type: "temporary",
    requirements: [{ type: "set", count: 3, quantity: 1, isSameColor: false }],
  });
  await gamesApi.addPhase(phase.id, temporary.id);
  const generic = await genericGamesApi.create({
    players: [amy.id],
    settings: pointsSettings(),
  });
  const db = await getDB();
  await db.put("rounds", makeGenericRound(generic.id, amy.id));
  await db.put("rounds", makePhaseRound(phase.id, amy.id));
  await expect(genericGamesApi.delete(phase.id)).rejects.toThrow("another Scorekeeper");
  expect(await roundsApi.getByGameId(phase.id)).toHaveLength(1);
  await genericGamesApi.delete(generic.id);
  expect(await genericGamesApi.getDetail(generic.id)).toBeNull();
  expect(await genericGamesApi.getActive()).toEqual([]);
  // Reusing the deleted id exposes dangling rounds through the public read boundary.
  await db.put("games", generic);
  expect(await genericRoundsApi.getByGameId(generic.id)).toEqual([]);
  await genericGamesApi.delete(generic.id);
  expect(await phasesApi.getById(temporary.id)).toEqual(temporary);
  expect(await roundsApi.getByGameId(phase.id)).toHaveLength(1);
  await expect(genericGamesApi.delete("missing")).resolves.toBeUndefined();
  await gamesApi.delete(phase.id);
  expect(await phasesApi.getById(temporary.id)).toBeUndefined();
  expect(await playersApi.getAll()).toEqual([amy, bob]);
});

it("keeps Phase temporary cleanup safe while Generic Games remain", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id]);
  const temporary = await phasesApi.create({
    type: "temporary",
    requirements: [{ type: "set", count: 3, quantity: 1, isSameColor: false }],
  });
  await gamesApi.addPhase(phase.id, temporary.id);
  const generic = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  await gamesApi.delete(phase.id);
  expect(await phasesApi.getById(temporary.id)).toBeUndefined();
  expect(await genericGamesApi.getById(generic.id)).toEqual(generic);
});

it("blocks shared Player deletion until both scorekeepers release their Active references", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id]);
  const generic = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
  await gamesApi.delete(phase.id);
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
  await genericGamesApi.delete(generic.id);
  await playersApi.delete(amy.id);
  expect(await playersApi.getById(amy.id)).toBeUndefined();
});

it.each([
  "generic",
  "phase10",
] as const)("releases shared Player references only after both Games finish (%s finishes first)", async (first) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id, bob.id]);
  const generic = await genericGamesApi.create({
    players: [amy.id, bob.id],
    settings: pointsSettings(),
  });
  await roundsApi.add({
    gameId: phase.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 10 },
    ],
  });
  await genericRoundsApi.add({
    mode: "points",
    gameId: generic.id,
    scores: [
      { playerId: amy.id, points: "0" },
      { playerId: bob.id, points: "0" },
    ],
  });
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
  if (first === "generic") {
    await genericGamesApi.finish(generic.id);
  } else {
    await gamesApi.finish(phase.id);
  }
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
  if (first === "generic") {
    await gamesApi.finish(phase.id);
  } else {
    await genericGamesApi.finish(generic.id);
  }
  await playersApi.delete(amy.id);
  await playersApi.delete(bob.id);
  closeDB();
  const identities = [
    { id: amy.id, name: "Amy", color: "Jam" },
    { id: bob.id, name: "Bob", color: "Ocean" },
  ];
  expect(await genericGamesApi.getDetail(generic.id)).toMatchObject({ players: identities });
  expect(await gamesApi.getList()).toMatchObject([{ players: identities }]);
});

it("reflects shared Player edits and Favorites in both experience views", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const phase = await createPhaseGame([amy.id]);
  const generic = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  const edited = await playersApi.update(amy.id, {
    name: "Amelia",
    color: "Ocean",
    isFavorite: 1,
  });
  closeDB();
  expect(await genericGamesApi.getDetail(generic.id)).toEqual({
    game: generic,
    players: [edited],
  });
  expect(await genericGamesApi.getActiveViews()).toEqual([{ game: generic, players: [edited] }]);
  expect(
    deriveStandings({ game: phase, players: await playersApi.getAll(), rounds: [] })
      .includedPlayers,
  ).toEqual([edited]);
  expect(await playersApi.getAll({ isFavorite: 1 })).toEqual([edited]);
});

it.each([
  true,
  false,
])("serializes generic creation against shared Player deletion (create first: %s)", async (createFirst) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const create = () => genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  const remove = () => playersApi.delete(amy.id);
  const results = await Promise.allSettled(
    createFirst ? [create(), remove()] : [remove(), create()],
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const remaining = await playersApi.getById(amy.id);
  const games = await genericGamesApi.getActiveViews();
  expect(games).toHaveLength(remaining ? 1 : 0);
  if (remaining) expect(games[0].players).toEqual([remaining]);
});

it.each([
  true,
  false,
])("captures complete identities when generic finish competes with Player deletion (finish first: %s)", async (finishFirst) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [{ playerId: amy.id, points: "-10" }],
  });
  const results = await Promise.allSettled(
    finishFirst
      ? [genericGamesApi.finish(game.id), playersApi.delete(amy.id)]
      : [playersApi.delete(amy.id), genericGamesApi.finish(game.id)],
  );
  expect(results.map((result) => result.status)).toEqual(
    finishFirst ? ["fulfilled", "fulfilled"] : ["rejected", "fulfilled"],
  );
  await playersApi.delete(amy.id);
  closeDB();
  expect(await genericGamesApi.getDetail(game.id)).toMatchObject({
    game: { status: "completed", winnerIds: [amy.id] },
    players: [{ id: amy.id, name: "Amy", color: "Jam" }],
  });
  expect((await genericGamesApi.getScoreboard(game.id))?.standings).toEqual([
    { player: { id: amy.id, name: "Amy", color: "Jam" }, place: 1, totalPoints: -10 },
  ]);
});

it("rolls back generic Game and Round deletion when cleanup fails", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({ players: [amy.id], settings: pointsSettings() });
  const round = makeGenericRound(game.id, amy.id);
  await (await getDB()).put("rounds", round);
  const remove = IDBObjectStore.prototype.delete;
  const failure = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange,
  ) {
    if (this.name === "games") throw new DOMException("Cleanup failed", "UnknownError");
    return remove.call(this, key);
  });
  try {
    await expect(genericGamesApi.delete(game.id)).rejects.toThrow("Cleanup failed");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  await expect(playersApi.delete(amy.id)).rejects.toThrow("Active Game");
});

it("uses scoped generic query keys with explicit missing and wrong-owner detail data", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
    const phase = await createPhaseGame([amy.id]);
    const generic = await genericGamesApi.create({
      players: [amy.id],
      settings: pointsSettings(),
    });
    expect(genericGameKeys.all).toEqual(["games", "generic"]);
    expect(genericGameDetailOptions(generic.id).queryKey).toEqual([
      "games",
      "generic",
      "detail",
      generic.id,
    ]);
    expect(await client.fetchQuery(genericGameDetailOptions(generic.id))).toEqual({
      game: generic,
      players: [amy],
    });
    expect(await client.fetchQuery(activeGenericGamesOptions())).toEqual([
      { game: generic, players: [amy] },
    ]);
    expect(await client.fetchQuery(genericGameDetailOptions(phase.id))).toBeNull();
    expect(await client.fetchQuery(genericGameDetailOptions("missing"))).toBeNull();
    expect(await client.fetchQuery(gameDetailOptions(generic.id))).toBeNull();
    expect(await client.fetchQuery(gameDetailOptions("missing"))).toBeNull();
    expect(await client.fetchQuery(gameViewOptions(generic.id))).toBeNull();
    expect(await client.fetchQuery(gameViewOptions("missing"))).toBeNull();
    expect(await client.fetchQuery(gameViewOptions(phase.id))).toMatchObject({
      game: phase,
      rounds: [],
      players: [{ id: amy.id, tiebreakerTotal: 0 }],
    });
    expect(await client.fetchQuery(gameDetailOptions(phase.id))).toEqual(phase);
  } finally {
    client.clear();
  }
});

function makeGenericRound(gameId: GameId, playerId: PlayerId): GenericRound {
  return {
    scorekeeper: "generic",
    gameId,
    roundNumber: 1,
    mode: "points",
    scores: [{ playerId, points: 0 }],
  };
}

function makePhaseRound(gameId: GameId, playerId: PlayerId): Round {
  return {
    scorekeeper: "phase10",
    gameId,
    roundNumber: 1,
    scores: [{ playerId, score: 0, currentPhase: 1, phaseStatus: "completed" }],
    roundWinnerId: playerId,
  };
}

function pointsSettings(direction: "high" | "low" = "high"): GenericPointsSettings {
  return { mode: "points", pointsDirection: direction, tiebreaker: null, dealer: false };
}

function createPhaseGame(players: PlayerId[]) {
  return gamesApi.create({
    players,
    phaseSet: {
      id: "phase-set",
      type: "temporary",
      name: "Two phases",
      phases: ["phase-1", "phase-2"],
    },
    settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 },
  });
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
