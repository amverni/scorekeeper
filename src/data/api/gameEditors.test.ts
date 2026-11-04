import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { phaseSetsApi } from "./phaseSets";
import { phasesApi } from "./phases";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}

beforeEach(resetDatabase);
afterEach(resetDatabase);

it("rejects a recoverable draft association when an unplayed removed occurrence's number is reused", async () => {
  const players = await Promise.all(
    ["Amy", "Bob"].map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await gamesApi.create({
    players: players.map(({ id }) => id),
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["classic-1", "classic-2", "classic-3"],
    },
    settings: {
      inOrderPhases: false,
      tiebreaker: "fewestWilds",
      roundSkipPenalty: 0,
      sitOutPenalty: 0,
    },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: players[0].id, phaseStatus: "failed", score: 0, selectedPhase: 1 },
      { playerId: players[1].id, phaseStatus: "failed", score: 0, selectedPhase: 1 },
    ],
  });
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  await gamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: [game.phaseOccurrences[0], game.phaseOccurrences[2]],
  });
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        {
          playerId: players[0].id,
          phaseStatus: "failed",
          score: 3,
          selectedPhase: 2,
          selectedPhaseOccurrenceId: game.phaseOccurrences[1].id,
        },
        {
          playerId: players[1].id,
          phaseStatus: "failed",
          score: 3,
          selectedPhase: 2,
          selectedPhaseOccurrenceId: game.phaseOccurrences[1].id,
        },
      ],
    }),
  ).rejects.toThrow("Choose a Remaining Phase");
  expect(await roundsApi.getByGameId(game.id)).toHaveLength(1);
});

it("keeps a retained Removed Phase numbered after its last reference is deleted and an earlier unplayed Phase is removed", async () => {
  const players = await Promise.all(
    ["Amy", "Bob"].map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await gamesApi.create({
    players: players.map(({ id }) => id),
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["classic-1", "classic-2", "classic-3", "classic-4"],
    },
    settings: {
      inOrderPhases: false,
      tiebreaker: "fewestWilds",
      roundSkipPenalty: 0,
      sitOutPenalty: 0,
    },
  });
  for (const selectedPhase of [1, 3]) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: players[0].id, phaseStatus: "failed", score: 0, selectedPhase },
        { playerId: players[1].id, phaseStatus: "failed", score: 0, selectedPhase },
      ],
    });
  }
  let editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const removal = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: game.phaseOccurrences.filter((_, index) => index !== 2),
  };
  const review = await gamesApi.previewEdit(removal);
  await gamesApi.edit({ ...removal, approval: { token: review.token } });
  const round = await gamesApi.getRoundEditor(game.id, 2);
  await gamesApi.deleteRound({ gameId: game.id, version: round.version, roundId: round.round.id });
  editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const options = await gamesApi.getPhaseRemovalOptions({
    gameId: game.id,
    version: editor.version,
    players: game.players,
  });
  expect(options[1].retainSlot).toBe(true);
  await gamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: editor.game.phaseOccurrences.filter((_, index) => index !== 1),
  });
  closeDB();
  expect((await gamesApi.getById(game.id))?.phaseOccurrences).toEqual([
    game.phaseOccurrences[0],
    { ...game.phaseOccurrences[1], removed: true },
    { ...game.phaseOccurrences[2], removed: true },
    game.phaseOccurrences[3],
  ]);
});

