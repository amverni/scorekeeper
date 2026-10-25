import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, expect, it, vi } from "vitest";
import type { ActiveGenericGame, GenericGameSettings, GenericRound } from "../../types";
import { closeDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

afterEach(async () => {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
});

async function createGame(
  settings: GenericGameSettings = {
    mode: "points",
    pointsDirection: "high",
    tiebreaker: { direction: "low" },
    dealer: true,
  },
  suffix = "",
) {
  const maya = await playersApi.create({ name: `Maya${suffix}`, color: "Jam", isFavorite: 0 });
  const rowan = await playersApi.create({ name: `Rowan${suffix}`, color: "Azure", isFavorite: 0 });
  const game = await genericGamesApi.create({
    name: "Keep this Game",
    players: [maya.id, rowan.id],
    settings,
  });
  return { game, maya, rowan };
}

it("deletes only a middle Points Round and reloads renumbered history, totals, Standings, graphs and dealers", async () => {
  const { game, maya, rowan } = await createGame();
  const saved = [];
  for (const [points, tiebreaker] of [
    ["4", "2"],
    ["100", "-20"],
    ["-4", "1"],
  ]) {
    saved.push(
      await genericRoundsApi.add({
        gameId: game.id,
        mode: "points",
        scores: [
          { playerId: maya.id, points, tiebreaker },
          { playerId: rowan.id, points: "0", tiebreaker: "1" },
        ],
      }),
    );
  }
  const [first, middle, last] = saved;
  if (!middle.id) throw new Error("Missing Round identity.");
  const editor = await genericRoundsApi.getEditor(game.id, middle.id);
  await genericRoundsApi.delete({
    gameId: game.id,
    roundId: middle.id,
    version: editor.version,
  });
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([first, { ...last, roundNumber: 2 }]);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { id: game.id, status: "active", players: game.players, settings: game.settings },
    players: [
      { id: maya.id, totalPoints: 0, totalTiebreaker: 3 },
      { id: rowan.id, totalPoints: 0, totalTiebreaker: 2 },
    ],
    rounds: [
      { roundNumber: 1, dealerId: maya.id },
      {
        roundNumber: 2,
        dealerId: rowan.id,
        scores: [
          { totalPoints: 0, totalTiebreaker: 3 },
          { totalPoints: 0, totalTiebreaker: 2 },
        ],
      },
    ],
    standings: [
      { player: { id: rowan.id }, place: 1 },
      { player: { id: maya.id }, place: 2 },
    ],
    upcomingDealerId: maya.id,
    primaryGraph: {
      series: [
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 4 },
            { roundNumber: 2, value: 0 },
          ],
        },
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 0 },
            { roundNumber: 2, value: 0 },
          ],
        },
      ],
    },
    tiebreakerGraph: {
      series: [
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 2 },
            { roundNumber: 2, value: 3 },
          ],
        },
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 1 },
            { roundNumber: 2, value: 2 },
          ],
        },
      ],
    },
  });
  expect(
    await genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: game.players.map((playerId) => ({ playerId, points: "0", tiebreaker: "0" })),
    }),
  ).toMatchObject({ roundNumber: 3 });
});

function addRound(game: ActiveGenericGame, first = false): Promise<GenericRound> {
  return genericRoundsApi.add(
    game.settings.mode === "points"
      ? {
          gameId: game.id,
          mode: "points",
          scores: game.players.map((playerId, index) => ({
            playerId,
            points: index === Number(!first) ? "7" : "0",
            tiebreaker: "0",
          })),
        }
      : game.settings.mode === "passFail"
        ? {
            gameId: game.id,
            mode: "passFail",
            scores: game.players.map((playerId, index) => ({
              playerId,
              passed: index === Number(!first),
            })),
          }
        : {
            gameId: game.id,
            mode: "singleRoundWinner",
            scores: game.players.map((playerId, index) => ({
              playerId,
              won: index === Number(!first),
            })),
          },
  );
}

async function deleteInput(game: ActiveGenericGame, round: GenericRound) {
  if (!round.id) throw new Error("Missing Round identity.");
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  return { gameId: game.id, roundId: round.id, version: editor.version };
}

it.each([
  "singleRoundWinner",
  "passFail",
] as const)("deletes an earlier %s result and recomputes shared places, cumulative results and graphs", async (mode) => {
  const { game, maya, rowan } = await createGame({ mode, tiebreaker: null, dealer: true });
  const first = await addRound(game, true);
  const second = await addRound(game);
  const third = await addRound(game);
  await genericRoundsApi.delete(await deleteInput(game, first));
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([
    { ...second, roundNumber: 1 },
    { ...third, roundNumber: 2 },
  ]);
  const total = mode === "passFail" ? "totalPasses" : "totalWins";
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active" },
    players: [
      { id: maya.id, [total]: 0 },
      { id: rowan.id, [total]: 2 },
    ],
    rounds: [
      { roundNumber: 1, dealerId: maya.id, scores: [{ [total]: 0 }, { [total]: 1 }] },
      { roundNumber: 2, dealerId: rowan.id, scores: [{ [total]: 0 }, { [total]: 2 }] },
    ],
    standings: [
      { player: { id: rowan.id }, place: 1 },
      { player: { id: maya.id }, place: 2 },
    ],
    primaryGraph: {
      series: [
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 0 },
            { roundNumber: 2, value: 0 },
          ],
        },
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 1 },
            { roundNumber: 2, value: 2 },
          ],
        },
      ],
    },
    tiebreakerGraph: null,
    upcomingDealerId: maya.id,
  });
  expect(await addRound(game)).toMatchObject({ roundNumber: 3 });
});

