import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, expect, it, vi } from "vitest";
import type { EditGenericPointsRoundInput, GenericPointsSettings, GenericRound } from "../../types";
import { closeDB, getDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

afterEach(async () => {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
});

async function pointsGame(settings?: GenericPointsSettings) {
  const maya = await playersApi.create({ name: "Maya", color: "#123456", isFavorite: 0 });
  const rowan = await playersApi.create({ name: "Rowan", color: "#abcdef", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [maya.id, rowan.id],
    settings: settings ?? {
      mode: "points",
      pointsDirection: "high",
      tiebreaker: { direction: "low" },
      dealer: true,
    },
  });
  const round = await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [
      { playerId: maya.id, points: "10", tiebreaker: "2" },
      { playerId: rowan.id, points: "0", tiebreaker: "-3" },
    ],
  });
  if (!round.id) throw new Error("A new Round must have a stable identity.");
  return { game, maya, rowan, round: { ...round, id: round.id } };
}

it("previews without writing and persists a numeric correction without warning when places stay the same", async () => {
  const { game, maya, rowan, round } = await pointsGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: editor.round.id,
    version: editor.version,
    mode: "points" as const,
    scores: [
      { playerId: maya.id, points: "+8", tiebreaker: "-2" },
      { playerId: rowan.id, points: "-1", tiebreaker: "0" },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: false });
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  await genericRoundsApi.edit(input);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    {
      id: round.id,
      roundNumber: 1,
      scores: [
        { playerId: maya.id, points: 8, tiebreaker: -2 },
        { playerId: rowan.id, points: -1, tiebreaker: 0 },
      ],
    },
  ]);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active" },
    players: [
      { id: maya.id, totalPoints: 8, totalTiebreaker: -2 },
      { id: rowan.id, totalPoints: -1, totalTiebreaker: 0 },
    ],
    standings: [
      { player: { id: maya.id }, place: 1 },
      { player: { id: rowan.id }, place: 2 },
    ],
    primaryGraph: {
      series: [
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 8 },
          ],
        },
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: -1 },
          ],
        },
      ],
    },
    tiebreakerGraph: {
      series: [
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: -2 },
          ],
        },
        {
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 0 },
          ],
        },
      ],
    },
  });
});

it("requires confirmation for changed shared places and commits only after approval", async () => {
  const { game, maya, rowan, round } = await pointsGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "points" as const,
    scores: [
      { playerId: maya.id, points: "0", tiebreaker: "-3" },
      { playerId: rowan.id, points: "0", tiebreaker: "-3" },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("Confirm");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  await genericRoundsApi.edit({ ...input, confirmImpact: true });
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active" },
    standings: [
      { player: { id: maya.id }, place: 1 },
      { player: { id: rowan.id }, place: 1 },
    ],
  });

  const completed = await genericGamesApi.finish(game.id);
  expect(completed.winnerIds).toEqual([maya.id, rowan.id]);
  await expect(genericRoundsApi.getEditor(game.id, round.id)).rejects.toThrow("Completed");
  await expect(genericRoundsApi.edit({ ...input, confirmImpact: true })).rejects.toThrow(
    "Completed",
  );
});

it("rejects an approved preview after another Round was added without changing saved history", async () => {
  const { game, maya, rowan, round } = await pointsGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "points" as const,
    scores: [
      { playerId: maya.id, points: "-5", tiebreaker: "2" },
      { playerId: rowan.id, points: "0", tiebreaker: "-3" },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  const second = await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [
      { playerId: maya.id, points: "1", tiebreaker: "0" },
      { playerId: rowan.id, points: "0", tiebreaker: "0" },
    ],
  });
  const before = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.edit({ ...input, confirmImpact: true })).rejects.toThrow(
    "history changed",
  );
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round, second]);
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
});

it("accepts only one of two concurrent submissions and does not apply the correction twice", async () => {
  const { game, maya, rowan, round } = await pointsGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "points" as const,
    scores: [
      { playerId: maya.id, points: "8", tiebreaker: "2" },
      { playerId: rowan.id, points: "0", tiebreaker: "-3" },
    ],
  };
  const outcomes = await Promise.allSettled([
    genericRoundsApi.edit(input),
    genericRoundsApi.edit(input),
  ]);
  expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    { id: round.id, revision: 1, scores: [{ points: 8 }, { points: 0 }] },
  ]);
});

it.each([
  "1.5",
  "",
  "9007199254740992",
])("rejects invalid corrections %j atomically even with impact approval", async (points) => {
  const { game, maya, rowan, round } = await pointsGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  await expect(
    genericRoundsApi.edit({
      gameId: game.id,
      roundId: round.id,
      version: editor.version,
      mode: "points",
      confirmImpact: true,
      scores: [
        { playerId: maya.id, points, tiebreaker: "2" },
        { playerId: rowan.id, points: "0", tiebreaker: "-3" },
      ],
    }),
  ).rejects.toThrow("Points");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
});