it("includes Finished Players when a final draft Withdraws every unresolved Player", async () => {
  const players = await Promise.all(
    ["Amy", "Bob", "Cam", "Dee", "Eve"].map((name) =>
      playersApi.create({ name, color: "Jam", isFavorite: 0 }),
    ),
  );
  const game = await gamesApi.create({
    players: players.map(({ id }) => id),
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  for (let roundNumber = 1; roundNumber <= 2; roundNumber++) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: players[0].id,
      scores: [
        { playerId: players[0].id, phaseStatus: "completed", score: 0 },
        { playerId: players[1].id, phaseStatus: "skipped", score: 0 },
        { playerId: players[2].id, phaseStatus: "failed", score: 0 },
        { playerId: players[3].id, phaseStatus: "failed", score: 0 },
        { playerId: players[4].id, phaseStatus: "failed", score: 0 },
      ],
    });
  }
  const pending = await gamesApi.getView(game.id);
  if (!pending?.pendingFinishChoice) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", pending.pendingFinishChoice.token);
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  expect(editor.finishedPlayers).toEqual([players[0].id, players[1].id]);
  await expect(
    gamesApi.previewEdit({
      gameId: game.id,
      version: editor.version,
      players: game.players,
      withdrawnPlayers: players.slice(2).map(({ id }) => id),
      phaseOccurrences: [game.phaseOccurrences[1]],
    }),
  ).rejects.toThrow("every eligible Player");
  expect(await gamesApi.getById(game.id)).toEqual(editor.game);
});

it("rolls back combined history-bearing removal and Join, rejects stale approval, and retains exact saved history", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["classic-1", "classic-2", "classic-3"],
    },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 1 },
      { playerId: bob.id, phaseStatus: "satOut", score: 0 },
    ],
  });
  const before = await gamesApi.getView(game.id);
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [...game.players, cam.id],
    phaseOccurrences: game.phaseOccurrences.slice(1),
  };
  const review = await gamesApi.previewEdit(input);
  expect(review.effects.map(({ type }) => type)).toEqual(["join", "phaseRemoval"]);
  const approved = { ...input, approval: { token: review.token } };
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (value?.id === game.id) throw new DOMException("Storage unavailable", "QuotaExceededError");
    return put.call(this, value, key);
  });
  try {
    await expect(gamesApi.edit(approved)).rejects.toThrow("Storage unavailable");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  const correction = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 1,
    version: correction.version,
    roundWinnerId: null,
    scores: correction.round.scores.map((entry) =>
      entry.playerId === amy.id ? { ...entry, score: 2 } : entry,
    ),
  });
  const corrected = await gamesApi.getView(game.id);
  await expect(gamesApi.previewEdit(input)).rejects.toThrow("history changed");
  await expect(gamesApi.edit(approved)).rejects.toThrow("history changed");
  expect(await gamesApi.getView(game.id)).toEqual(corrected);
  if (!corrected) throw new Error("Missing Game view");
  const retry = { ...input, version: corrected.version };
  const freshReview = await gamesApi.previewEdit(retry);
  await gamesApi.edit({ ...retry, approval: { token: freshReview.token } });
  closeDB();
  expect(await roundsApi.getByGameId(game.id)).toEqual(
    corrected.rounds.map(({ source }) => source),
  );
  expect((await gamesApi.getView(game.id))?.players[2]).toMatchObject({
    id: cam.id,
    tiebreakerTotal: 0,
  });
});

it("keeps retained Removed Phase slots fixed even after the only saved Round is deleted", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 0 },
    ],
  });
  let editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const removal = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: [game.phaseOccurrences[1]],
  };
  const review = await gamesApi.previewEdit(removal);
  await gamesApi.edit({ ...removal, approval: { token: review.token } });
  const round = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.deleteRound({ gameId: game.id, version: round.version, roundId: round.round.id });
  editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  expect(editor.canEditPhases).toBe(false);
  await expect(
    gamesApi.previewEdit({
      ...removal,
      version: editor.version,
      phaseOccurrences: [...editor.game.phaseOccurrences].reverse(),
    }),
  ).rejects.toThrow("added or reordered");
});

it("inspects removal controls against the draft roster without persisting or accepting invalid removals", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id, cam.id],
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "skipped", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 0 },
    ],
  });
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const input = { gameId: game.id, version: editor.version, players: game.players };
  expect((await gamesApi.getPhaseRemovalOptions(input))[0]).toMatchObject({
    occurrenceId: game.phaseOccurrences[0].id,
    phaseNumber: 1,
    retainSlot: true,
    reason: null,
  });
  expect(
    (await gamesApi.getPhaseRemovalOptions({ ...input, withdrawnPlayers: [cam.id] }))[0],
  ).toMatchObject({ reason: expect.stringContaining("every eligible Player") });
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(editor.game);
});

