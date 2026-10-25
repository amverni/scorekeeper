import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, expect, it, vi } from "vitest";
import type { EditGenericWinnerRoundInput } from "../../types";
import { closeDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

afterEach(async () => {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
});

async function winnerGame() {
  const maya = await playersApi.create({ name: "Maya", color: "Jam", isFavorite: 0 });
  const rowan = await playersApi.create({ name: "Rowan", color: "Azure", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [maya.id, rowan.id],
    settings: { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  });
  const round = await genericRoundsApi.add({
    gameId: game.id,
    mode: "singleRoundWinner",
    scores: [
      { playerId: maya.id, won: true },
      { playerId: rowan.id, won: false },
    ],
  });
  if (!round.id) throw new Error("A saved Round must have a stable identity.");
  return { game, maya, rowan, round: { ...round, id: round.id } };
}

it("prefills the saved winner, previews without writing, and durably corrects wins and places only after approval", async () => {
  const { game, maya, rowan, round } = await winnerGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  expect(editor).toMatchObject({
    round,
    players: [{ id: maya.id }, { id: rowan.id }],
    tiebreakerEnabled: false,
  });

  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "singleRoundWinner" as const,
    scores: [
      { playerId: rowan.id, won: true },
      { playerId: maya.id, won: false },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("Confirm");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  await genericRoundsApi.edit({ ...input, confirmImpact: true });
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    {
      id: round.id,
      revision: 1,
      roundNumber: 1,
      scores: [
        { playerId: maya.id, won: false },
        { playerId: rowan.id, won: true },
      ],
    },
  ]);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active" },
    players: [
      { id: maya.id, totalWins: 0 },
      { id: rowan.id, totalWins: 1 },
    ],
    rounds: [
      {
        roundNumber: 1,
        dealerId: maya.id,
        scores: [
          { playerId: maya.id, won: false, totalWins: 0 },
          { playerId: rowan.id, won: true, totalWins: 1 },
        ],
      },
    ],
    standings: [
      { player: { id: rowan.id }, place: 1, totalWins: 1 },
      { player: { id: maya.id }, place: 2, totalWins: 0 },
    ],
  });
});

it("requires impact approval for a changed Round winner even when Game places do not change", async () => {
  const { game, maya, rowan, round } = await winnerGame();
  for (let index = 0; index < 2; index++) {
    await genericRoundsApi.add({
      gameId: game.id,
      mode: "singleRoundWinner",
      scores: [
        { playerId: maya.id, won: true },
        { playerId: rowan.id, won: false },
      ],
    });
  }
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "singleRoundWinner" as const,
    scores: [
      { playerId: maya.id, won: false },
      { playerId: rowan.id, won: true },
    ],
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("Confirm");
  expect(
    await genericRoundsApi.previewEdit({
      ...input,
      scores: [
        { playerId: maya.id, won: true },
        { playerId: rowan.id, won: false },
      ],
    }),
  ).toEqual({ requiresConfirmation: false });
  await genericRoundsApi.edit({ ...input, confirmImpact: true });
  closeDB();
  expect((await genericGamesApi.getScoreboard(game.id))?.standings).toMatchObject([
    { player: { id: maya.id }, place: 1, totalWins: 2 },
    { player: { id: rowan.id }, place: 2, totalWins: 1 },
  ]);
});

it.each([
  "no winner",
  "two winners",
  "missing Player",
  "duplicate Player",
  "ineligible Player",
  "invalid outcome",
] as const)("rejects %s without changing saved results even with impact approval", async (invalid) => {
  const { game, maya, rowan, round } = await winnerGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const scores = [
    { playerId: maya.id, won: false },
    { playerId: rowan.id, won: true },
  ];
  if (invalid === "no winner") scores[1].won = false;
  if (invalid === "two winners") scores[0].won = true;
  if (invalid === "missing Player") scores.pop();
  if (invalid === "duplicate Player") scores[1].playerId = maya.id;
  if (invalid === "ineligible Player") {
    const outsider = await playersApi.create({ name: "Sol", color: "Lime", isFavorite: 0 });
    scores[1].playerId = outsider.id;
  }
  if (invalid === "invalid outcome") Object.assign(scores[1], { won: 1 });
  const input: EditGenericWinnerRoundInput = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "singleRoundWinner",
    scores,
    confirmImpact: true,
  };
  const before = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.previewEdit(input)).rejects.toThrow(/winner|Player/);
  await expect(genericRoundsApi.edit(input)).rejects.toThrow(/winner|Player/);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
});

