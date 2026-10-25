import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, expect, it, vi } from "vitest";
import { closeDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

afterEach(async () => {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
});

async function passFailGame(suffix = "") {
  const maya = await playersApi.create({ name: `Maya${suffix}`, color: "Jam", isFavorite: 0 });
  const rowan = await playersApi.create({ name: `Rowan${suffix}`, color: "Azure", isFavorite: 0 });
  const lee = await playersApi.create({ name: `Lee${suffix}`, color: "Mint", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [maya.id, rowan.id, lee.id],
    settings: { mode: "passFail", tiebreaker: null, dealer: true },
  });
  const round = await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: [
      { playerId: maya.id, passed: true },
      { playerId: rowan.id, passed: false },
      { playerId: lee.id, passed: false },
    ],
  });
  if (!round.id) throw new Error("Missing Round identity.");
  return { game, maya, rowan, lee, round: { ...round, id: round.id } };
}

it.each([
  false,
  true,
])("confirms changed shared places, saves every outcome as %s, and finishes manually with tied winners", async (passed) => {
  const { game, maya, rowan, lee, round } = await passFailGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "passFail" as const,
    scores: game.players.map((playerId) => ({ playerId, passed })),
  };
  const before = await genericGamesApi.getScoreboard(game.id);
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("Confirm");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  await genericRoundsApi.edit({ ...input, confirmImpact: true });
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active" },
    standings: [
      { player: { id: maya.id }, totalPasses: passed ? 1 : 0, place: 1 },
      { player: { id: rowan.id }, totalPasses: passed ? 1 : 0, place: 1 },
      { player: { id: lee.id }, totalPasses: passed ? 1 : 0, place: 1 },
    ],
  });
  expect((await genericGamesApi.finish(game.id)).winnerIds).toEqual(game.players);
  closeDB();
  const completed = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.getEditor(game.id, round.id)).rejects.toThrow("Completed");
  await expect(genericRoundsApi.edit({ ...input, confirmImpact: true })).rejects.toThrow(
    "Completed",
  );
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(completed);
});

it("rejects stale approved Pass/Fail edits and duplicate submissions without changing later Rounds", async () => {
  const { game, maya, rowan, lee, round } = await passFailGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "passFail" as const,
    scores: [
      { playerId: maya.id, passed: false },
      { playerId: rowan.id, passed: true },
      { playerId: lee.id, passed: false },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  const later = await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: game.players.map((playerId) => ({ playerId, passed: false })),
  });
  const before = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.previewEdit(input)).rejects.toThrow("history changed");
  await expect(genericRoundsApi.edit({ ...input, confirmImpact: true })).rejects.toThrow(
    "history changed",
  );
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  const refreshed = await genericRoundsApi.getEditor(game.id, round.id);
  const approved = { ...input, version: refreshed.version, confirmImpact: true };
  const outcomes = await Promise.allSettled([
    genericRoundsApi.edit(approved),
    genericRoundsApi.edit(approved),
  ]);
  expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    { id: round.id, revision: 1, scores: input.scores },
    later,
  ]);
});

it.each([
  { name: "missing Player", scores: [] },
  { name: "duplicate Player", scores: [0, 0, 2] },
  { name: "foreign Player", scores: [0, 1, "foreign"] },
  { name: "nonboolean outcome", passed: "true" },
  { name: "numeric outcome", passed: 1 },
  { name: "missing outcome", passed: undefined },
  { name: "null entry", scores: [0, 1, null] },
  { name: "missing scores", scores: null },
])("rejects $name without partial saved state even with approval", async (invalid) => {
  const { game, round } = await passFailGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const scores =
    "scores" in invalid
      ? invalid.scores?.map((player) =>
          player === null
            ? null
            : {
                playerId: typeof player === "number" ? game.players[player] : player,
                passed: true,
              },
        )
      : game.players.map((playerId) => ({ playerId, passed: invalid.passed }));
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "passFail",
    scores,
    confirmImpact: true,
  };
  const before = await genericGamesApi.getScoreboard(game.id);
  await expect(
    Reflect.apply(genericRoundsApi.previewEdit, genericRoundsApi, [input]),
  ).rejects.toThrow();
  await expect(Reflect.apply(genericRoundsApi.edit, genericRoundsApi, [input])).rejects.toThrow();
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
});