it.each<GenericGameSettings>([
  { mode: "points", pointsDirection: "low", tiebreaker: null, dealer: false },
  { mode: "points", pointsDirection: "high", tiebreaker: { direction: "high" }, dealer: true },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  { mode: "passFail", tiebreaker: null, dealer: false },
])("deletes the latest and sole $mode Round while retaining the same empty Active Game", async (settings) => {
  const { game, maya, rowan } = await createGame(settings);
  const empty = await genericGamesApi.getScoreboard(game.id);
  const first = await addRound(game, true);
  const latest = await addRound(game);
  const activity = Date.now() + 1_000;
  vi.spyOn(Date, "now").mockReturnValue(activity);
  await genericRoundsApi.delete(await deleteInput(game, latest));
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([first]);
  await genericRoundsApi.delete(await deleteInput(game, first));
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual({
    ...empty,
    game: { ...game, lastActivityAt: activity },
  });
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect((await genericGamesApi.getActiveViews()).map(({ game }) => game.id)).toEqual([game.id]);
  expect(await playersApi.getById(maya.id)).toMatchObject({ id: maya.id });
  expect(await playersApi.getById(rowan.id)).toMatchObject({ id: rowan.id });
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow("at least one saved Round");
  expect(await addRound(game)).toMatchObject({ roundNumber: 1 });
});

it("rejects stale targets after renumbering and preserves identities for fresh deletion", async () => {
  const { game } = await createGame();
  const first = await addRound(game, true);
  const second = await addRound(game);
  const third = await addRound(game);
  const stale = await deleteInput(game, third);
  await genericRoundsApi.delete(await deleteInput(game, first));
  const before = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.delete(stale)).rejects.toThrow("history changed");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  await genericRoundsApi.delete(await deleteInput(game, third));
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([{ ...second, roundNumber: 1 }]);
});

it("serializes duplicate deletions without deleting the replacement at the same Round number", async () => {
  const { game } = await createGame();
  const first = await addRound(game, true);
  const second = await addRound(game);
  const input = await deleteInput(game, first);
  const results = await Promise.allSettled([
    genericRoundsApi.delete(input),
    genericRoundsApi.delete(input),
  ]);
  expect(results.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([{ ...second, roundNumber: 1 }]);
  await expect(genericRoundsApi.delete(input)).rejects.toThrow("Round cannot be edited");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([{ ...second, roundNumber: 1 }]);
});

it("rejects missing, foreign, stale and Completed Game targets without partial updates", async () => {
  const { game } = await createGame();
  const round = await addRound(game);
  const other = await createGame(game.settings, " Other");
  const foreign = await addRound(other.game);
  const input = await deleteInput(game, round);
  const before = await genericGamesApi.getScoreboard(game.id);
  const otherBefore = await genericGamesApi.getScoreboard(other.game.id);
  for (const invalid of [
    { ...input, roundId: "" },
    { ...input, roundId: "missing" },
    { ...input, roundId: foreign.id ?? "" },
    { ...input, gameId: "missing" },
    { ...input, version: "" },
  ]) {
    await expect(genericRoundsApi.delete(invalid)).rejects.toThrow();
    closeDB();
    expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
    expect(await genericGamesApi.getScoreboard(other.game.id)).toEqual(otherBefore);
  }
  await addRound(game);
  const withLater = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.delete(input)).rejects.toThrow("history changed");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(withLater);
  const fresh = await deleteInput(game, round);
  await genericGamesApi.finish(game.id);
  const completed = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.delete(fresh)).rejects.toThrow("Completed");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(completed);
});

it.each([
  "delete",
  "add",
  "put",
] as const)("rolls back all history and activity when storage fails during %s, then accepts retry", async (operation) => {
  const { game } = await createGame();
  const first = await addRound(game, true);
  await addRound(game);
  await addRound(game);
  const input = await deleteInput(game, first);
  const before = await genericGamesApi.getScoreboard(game.id);
  const records = await genericRoundsApi.getByGameId(game.id);
  const original = IDBObjectStore.prototype[operation];
  let calls = 0;
  const failure = vi.spyOn(IDBObjectStore.prototype, operation).mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    calls++;
    if (calls === (operation === "put" ? 1 : 2)) {
      throw new DOMException("Deletion storage unavailable", "QuotaExceededError");
    }
    return Reflect.apply(original, this, key === undefined ? [value] : [value, key]);
  });
  await expect(genericRoundsApi.delete(input)).rejects.toThrow("Deletion storage unavailable");
  failure.mockRestore();
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual(records);
  await genericRoundsApi.delete(input);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([
    { ...records[1], roundNumber: 1 },
    { ...records[2], roundNumber: 2 },
  ]);
});
