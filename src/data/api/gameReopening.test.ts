import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GenericGameSettings, ScorekeeperId } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

async function resetDatabase() {
  vi.restoreAllMocks();
  closeDB();
  await deleteDB("phase10-db");
}

beforeEach(resetDatabase);
afterEach(resetDatabase);

it.each<GenericGameSettings>([
  { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: true },
  { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: true },
  { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  { mode: "passFail", tiebreaker: null, dealer: true },
])("reopens the same Generic $mode Game with live identities and replaces its result on refinalization ($tiebreaker)", async (settings) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [amy.id, bob.id],
    settings,
  });
  const round = await genericRoundsApi.add(
    settings.mode === "points"
      ? {
          gameId: game.id,
          mode: settings.mode,
          scores: [
            { playerId: amy.id, points: "10", tiebreaker: "2" },
            { playerId: bob.id, points: "5", tiebreaker: "3" },
          ],
        }
      : settings.mode === "singleRoundWinner"
        ? {
            gameId: game.id,
            mode: settings.mode,
            scores: [
              { playerId: amy.id, won: true },
              { playerId: bob.id, won: false },
            ],
          }
        : {
            gameId: game.id,
            mode: settings.mode,
            scores: [
              { playerId: amy.id, passed: true },
              { playerId: bob.id, passed: false },
            ],
          },
  );
  if (!round.id) throw new Error("Missing saved Round identity");
  const completed = await genericGamesApi.finish(game.id);
  const renamed = await playersApi.update(amy.id, { name: "Amelia", color: "Lime" });
  expect((await genericGamesApi.getDetail(game.id))?.players[0]).toEqual({
    id: amy.id,
    name: "Amy",
    color: "Jam",
  });
  await genericGamesApi.reopen(game.id, JSON.stringify(completed));
  closeDB();
  const active = await genericGamesApi.getDetail(game.id);
  expect(active?.game).toMatchObject({ id: game.id, status: "active", createdAt: game.createdAt });
  expect(active?.players).toEqual([renamed, bob]);
  expect(active?.game).not.toHaveProperty("winnerIds");
  expect(active?.game).not.toHaveProperty("playerSnapshots");
  expect(active?.game).not.toHaveProperty("completedAt");
  expect(active?.game).not.toHaveProperty("completionOrder");
  expect(active?.game).not.toHaveProperty("completionType");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  const editor = await genericRoundsApi.getEditor(game.id, round.id);
  const metadata = {
    gameId: game.id,
    roundId: round.id,
    version: editor.version,
    confirmImpact: true,
  };
  await genericRoundsApi.edit(
    settings.mode === "points"
      ? {
          ...metadata,
          mode: settings.mode,
          scores: [
            { playerId: amy.id, points: "-1", tiebreaker: "2" },
            { playerId: bob.id, points: "5", tiebreaker: "3" },
          ],
        }
      : settings.mode === "singleRoundWinner"
        ? {
            ...metadata,
            mode: settings.mode,
            scores: [
              { playerId: amy.id, won: false },
              { playerId: bob.id, won: true },
            ],
          }
        : {
            ...metadata,
            mode: settings.mode,
            scores: [
              { playerId: amy.id, passed: false },
              { playerId: bob.id, passed: true },
            ],
          },
  );
  expect((await genericGamesApi.getById(game.id))?.status).toBe("active");
  await genericGamesApi.finish(game.id);
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toMatchObject({
    id: game.id,
    status: "completed",
    winnerIds: [bob.id],
    playerSnapshots: [
      { id: amy.id, name: "Amelia", color: "Lime" },
      { id: bob.id, name: "Bob", color: "Ocean" },
    ],
  });
  expect(await genericGamesApi.getList()).toHaveLength(1);
});

async function completedGame(owner: ScorekeeperId, withdraw = false) {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam"].map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const ids = players.map(({ id }) => id);
  const game =
    owner === "phase10"
      ? await gamesApi.create({
          players: ids,
          phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1"] },
          settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
        })
      : await genericGamesApi.create({
          players: ids,
          settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: true },
        });
  const api = owner === "phase10" ? gamesApi : genericGamesApi;
  if (withdraw) {
    const editor = await api.getEditor(game.id);
    if (!editor) throw new Error("Missing Game editor");
    await api.edit({
      gameId: game.id,
      version: editor.version,
      players: ids,
      withdrawnPlayers: [ids[2]],
    });
  }
  if (owner === "phase10") {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: ids[0], phaseStatus: "failed", score: 1 },
        { playerId: ids[1], phaseStatus: "failed", score: 2 },
        ...(withdraw ? [] : [{ playerId: ids[2], phaseStatus: "failed" as const, score: 3 }]),
      ],
    });
  } else {
    await genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: ids.slice(0, withdraw ? 2 : 3).map((playerId) => ({ playerId, points: "1" })),
    });
  }
  return { api, game: await api.finish(game.id), players };
}