it.each([
  "continue",
  "finish",
  "automatic",
] as const)("reviews a finish caused by unused-tail removal and saves the approved %s policy atomically", async (choice) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await gamesApi.create({
    players: choice === "automatic" ? [amy.id, bob.id] : [amy.id, bob.id, cam.id],
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: game.players.map((playerId) => ({
      playerId,
      phaseStatus: playerId === amy.id ? "completed" : "failed",
      score: 2,
    })) as Parameters<typeof roundsApi.add>[0]["scores"],
  });
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: [game.phaseOccurrences[0]],
  };
  const review = await gamesApi.previewEdit(input);
  expect(review.requiresConfirmation).toBe(true);
  expect(review.effects).toEqual([expect.objectContaining({ type: "finished", players: [amy] })]);
  expect(review.completion).toMatchObject({
    type: choice === "automatic" ? "automatic" : "choice",
    winner: amy,
    gameEndingRound: 1,
  });
  await expect(gamesApi.edit(input)).rejects.toThrow("Confirm");
  const approved = {
    ...input,
    approval: {
      token: review.token,
      ...(choice === "automatic" ? {} : { finishChoice: choice }),
    },
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
  try {
    await expect(gamesApi.edit(approved)).rejects.toThrow("Storage unavailable");
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(editor.game);
  await gamesApi.edit(approved);
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.game.status).toBe(choice === "continue" ? "active" : "completed");
  expect(view?.pendingFinishChoice).toBeNull();
  expect(view?.players[0]).toMatchObject({ finishingRound: 1, finishingPlace: 1 });
  expect(view?.rounds).toHaveLength(1);
  await expect(gamesApi.edit(approved)).rejects.toThrow(
    choice === "continue" ? "history changed" : "completed",
  );
  if (choice === "continue") {
    const current = await gamesApi.getEditor(game.id);
    if (!current) throw new Error("Missing editor");
    await expect(
      gamesApi.previewEdit({
        ...input,
        version: current.version,
        phaseOccurrences: [],
      }),
    ).rejects.toThrow("At least one required Phase");
  }
});

it.each([
  "lowestPoints",
  "highestPoints",
  "fewestSkips",
  "mostSkipped",
  "fewestWilds",
  "roundsWon",
] as const)("excludes only Removed Phase entries for %s without replacing a recorded winner", async (tiebreaker) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const points = tiebreaker === "lowestPoints" || tiebreaker === "highestPoints";
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["classic-1", "classic-2", "classic-3"],
    },
    settings: { inOrderPhases: false, tiebreaker, roundSkipPenalty: 100, sitOutPenalty: 0 },
  });
  const cards = { p5: 10, p10: 0, skipCard: 0, wild: 0 };
  const zero = { p5: 0, p10: 0, skipCard: 0, wild: 0 };
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "completed",
        score: points ? 0 : 2,
        selectedPhase: 1,
        ...(points ? { pointsCardBreakdown: zero } : {}),
      },
      {
        playerId: bob.id,
        phaseStatus: "failed",
        score: points ? 50 : 3,
        selectedPhase: 2,
        ...(points ? { pointsCardBreakdown: cards } : {}),
      },
    ],
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      {
        playerId: amy.id,
        phaseStatus: "failed",
        score: points ? 50 : 4,
        selectedPhase: 2,
        ...(points ? { pointsCardBreakdown: cards } : {}),
      },
      {
        playerId: bob.id,
        phaseStatus: "completed",
        score: points ? 0 : 5,
        selectedPhase: 2,
        ...(points ? { pointsCardBreakdown: zero } : {}),
      },
    ],
  });
  const history = await roundsApi.getByGameId(game.id);
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: game.phaseOccurrences.slice(1),
  };
  const review = await gamesApi.previewEdit(input);
  await gamesApi.edit({ ...input, approval: { token: review.token } });
  closeDB();
  expect(await roundsApi.getByGameId(game.id)).toEqual(history);
  const view = await gamesApi.getView(game.id);
  expect(view?.players.map(({ tiebreakerTotal }) => tiebreakerTotal)).toEqual(
    points ? [50, 50] : tiebreaker === "roundsWon" ? [0, 1] : [4, 8],
  );
  expect(view?.rounds[0].source.roundWinnerId).toBe(amy.id);
  expect(view?.rounds[0].scores.map(({ counted }) => counted)).toEqual([false, true]);
  expect(view?.players[1].progress.selectable).toEqual({ resolvedPhases: [2], totalPhases: 2 });
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: "satOut", score: 0, selectedPhase: 1 },
        { playerId: bob.id, phaseStatus: "satOut", score: 0, selectedPhase: 3 },
      ],
    }),
  ).rejects.toThrow("Removed Phase");
});