it("rolls back the Round write when saving the Game fails, then accepts the same recoverable draft", async () => {
  const { game, maya, rowan, round } = await pointsGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const before = await genericGamesApi.getById(game.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "points" as const,
    scores: [
      { playerId: maya.id, points: "8", tiebreaker: "2" },
      { playerId: rowan.id, points: "0", tiebreaker: "-3" },
    ],
  };
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
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericGamesApi.getById(game.id)).toEqual(before);
  await genericRoundsApi.edit(input);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    { scores: [{ points: 8 }, { points: 0 }] },
  ]);
});

it.each([
  "high",
  "low",
] as const)("uses %s Points direction and the independent Tiebreaker direction after correcting an earlier Round", async (pointsDirection) => {
  const { game, maya, rowan, round } = await pointsGame({
    mode: "points",
    pointsDirection,
    tiebreaker: { direction: "low" },
    dealer: true,
  });
  const second = await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [
      { playerId: maya.id, points: "-10", tiebreaker: "0" },
      { playerId: rowan.id, points: "0", tiebreaker: "0" },
    ],
  });
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "points" as const,
    scores: [
      { playerId: maya.id, points: "10", tiebreaker: "-4" },
      { playerId: rowan.id, points: "0", tiebreaker: "-3" },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await genericRoundsApi.edit({ ...input, confirmImpact: true });
  closeDB();
  expect((await genericRoundsApi.getByGameId(game.id))[1]).toEqual(second);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active", settings: { pointsDirection } },
    players: [
      { id: maya.id, totalPoints: 0, totalTiebreaker: -4 },
      { id: rowan.id, totalPoints: 0, totalTiebreaker: -3 },
    ],
    standings: [
      { player: { id: maya.id }, place: 1 },
      { player: { id: rowan.id }, place: 2 },
    ],
    rounds: [{ dealerId: maya.id }, { dealerId: rowan.id }],
    upcomingDealerId: maya.id,
  });
});

it("keeps legacy Rounds readable but rejects editing instead of inventing missing source metadata", async () => {
  const { game, round } = await pointsGame();
  const legacy: GenericRound = { ...round };
  delete legacy.id;
  delete legacy.revision;
  await (await getDB()).put("rounds", legacy);
  await expect(genericRoundsApi.getEditor(game.id, round.id)).rejects.toThrow("Legacy");
  closeDB();
  const view = await genericGamesApi.getScoreboard(game.id);
  expect(view?.players[0]).toMatchObject({ totalPoints: 10 });
  expect(view?.rounds[0].id).toBeUndefined();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([legacy]);
});

it("rejects unsupported Single Round Winner editing without reopening or changing saved history", async () => {
  const mode = "singleRoundWinner";
  const maya = await playersApi.create({ name: "Maya", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [maya.id],
    settings: { mode, dealer: false, tiebreaker: null },
  });
  const round = await genericRoundsApi.add({
    gameId: game.id,
    mode,
    scores: [{ playerId: maya.id, won: true }],
  });
  if (!round.id) throw new Error("Missing Round identity.");
  await expect(genericRoundsApi.getEditor(game.id, round.id)).rejects.toThrow("Only Points");
  await expect(
    genericRoundsApi.edit({
      gameId: game.id,
      roundId: round.id,
      version: "",
      mode: "points",
      scores: [{ playerId: maya.id, points: "4" }],
      confirmImpact: true,
    }),
  ).rejects.toThrow("Only Points");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect((await genericGamesApi.getById(game.id))?.status).toBe("active");
});

it.each([
  "missing Player",
  "duplicate Player",
  "missing Tiebreaker",
  "invalid Tiebreaker",
] as const)("rejects a correction with %s without partial updates", async (invalid) => {
  const { game, maya, rowan, round } = await pointsGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const scores: EditGenericPointsRoundInput["scores"] = [
    { playerId: maya.id, points: "8", tiebreaker: "2" },
    { playerId: rowan.id, points: "0", tiebreaker: "-3" },
  ];
  if (invalid === "missing Player") scores.pop();
  if (invalid === "duplicate Player") scores[1].playerId = maya.id;
  if (invalid === "missing Tiebreaker") scores[1].tiebreaker = undefined;
  if (invalid === "invalid Tiebreaker") scores[1].tiebreaker = "1.5";
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "points" as const,
    scores,
    confirmImpact: true,
  };
  await expect(genericRoundsApi.previewEdit(input)).rejects.toThrow(/Player|Tiebreaker/);
  await expect(genericRoundsApi.edit(input)).rejects.toThrow(/Player|Tiebreaker/);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
});

it("rejects a correction that overflows a later accumulated total, not just the edited Round", async () => {
  const { game, maya, rowan, round } = await pointsGame();
  const second = await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [
      { playerId: maya.id, points: "9007199254740980", tiebreaker: "0" },
      { playerId: rowan.id, points: "0", tiebreaker: "0" },
    ],
  });
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "points" as const,
    scores: [
      { playerId: maya.id, points: "12", tiebreaker: "2" },
      { playerId: rowan.id, points: "0", tiebreaker: "-3" },
    ],
  };
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("Total Points");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round, second]);
});