it.each([
  "phase10",
  "generic",
] as const)("rejects reopening %s when a withdrawn saved Player is missing, preserving the completed snapshot and history", async (owner) => {
  const { api, game, players } = await completedGame(owner, true);
  const before =
    owner === "phase10"
      ? await gamesApi.getView(game.id)
      : await genericGamesApi.getScoreboard(game.id);
  await playersApi.delete(players[2].id);
  await expect(api.reopen(game.id, JSON.stringify(game))).rejects.toThrow(
    "Player no longer exists",
  );
  closeDB();
  expect(await api.getById(game.id)).toEqual(game);
  const after =
    owner === "phase10"
      ? await gamesApi.getView(game.id)
      : await genericGamesApi.getScoreboard(game.id);
  expect(after).toEqual(before);
  expect(after?.standings).toBeDefined();
  expect(await playersApi.getById(players[2].id)).toBeUndefined();
});

it.each([
  "phase10",
  "generic",
] as const)("rejects stale, foreign and duplicate %s reopening commands without partial updates", async (owner) => {
  const { api, game } = await completedGame(owner);
  await expect(api.reopen(game.id, "{}")).rejects.toThrow("Game changed");
  await expect(api.reopen("missing", JSON.stringify(game))).rejects.toThrow("not found");
  const foreignApi = owner === "phase10" ? genericGamesApi : gamesApi;
  await expect(foreignApi.reopen(game.id, JSON.stringify(game))).rejects.toThrow("not found");
  expect(await api.getById(game.id)).toEqual(game);
  const outcomes = await Promise.allSettled([
    api.reopen(game.id, JSON.stringify(game)),
    api.reopen(game.id, JSON.stringify(game)),
  ]);
  expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
  closeDB();
  expect((await api.getById(game.id))?.status).toBe("active");
  expect(await api.getList()).toHaveLength(1);
});

it.each([
  "phase10",
  "generic",
] as const)("preserves the finalized %s result when reopening cannot be persisted", async (owner) => {
  const { api, game } = await completedGame(owner);
  const before =
    owner === "phase10"
      ? await gamesApi.getView(game.id)
      : await genericGamesApi.getScoreboard(game.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === "games") throw new DOMException("Reopen write failed", "QuotaExceededError");
    return put.call(this, value, key);
  });
  await expect(api.reopen(game.id, JSON.stringify(game))).rejects.toThrow("Reopen write failed");
  failure.mockRestore();
  closeDB();
  expect(await api.getById(game.id)).toEqual(game);
  expect(
    owner === "phase10"
      ? await gamesApi.getView(game.id)
      : await genericGamesApi.getScoreboard(game.id),
  ).toEqual(before);
  await api.reopen(game.id, JSON.stringify(game));
  closeDB();
  expect((await api.getById(game.id))?.status).toBe("active");
});

it.each([
  "round",
  "score",
] as const)("keeps explicit Phase 10 reopening distinct from pending first-finisher recovery until a %s correction is saved", async (edit) => {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam"].map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await gamesApi.create({
    players: players.map(({ id }) => id),
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: players[0].id, phaseStatus: "completed", score: 0 },
      { playerId: players[1].id, phaseStatus: "failed", score: 1 },
      { playerId: players[2].id, phaseStatus: "failed", score: 2 },
    ],
  });
  const choice = (await gamesApi.getView(game.id))?.pendingFinishChoice;
  if (!choice) throw new Error("Missing first-finisher choice");
  const completed = await gamesApi.resolveFinishChoice(game.id, "finish", choice.token);
  await playersApi.update(players[0].id, { name: "Amelia", color: "Lime" });
  await gamesApi.reopen(game.id, JSON.stringify(completed));
  closeDB();
  const reopened = await gamesApi.getView(game.id);
  expect(reopened?.game).toMatchObject({ id: game.id, status: "active" });
  expect(reopened?.players[0]).toMatchObject({ name: "Amelia", color: "Lime" });
  expect(reopened?.pendingFinishChoice).toBeNull();
  expect(reopened?.game).not.toHaveProperty("winnerIds");
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: players[1].id, phaseStatus: "failed", score: 0 },
        { playerId: players[2].id, phaseStatus: "failed", score: 0 },
      ],
    }),
  ).rejects.toThrow("Correct a saved Round");
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  if (edit === "round") {
    await gamesApi.editRound({
      gameId: game.id,
      roundNumber: 1,
      version: editor.version,
      roundWinnerId: null,
      scores: [
        { ...editor.round.scores[0], score: 1 },
        editor.round.scores[1],
        editor.round.scores[2],
      ],
      confirmImpact: true,
    });
  } else {
    await roundsApi.edit(game.id, 1, players[0].id, { score: 1 });
  }
  closeDB();
  const corrected = await gamesApi.getView(game.id);
  expect(corrected?.game.status).toBe("active");
  expect(corrected?.pendingFinishChoice?.winner.name).toBe("Amelia");
  if (!corrected?.pendingFinishChoice) throw new Error("Missing post-save choice");
  await gamesApi.resolveFinishChoice(game.id, "finish", corrected.pendingFinishChoice.token);
  closeDB();
  expect(await gamesApi.getById(game.id)).toMatchObject({
    status: "completed",
    winnerIds: [players[0].id],
    playerSnapshots: [
      { id: players[0].id, name: "Amelia", color: "Lime" },
      { id: players[1].id, name: "Bob", color: "Jam" },
      { id: players[2].id, name: "Cam", color: "Jam" },
    ],
  });
});