it("drops unused trailing slots without warning but retains unplayed historical-number anchors and warns for zero-valued attempts", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Short",
      phases: ["classic-1", "classic-2", "classic-3", "classic-4"],
    },
    settings: {
      inOrderPhases: false,
      tiebreaker: "fewestWilds",
      roundSkipPenalty: 0,
      sitOutPenalty: 0,
    },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 0, selectedPhase: 3 },
      { playerId: bob.id, phaseStatus: "satOut", score: 0, selectedPhase: 3 },
    ],
  });
  const history = await roundsApi.getByGameId(game.id);
  let editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const tail = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: game.phaseOccurrences.slice(0, 3),
  };
  expect((await gamesApi.previewEdit(tail)).requiresConfirmation).toBe(false);
  await gamesApi.edit(tail);
  editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const input = {
    ...tail,
    version: editor.version,
    phaseOccurrences: [game.phaseOccurrences[1]],
  };
  const preview = await gamesApi.previewEdit(input);
  expect(preview.effects).toEqual([
    expect.objectContaining({ type: "phaseRemoval", phaseNumbers: [3], resolvedPhaseNumbers: [] }),
  ]);
  expect(preview.requiresConfirmation).toBe(true);
  await gamesApi.edit({ ...input, approval: { token: preview.token } });
  closeDB();
  expect((await gamesApi.getById(game.id))?.phaseOccurrences).toEqual([
    { ...game.phaseOccurrences[0], removed: true },
    game.phaseOccurrences[1],
    { ...game.phaseOccurrences[2], removed: true },
  ]);
  expect(await roundsApi.getByGameId(game.id)).toEqual(history);
  expect((await gamesApi.getView(game.id))?.players[0].progress.selectable).toEqual({
    resolvedPhases: [],
    totalPhases: 1,
  });
});

it("protects Passed and Round Skip resolutions using the final Join, Withdrawal and Rejoin roster", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const dee = await playersApi.create({ name: "Dee", color: "Jam", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id, cam.id],
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 0 },
      { playerId: bob.id, phaseStatus: "skipped", score: 0 },
      { playerId: cam.id, phaseStatus: "failed", score: 2 },
    ],
  });
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const removal = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    withdrawnPlayers: [cam.id],
    phaseOccurrences: [game.phaseOccurrences[1]],
  };
  await expect(gamesApi.previewEdit(removal)).rejects.toThrow("every eligible Player");
  await expect(gamesApi.edit({ ...removal, approval: { token: "forced" } })).rejects.toThrow(
    "every eligible Player",
  );
  const joined = await gamesApi.previewEdit({ ...removal, players: [...game.players, dee.id] });
  expect(joined.requiresConfirmation).toBe(true);
  expect(await gamesApi.getById(game.id)).toEqual(editor.game);
  const withdrawal = { ...removal, phaseOccurrences: game.phaseOccurrences };
  const preview = await gamesApi.previewEdit(withdrawal);
  await gamesApi.edit({ ...withdrawal, approval: { token: preview.token } });
  const withdrawn = await gamesApi.getEditor(game.id);
  if (!withdrawn) throw new Error("Missing editor");
  await expect(gamesApi.previewEdit({ ...removal, version: withdrawn.version })).rejects.toThrow(
    "every eligible Player",
  );
  const rejoin = { ...removal, version: withdrawn.version, withdrawnPlayers: [] };
  const review = await gamesApi.previewEdit(rejoin);
  await gamesApi.edit({ ...rejoin, approval: { token: review.token } });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.players.map(({ place }) => place)).not.toContain(null);
  expect(view?.players.map(({ progress }) => progress.currentPhase)).toEqual([2, 2, 2]);
});

