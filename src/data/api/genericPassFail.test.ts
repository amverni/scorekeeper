import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AddGenericPassFailRoundInput, GenericPassFailSettings } from "../../types";
import { closeDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it("saves an all-fail Round with explicit outcomes for every Player and reloads zero passes", async () => {
  const { game, players } = await createPassFailGame();
  const round = await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: players.map((player) => ({ playerId: player.id, passed: false })),
  });
  expect(round).toEqual({
    id: expect.any(String),
    revision: 0,
    gameId: game.id,
    scorekeeper: "generic",
    mode: "passFail",
    roundNumber: 1,
    scores: [
      { playerId: players[0].id, passed: false },
      { playerId: players[1].id, passed: false },
      { playerId: players[2].id, passed: false },
    ],
  });
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(
    view?.players.map((player) => ("totalPasses" in player ? player.totalPasses : undefined)),
  ).toEqual([0, 0, 0]);
  expect(view?.standings.map((row) => row.place)).toEqual([1, 1, 1]);
});

it("accumulates all-pass and mixed Rounds in creation order and awards tied leaders at completion", async () => {
  const {
    game,
    players: [zed, amy, bob],
  } = await createPassFailGame(3, true);
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: [
      { playerId: bob.id, passed: true },
      { playerId: amy.id, passed: true },
      { playerId: zed.id, passed: true },
    ],
  });
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: [
      { playerId: zed.id, passed: true },
      { playerId: amy.id, passed: true },
      { playerId: bob.id, passed: false },
    ],
  });
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    upcomingDealerId: bob.id,
    players: [
      { id: zed.id, totalPasses: 2 },
      { id: amy.id, totalPasses: 2 },
      { id: bob.id, totalPasses: 1 },
    ],
    rounds: [
      {
        dealerId: zed.id,
        scores: [
          { playerId: zed.id, passed: true, totalPasses: 1 },
          { playerId: amy.id, passed: true, totalPasses: 1 },
          { playerId: bob.id, passed: true, totalPasses: 1 },
        ],
      },
      {
        dealerId: amy.id,
        scores: [
          { playerId: zed.id, passed: true, totalPasses: 2 },
          { playerId: amy.id, passed: true, totalPasses: 2 },
          { playerId: bob.id, passed: false, totalPasses: 1 },
        ],
      },
    ],
    standings: [
      { player: { id: zed.id }, totalPasses: 2, place: 1 },
      { player: { id: amy.id }, totalPasses: 2, place: 1 },
      { player: { id: bob.id }, totalPasses: 1, place: 3 },
    ],
  });
  const completed = await genericGamesApi.finish(game.id);
  expect(completed.winnerIds).toEqual([zed.id, amy.id]);
  expect(completed.playerSnapshots).toEqual(
    [zed, amy, bob].map(({ id, name, color }) => ({ id, name, color })),
  );
  await playersApi.update(zed.id, { name: "Renamed", color: "#123456" });
  await playersApi.delete(amy.id);
  closeDB();
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.players.map(({ name }) => name)).toEqual(["Zed", "Amy", "Bob"]);
  expect(view?.players[0].color).toBe(zed.color);
  expect(view?.upcomingDealerId).toBeNull();
  expect((await genericGamesApi.getList())[0].players.map(({ name }) => name)).toEqual([
    "Zed",
    "Amy",
    "Bob",
  ]);
  await expect(
    genericRoundsApi.add({
      gameId: game.id,
      mode: "passFail",
      scores: [zed, amy, bob].map(({ id }) => ({ playerId: id, passed: true })),
    }),
  ).rejects.toThrow("Completed Game");
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow("Completed Game");
});

it("supports solo all-fail completion but never completes an unplayed Game", async () => {
  const {
    game,
    players: [player],
  } = await createPassFailGame(1);
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow(/Round/);
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: [{ playerId: player.id, passed: false }],
  });
  expect((await genericGamesApi.getById(game.id))?.status).toBe("active");
  expect((await genericGamesApi.finish(game.id)).winnerIds).toEqual([player.id]);
});