it("reapplies automatic completion after every Phase correction and restores excluded history when a correction removes the finish", async () => {
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
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  for (const phaseStatus of ["failed", "completed", "failed"] as const) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus, score: 1 },
        { playerId: bob.id, phaseStatus: "failed", score: 2 },
      ],
    });
  }
  const tail = (await roundsApi.getByGameId(game.id))[2];
  await gamesApi.finish(game.id);
  async function reopen() {
    const saved = await gamesApi.getById(game.id);
    await gamesApi.reopen(game.id, JSON.stringify(saved));
    closeDB();
  }
  async function correctFirstRound(phaseStatus: "completed" | "failed", score: number) {
    const editor = await gamesApi.getRoundEditor(game.id, 1);
    return gamesApi.editRound({
      gameId: game.id,
      roundNumber: 1,
      version: editor.version,
      roundWinnerId: null,
      scores: [{ ...editor.round.scores[0], phaseStatus, score }, editor.round.scores[1]],
      confirmImpact: true,
    });
  }
  await reopen();
  expect((await correctFirstRound("completed", 1)).outcome).toBe("gameCompleted");
  closeDB();
  const excluded = await gamesApi.getView(game.id);
  expect(excluded?.gameEndingRound).toBe(2);
  expect(excluded?.rounds[2]).toMatchObject({ source: tail, counted: false });

  await reopen();
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing Game editor");
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  await expect(
    gamesApi.edit({
      gameId: game.id,
      version: editor.version,
      players: [...game.players, cam.id],
      confirmImpact: true,
    }),
  ).rejects.toThrow("Finish Game");
  expect((await correctFirstRound("completed", 2)).outcome).toBe("gameCompleted");
  closeDB();
  expect((await gamesApi.getView(game.id))?.game.status).toBe("completed");
  await expect(correctFirstRound("failed", 1)).rejects.toThrow("completed");

  await reopen();
  expect((await correctFirstRound("failed", 1)).outcome).toBe("roundEdited");
  closeDB();
  const restored = await gamesApi.getView(game.id);
  expect(restored?.game.status).toBe("active");
  expect(restored?.gameEndingRound).toBeNull();
  expect(restored?.rounds[2]).toMatchObject({ source: tail, counted: true });
  expect(restored?.players[0]).toMatchObject({
    progress: { currentPhase: 2, isFinished: false },
    tiebreakerTotal: 3,
  });
  expect(restored?.game).not.toHaveProperty("playerSnapshots");
});

it.each([
  2, 3,
])("runs normal post-save completion when deleting a retained Round through the public Round API with %s Players", async (playerCount) => {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam"]
      .slice(0, playerCount)
      .map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await gamesApi.create({
    players: players.map(({ id }) => id),
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["classic-1", "classic-2"],
    },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  for (let number = 1; number <= 3; number++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: players[0].id, phaseStatus: "failed", score: 1 },
        { playerId: players[1].id, phaseStatus: "failed", score: 2 },
        ...(players[2]
          ? [{ playerId: players[2].id, phaseStatus: "failed" as const, score: 3 }]
          : []),
      ],
    });
  }
  await roundsApi.edit(game.id, 1, players[0].id, { phaseStatus: "completed" });
  await roundsApi.edit(game.id, 2, players[0].id, { phaseStatus: "completed" });
  const before = await gamesApi.getView(game.id);
  if (!before) throw new Error("Missing Game");
  if (before.pendingFinishChoice) {
    await gamesApi.resolveFinishChoice(game.id, "finish", before.pendingFinishChoice.token);
  }
  await gamesApi.reopen(game.id, JSON.stringify(await gamesApi.getById(game.id)));
  await roundsApi.delete(game.id, 3);
  closeDB();
  const corrected = await gamesApi.getView(game.id);
  expect(corrected?.rounds).toHaveLength(2);
  expect(corrected?.game.status).toBe(playerCount === 2 ? "completed" : "active");
  if (playerCount === 2) {
    expect(corrected?.game).toMatchObject({ winnerIds: [players[0].id] });
  } else {
    expect(corrected?.pendingFinishChoice?.winner.id).toBe(players[0].id);
  }
});