it.each([
  true,
  false,
])("removes a history-bearing occurrence without changing saved Rounds and counts other entries (in order: %s)", async (inOrderPhases) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Repeated",
      phases: ["classic-1", "classic-1", "classic-2"],
    },
    settings: { inOrderPhases, tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 2, selectedPhase: 1 },
      { playerId: bob.id, phaseStatus: "failed", score: 3, selectedPhase: 1 },
    ],
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 4, selectedPhase: 2 },
      { playerId: bob.id, phaseStatus: "satOut", score: 0, selectedPhase: 1 },
    ],
  });
  const history = await roundsApi.getByGameId(game.id);
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const input = {
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: game.phaseOccurrences.slice(1),
  };
  const preview = await gamesApi.previewEdit(input);
  expect(preview.requiresConfirmation).toBe(true);
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(editor.game);
  expect(await roundsApi.getByGameId(game.id)).toEqual(history);
  await gamesApi.edit({ ...input, approval: { token: preview.token } });
  closeDB();
  const saved = await gamesApi.getById(game.id);
  expect(saved?.phaseOccurrences).toEqual([
    { ...game.phaseOccurrences[0], removed: true },
    ...game.phaseOccurrences.slice(1),
  ]);
  expect(await roundsApi.getByGameId(game.id)).toEqual(history);
  const view = await gamesApi.getView(game.id);
  expect(view?.players.map(({ tiebreakerTotal }) => tiebreakerTotal)).toEqual([4, 0]);
  expect(view?.players.map(({ progress }) => progress.currentPhase)).toEqual([2, 2]);
  expect(view?.rounds[0].scores.map(({ counted }) => counted)).toEqual([false, false]);
  expect(view?.rounds[1].scores.map(({ counted }) => counted)).toEqual([true, false]);
  expect(view?.rounds[0].scores[0]).toMatchObject({
    phaseNumber: 1,
    phaseOccurrenceId: game.phaseOccurrences[0].id,
    exclusionReason: "Removed Phase",
  });
  expect((await gamesApi.getPhaseOptions(game.id)).map(({ phaseNumber }) => phaseNumber)).toEqual([
    2, 3,
  ]);
});

it("inspects the saved Phase Game and ordered Phase positions without changing persistence", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [bob.id, amy.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Saved phases",
      phases: ["classic-2", "classic-1", "classic-2"],
    },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 45, sitOutPenalty: 15 },
  });

  closeDB();
  await playersApi.update(amy.id, { name: "Amelia", color: "Lime" });
  const editor = await gamesApi.getEditor(game.id);
  expect(editor?.game).toEqual(game);
  expect(editor?.players.map(({ id }) => id)).toEqual([bob.id, amy.id]);
  expect(editor?.players[1]).toMatchObject({ name: "Amelia", color: "Lime" });
  expect(editor?.phases.map(({ id }) => id)).toEqual(["classic-2", "classic-1", "classic-2"]);
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(game);
  expect(await gamesApi.getAll()).toHaveLength(1);
});