it("rejects a missing Round, another Game's Round, or a mismatched mode atomically", async () => {
  const { game, round } = await passFailGame();
  const other = await passFailGame(" Other");
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  for (const roundId of ["missing", other.round.id]) {
    await expect(genericRoundsApi.getEditor(game.id, roundId)).rejects.toThrow(
      "Round cannot be edited",
    );
    await expect(
      genericRoundsApi.edit({
        gameId: game.id,
        roundId,
        version: editor.version,
        mode: "passFail",
        scores: game.players.map((playerId) => ({ playerId, passed: true })),
        confirmImpact: true,
      }),
    ).rejects.toThrow("Round cannot be edited");
  }
  await expect(
    genericRoundsApi.edit({
      gameId: game.id,
      roundId: round.id,
      version: editor.version,
      mode: "points",
      scores: game.players.map((playerId) => ({ playerId, points: "1" })),
      confirmImpact: true,
    }),
  ).rejects.toThrow("mode must match");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericRoundsApi.getByGameId(other.game.id)).toEqual([other.round]);
});

it("rolls back a failed Pass/Fail correction and accepts the retained draft on retry", async () => {
  const { game, round } = await passFailGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "passFail" as const,
    scores: game.players.map((playerId) => ({ playerId, passed: true })),
    confirmImpact: true,
  };
  const before = await genericGamesApi.getScoreboard(game.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (value?.id === game.id) throw new DOMException("Storage unavailable", "QuotaExceededError");
    return put.call(this, value, key);
  });
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("Storage unavailable");
  failure.mockRestore();
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  await genericRoundsApi.edit(input);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    { id: round.id, revision: 1, scores: input.scores },
  ]);
});

it("prefills Pass/Fail outcomes and corrects an earlier whole Round without warning when places stay unchanged", async () => {
  const { game, maya, rowan, lee, round } = await passFailGame();
  const second = await genericRoundsApi.add({
    gameId: game.id,
    mode: "passFail",
    scores: [
      { playerId: maya.id, passed: true },
      { playerId: rowan.id, passed: false },
      { playerId: lee.id, passed: false },
    ],
  });
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  expect(editor).toMatchObject({
    round,
    players: [{ id: maya.id }, { id: rowan.id }, { id: lee.id }],
  });
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "passFail" as const,
    scores: [
      { playerId: lee.id, passed: false },
      { playerId: maya.id, passed: false },
      { playerId: rowan.id, passed: false },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: false });
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round, second]);
  await genericRoundsApi.edit(input);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    {
      id: round.id,
      revision: 1,
      roundNumber: 1,
      scores: [
        { playerId: maya.id, passed: false },
        { playerId: rowan.id, passed: false },
        { playerId: lee.id, passed: false },
      ],
    },
    second,
  ]);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active", players: [maya.id, rowan.id, lee.id] },
    players: [
      { id: maya.id, totalPasses: 1 },
      { id: rowan.id, totalPasses: 0 },
      { id: lee.id, totalPasses: 0 },
    ],
    standings: [
      { player: { id: maya.id }, place: 1 },
      { player: { id: rowan.id }, place: 2 },
      { player: { id: lee.id }, place: 2 },
    ],
    rounds: [
      { dealerId: maya.id, scores: [{ totalPasses: 0 }, { totalPasses: 0 }, { totalPasses: 0 }] },
      { dealerId: rowan.id, scores: [{ totalPasses: 1 }, { totalPasses: 0 }, { totalPasses: 0 }] },
    ],
    upcomingDealerId: lee.id,
    primaryGraph: {
      metric: "Passes",
      series: [
        { points: [{ value: 0 }, { value: 0 }, { value: 1 }] },
        { points: [{ value: 0 }, { value: 0 }, { value: 0 }] },
        { points: [{ value: 0 }, { value: 0 }, { value: 0 }] },
      ],
    },
    tiebreakerGraph: null,
  });
});