it.each([
  false,
  true,
])("awards every first-place tie when all Players have outcome %s", async (passed) => {
  const { game, players } = await createPassFailGame();
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: players.map(({ id }) => ({ playerId: id, passed })),
  });
  expect((await genericGamesApi.finish(game.id)).winnerIds).toEqual(players.map(({ id }) => id));
});

it.each([
  "empty",
  "missing",
  "duplicate",
  "outsider",
  "extra",
] as const)("rejects %s Pass/Fail roster outcomes atomically", async (invalid) => {
  const {
    game,
    players: [zed, amy, bob],
  } = await createPassFailGame();
  const zedScore = { playerId: zed.id, passed: true };
  const amyScore = { playerId: amy.id, passed: false };
  const bobScore = { playerId: bob.id, passed: false };
  const outsider = { playerId: "outsider", passed: false };
  const scores = {
    empty: [],
    missing: [zedScore, amyScore],
    duplicate: [zedScore, amyScore, amyScore],
    outsider: [zedScore, amyScore, outsider],
    extra: [zedScore, amyScore, bobScore, outsider],
  }[invalid];
  await expect(
    genericRoundsApi.add({
      gameId: game.id,
      mode: "passFail",
      scores,
    }),
  ).rejects.toThrow("every Player exactly once");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  undefined,
  null,
  0,
  1,
  "",
  "false",
  "true",
])("rejects a missing or non-boolean Pass/Fail outcome %j without inventing a failure", async (passed) => {
  const {
    game,
    players: [player],
  } = await createPassFailGame(1);
  const score = Object.assign({ playerId: player.id, passed: false }, { passed });
  await expect(
    genericRoundsApi.add({
      gameId: game.id,
      mode: "passFail",
      scores: [score],
    }),
  ).rejects.toThrow("Pass/Fail outcome");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("keeps Pass/Fail and Points Round payloads distinct", async () => {
  const {
    game,
    players: [player],
  } = await createPassFailGame(1);
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: player.id, points: "0" }],
    }),
  ).rejects.toThrow("Round mode must match");
  const points = await genericGamesApi.create({
    players: [player.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  await expect(
    genericRoundsApi.add({
      gameId: points.id,
      mode: "passFail",
      scores: [{ playerId: player.id, passed: true }],
    }),
  ).rejects.toThrow("Round mode must match");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericRoundsApi.getByGameId(points.id)).toEqual([]);
});

it.each([
  { tiebreaker: { direction: "low" } },
  { pointsDirection: "low" },
  { dealer: "true" },
])("rejects unsupported hidden Pass/Fail settings %j", async (invalid) => {
  const player = await playersApi.create({ name: "Solo", color: "Jam", isFavorite: 0 });
  const settings: GenericPassFailSettings = Object.assign(
    { mode: "passFail", tiebreaker: null, dealer: false },
    invalid,
  );
  await expect(
    genericGamesApi.create({
      players: [player.id],
      settings,
    }),
  ).rejects.toThrow("settings");
  expect(await genericGamesApi.getList()).toEqual([]);
});

it("snapshots Pass/Fail selections before async persistence and keeps saved rules fixed", async () => {
  const {
    game,
    players: [player],
  } = await createPassFailGame(1, true);
  const input: AddGenericPassFailRoundInput = {
    gameId: game.id,
    mode: "passFail",
    scores: [{ playerId: player.id, passed: true }],
  };
  const pending = genericRoundsApi.add(input);
  input.scores[0].passed = false;
  input.scores.length = 0;
  game.settings.dealer = false;
  const round = await pending;
  if (round.mode !== "passFail") throw new Error("Expected Pass/Fail Round");
  round.scores[0].passed = false;
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { settings: { mode: "passFail", dealer: true, tiebreaker: null } },
    players: [{ id: player.id, totalPasses: 1 }],
    rounds: [{ scores: [{ playerId: player.id, passed: true }] }],
  });
});

async function createPassFailGame(count = 3, dealer = false) {
  const players = await Promise.all(
    ["Zed", "Amy", "Bob"]
      .slice(0, count)
      .map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await genericGamesApi.create({
    players: players.map((player) => player.id),
    settings: { mode: "passFail", tiebreaker: null, dealer },
  });
  return { game, players };
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