it("stages pre-Round occurrence additions, removal and order with membership, then saves one durable Game", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "short",
      type: "temporary",
      name: "Repeated phases",
      phases: ["classic-1", "classic-2", "classic-1"],
    },
    settings: {
      inOrderPhases: false,
      tiebreaker: "fewestWilds",
      roundSkipPenalty: 0,
      sitOutPenalty: 0,
    },
  });
  expect(game.phaseOccurrences).toEqual([
    { id: expect.any(String), phaseId: "classic-1" },
    { id: expect.any(String), phaseId: "classic-2" },
    { id: expect.any(String), phaseId: "classic-1" },
  ]);
  expect(new Set(game.phaseOccurrences.map(({ id }) => id)).size).toBe(3);
  const other = await gamesApi.create({
    players: game.players,
    phaseSet: game.phaseSet,
    settings: game.settings,
  });
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  expect(editor.canEditPhases).toBe(true);
  const added = { id: crypto.randomUUID(), phaseId: "classic-3" };
  const input = {
    gameId: game.id,
    version: editor.version,
    players: [...game.players, cam.id],
    phaseOccurrences: [added, game.phaseOccurrences[2], game.phaseOccurrences[0]],
  };
  const preview = await gamesApi.previewEdit(input);
  expect(preview.requiresConfirmation).toBe(false);
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(game);
  const saved = await gamesApi.edit(input);
  expect(saved.phaseOccurrences).toEqual(input.phaseOccurrences);
  expect(saved.phaseSet.phases).toEqual(["classic-3", "classic-1", "classic-1"]);
  expect(saved.settings).toEqual(game.settings);
  expect(saved.players).toEqual(input.players);
  closeDB();
  expect(await gamesApi.getById(game.id)).toEqual(saved);
  expect((await gamesApi.getEditor(game.id))?.phases.map(({ id }) => id)).toEqual([
    "classic-3",
    "classic-1",
    "classic-1",
  ]);
  expect((await gamesApi.getPhaseOptions(game.id)).map(({ phaseNumber }) => phaseNumber)).toEqual([
    1, 2, 3,
  ]);
  expect(await gamesApi.getById(other.id)).toEqual(other);
  await expect(gamesApi.edit(input)).rejects.toThrow("Game history changed");
});

it("inspects saved Generic configuration and refuses missing, wrong-owner and Completed Games", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({
    name: "Saved Game",
    players: [amy.id],
    settings: {
      mode: "points",
      pointsDirection: "low",
      tiebreaker: { direction: "high" },
      dealer: true,
    },
  });
  closeDB();
  expect(await genericGamesApi.getEditor(game.id)).toMatchObject({
    game,
    players: [amy],
    version: expect.any(String),
  });
  expect(await gamesApi.getEditor(game.id)).toBeNull();
  expect(await genericGamesApi.getEditor("missing")).toBeNull();
  expect(await gamesApi.getEditor("missing")).toBeNull();
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "points",
    scores: [{ playerId: amy.id, points: "3", tiebreaker: "4" }],
  });
  const completed = await genericGamesApi.finish(game.id);
  closeDB();
  await expect(genericGamesApi.getEditor(game.id)).rejects.toThrow("Reopen");
  expect(await genericGamesApi.getById(game.id)).toEqual(completed);
});

it("refuses Completed Phase Games and unavailable Phase references without changing saved records", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id],
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] },
    settings: { tiebreaker: "roundsWon", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  expect(await genericGamesApi.getEditor(game.id)).toBeNull();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [{ playerId: amy.id, phaseStatus: "completed", score: 0 }],
  });
  const completed = await gamesApi.finish(game.id);
  closeDB();
  await expect(gamesApi.getEditor(game.id)).rejects.toThrow("Reopen");
  expect(await gamesApi.getById(game.id)).toEqual(completed);
  const unavailable = await gamesApi.create({
    players: [amy.id],
    phaseSet: { ...game.phaseSet, phases: ["unavailable-phase"] },
    settings: game.settings,
  });
  await expect(gamesApi.getEditor(unavailable.id)).rejects.toThrow("Phase no longer exists");
  closeDB();
  expect(await gamesApi.getById(unavailable.id)).toEqual(unavailable);
});