it("preserves later Rounds, shared places, and explicit manual completion after a correction", async () => {
  const { game, maya, rowan, round } = await winnerGame();
  const second = await genericRoundsApi.add({
    gameId: game.id,
    mode: "singleRoundWinner",
    scores: [
      { playerId: maya.id, won: true },
      { playerId: rowan.id, won: false },
    ],
  });
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input: EditGenericWinnerRoundInput = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "singleRoundWinner",
    scores: [
      { playerId: maya.id, won: false },
      { playerId: rowan.id, won: true },
    ],
    confirmImpact: true,
  };
  await genericRoundsApi.edit(input);
  closeDB();
  expect((await genericRoundsApi.getByGameId(game.id))[1]).toEqual(second);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active" },
    standings: [
      { player: { id: maya.id }, place: 1, totalWins: 1 },
      { player: { id: rowan.id }, place: 1, totalWins: 1 },
    ],
    rounds: [
      { roundNumber: 1, scores: [{ totalWins: 0 }, { totalWins: 1 }] },
      { roundNumber: 2, scores: [{ totalWins: 1 }, { totalWins: 1 }] },
    ],
  });
  expect(await genericGamesApi.finish(game.id)).toMatchObject({
    status: "completed",
    completionType: "manual",
    winnerIds: [maya.id, rowan.id],
  });
  await expect(genericRoundsApi.getEditor(game.id, round.id)).rejects.toThrow("Completed");
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("Completed");
  closeDB();
  expect((await genericGamesApi.getScoreboard(game.id))?.game).toMatchObject({
    status: "completed",
    winnerIds: [maya.id, rowan.id],
  });
});

it("rejects stale approval after later play and rejects a mismatched Scoring Mode atomically", async () => {
  const { game, maya, rowan, round } = await winnerGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const input: EditGenericWinnerRoundInput = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "singleRoundWinner",
    scores: [
      { playerId: maya.id, won: false },
      { playerId: rowan.id, won: true },
    ],
    confirmImpact: true,
  };
  expect(await genericRoundsApi.previewEdit(input)).toEqual({ requiresConfirmation: true });
  const second = await genericRoundsApi.add({
    gameId: game.id,
    mode: "singleRoundWinner",
    scores: [
      { playerId: maya.id, won: true },
      { playerId: rowan.id, won: false },
    ],
  });
  const before = await genericGamesApi.getScoreboard(game.id);
  await expect(genericRoundsApi.edit(input)).rejects.toThrow("history changed");
  const current = await genericRoundsApi.getEditor(game.id, round.id);
  await expect(
    genericRoundsApi.edit({
      ...input,
      version: current.version,
      mode: "points",
      scores: [
        { playerId: maya.id, points: "5" },
        { playerId: rowan.id, points: "0" },
      ],
    }),
  ).rejects.toThrow("mode");
  await expect(
    genericRoundsApi.edit({
      ...input,
      version: current.version,
      roundId: "missing-round",
    }),
  ).rejects.toThrow("read-only");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round, second]);
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
});

it("rolls back failed corrections, retains the retry input, and commits concurrent retries only once", async () => {
  const { game, maya, rowan, round } = await winnerGame();
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const before = await genericGamesApi.getScoreboard(game.id);
  const input: EditGenericWinnerRoundInput = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    mode: "singleRoundWinner",
    scores: [
      { playerId: maya.id, won: false },
      { playerId: rowan.id, won: true },
    ],
    confirmImpact: true,
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
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  const results = await Promise.allSettled([
    genericRoundsApi.edit(input),
    genericRoundsApi.edit(input),
  ]);
  expect(results.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toMatchObject([
    { id: round.id, revision: 1, scores: [{ won: false }, { won: true }] },
  ]);
  expect((await genericGamesApi.getScoreboard(game.id))?.players).toMatchObject([
    { id: maya.id, totalWins: 0 },
    { id: rowan.id, totalWins: 1 },
  ]);
});