it.each([
  true,
  false,
])("keeps repeated-objective occurrences distinct in recording, corrections and reloaded views (in order: %s)", async (inOrderPhases) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: {
      id: "repeated",
      type: "temporary",
      name: "Repeated",
      phases: ["classic-1", "classic-1", "classic-2"],
    },
    settings: { inOrderPhases, tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  await gamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: [
      game.phaseOccurrences[1],
      game.phaseOccurrences[0],
      game.phaseOccurrences[2],
    ],
  });
  const saved = await gamesApi.getById(game.id);
  if (!saved) throw new Error("Missing Game");
  const firstId = saved.phaseOccurrences[0].id;
  const secondId = saved.phaseOccurrences[1].id;
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, phaseStatus: "completed", score: 1, selectedPhase: 1 },
      { playerId: bob.id, phaseStatus: "failed", score: 2, selectedPhase: 2 },
    ],
  });
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 3, selectedPhase: 2 },
      { playerId: bob.id, phaseStatus: "failed", score: 4, selectedPhase: 1 },
    ],
  });
  closeDB();
  let view = await gamesApi.getView(game.id);
  expect(view?.rounds[0].scores[0].source).toMatchObject({ phaseOccurrenceId: firstId });
  expect(view?.rounds[1].scores[0]).toMatchObject({ phaseOccurrenceId: secondId, phaseNumber: 2 });
  expect(view?.players[0].progress.currentPhase).toBe(2);
  if (!inOrderPhases) {
    expect(view?.players[0].progress.selectable?.resolvedPhases).toEqual([1]);
    expect(view?.players[0].progress.selectable?.totalPhases).toBe(3);
  }
  const correction = await gamesApi.getRoundEditor(game.id, 1);
  await gamesApi.editRound({
    gameId: game.id,
    roundNumber: 1,
    version: correction.version,
    roundWinnerId: null,
    scores: correction.round.scores.map((score) => ({
      playerId: score.playerId,
      phaseStatus: "failed",
      score: score.score,
      selectedPhase: inOrderPhases ? score.currentPhase : 2,
    })),
    confirmImpact: true,
  });
  closeDB();
  const history = await roundsApi.getByGameId(game.id);
  expect(history[0].scores[0]).toMatchObject({
    phaseOccurrenceId: inOrderPhases ? firstId : secondId,
  });
  expect(history[1].scores[0]).toMatchObject({ phaseOccurrenceId: secondId });
  view = await gamesApi.getView(game.id);
  expect(view?.rounds[1].scores[0]).toMatchObject({
    phaseOccurrenceId: inOrderPhases ? firstId : secondId,
    phaseNumber: inOrderPhases ? 1 : 2,
  });
  expect(view?.players[0].tiebreakerTotal).toBe(4);
  expect((await gamesApi.getEditor(game.id))?.canEditPhases).toBe(false);
});

it("rejects invalid, obsolete and history-aware reordering drafts even with approval, while retaining membership editing", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id],
    phaseSet: { id: "short", type: "temporary", name: "Short", phases: ["classic-1", "classic-2"] },
    settings: { tiebreaker: "fewestWilds", roundSkipPenalty: 0, sitOutPenalty: 0 },
  });
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  const base = { gameId: game.id, version: editor.version, players: game.players };
  await expect(
    gamesApi.edit({
      ...base,
      players: [...game.players, cam.id],
      // @ts-expect-error Runtime callers cannot bypass phase validation with null.
      phaseOccurrences: null,
      approval: { token: "forced" },
    }),
  ).rejects.toThrow("At least one required Phase");
  for (const [phaseOccurrences, message] of [
    [[], "At least one required Phase"],
    [[game.phaseOccurrences[0], game.phaseOccurrences[0]], "unique occurrence identity"],
    [[{ ...game.phaseOccurrences[0], phaseId: "classic-3" }], "cannot change its objective"],
    [[{ id: crypto.randomUUID(), phaseId: "unavailable" }], "Phase no longer exists"],
    [[{ id: "", phaseId: "classic-1" }], "unique occurrence identity"],
  ] as const) {
    const input = { ...base, phaseOccurrences: [...phaseOccurrences] };
    await expect(gamesApi.previewEdit(input)).rejects.toThrow(message);
    await expect(gamesApi.edit({ ...input, approval: { token: "forced" } })).rejects.toThrow(
      message,
    );
    expect(await gamesApi.getById(game.id)).toEqual(game);
  }
  await expect(
    gamesApi.previewEdit({ ...base, phaseOccurrences: game.phaseOccurrences }),
  ).rejects.toThrow("No Game membership or Phase changes");
  const input = { ...base, phaseOccurrences: [game.phaseOccurrences[1], game.phaseOccurrences[0]] };
  const review = await gamesApi.previewEdit(input);
  expect(review.requiresConfirmation).toBe(false);
  await expect(
    gamesApi.edit({
      ...input,
      phaseOccurrences: [game.phaseOccurrences[0]],
      approval: { token: review.token },
    }),
  ).rejects.toThrow("differ from the review");
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, phaseStatus: "failed", score: 0 },
      { playerId: bob.id, phaseStatus: "failed", score: 0 },
    ],
  });
  await expect(gamesApi.edit({ ...input, approval: { token: review.token } })).rejects.toThrow(
    "Game history changed",
  );
  const fresh = await gamesApi.getEditor(game.id);
  if (!fresh) throw new Error("Missing editor");
  await expect(
    gamesApi.previewEdit({
      ...base,
      version: fresh.version,
      phaseOccurrences: [
        { ...game.phaseOccurrences[0], phaseId: "classic-3", removed: true },
        game.phaseOccurrences[1],
      ],
    }),
  ).rejects.toThrow("cannot change its objective");
  await expect(gamesApi.previewEdit({ ...input, version: fresh.version })).rejects.toThrow(
    "added or reordered",
  );
  await expect(
    gamesApi.edit({ ...input, version: fresh.version, approval: { token: "forced" } }),
  ).rejects.toThrow("added or reordered");
  await expect(gamesApi.addPhase(game.id, "classic-3")).rejects.toThrow("added or reordered");
  await expect(gamesApi.removePhase(game.id, "classic-1")).rejects.toThrow(
    "Confirm the reviewed Game changes",
  );
  const join = {
    ...base,
    version: fresh.version,
    players: [...game.players, cam.id],
    phaseOccurrences: game.phaseOccurrences,
  };
  const membership = await gamesApi.previewEdit(join);
  expect(membership.requiresConfirmation).toBe(true);
  await gamesApi.edit({ ...join, approval: { token: membership.token } });
  closeDB();
  expect((await gamesApi.getById(game.id))?.phaseOccurrences).toEqual(game.phaseOccurrences);
  expect(await roundsApi.getByGameId(game.id)).toHaveLength(1);
});

it("edits only the Game snapshot without changing Saved Phase definitions, Saved Phase Sets or another Game", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const definition = await phasesApi.create({
    type: "saved",
    requirements: [{ type: "set", count: 4, quantity: 1, isSameColor: false }],
  });
  const set = await phaseSetsApi.create({
    type: "saved",
    name: "Saved",
    phases: [definition.id, "classic-1", definition.id],
  });
  const input = {
    players: [amy.id],
    phaseSet: { ...set, type: "temporary" as const },
    settings: { tiebreaker: "fewestWilds" as const, roundSkipPenalty: 0, sitOutPenalty: 0 },
  };
  const game = await gamesApi.create(input);
  const other = await gamesApi.create(input);
  expect(
    other.phaseOccurrences.every(
      (phase) => !game.phaseOccurrences.some(({ id }) => id === phase.id),
    ),
  ).toBe(true);
  const editor = await gamesApi.getEditor(game.id);
  if (!editor) throw new Error("Missing editor");
  await gamesApi.edit({
    gameId: game.id,
    version: editor.version,
    players: game.players,
    phaseOccurrences: [
      game.phaseOccurrences[2],
      { id: crypto.randomUUID(), phaseId: definition.id },
    ],
  });
  closeDB();
  expect(await phasesApi.getById(definition.id)).toEqual(definition);
  expect(await phaseSetsApi.getById(set.id)).toEqual(set);
  expect(await gamesApi.getById(other.id)).toEqual(other);
  expect((await gamesApi.getById(game.id))?.phaseSet.phases).toEqual([
    definition.id,
    definition.id,
  ]);
});
