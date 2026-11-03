import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
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

it("rejects invalid, obsolete and history-bearing phase drafts even with approval, while retaining membership editing", async () => {
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
  await expect(gamesApi.previewEdit({ ...input, version: fresh.version })).rejects.toThrow(
    "before the first saved Round",
  );
  await expect(
    gamesApi.edit({ ...input, version: fresh.version, approval: { token: "forced" } }),
  ).rejects.toThrow("before the first saved Round");
  await expect(gamesApi.addPhase(game.id, "classic-3")).rejects.toThrow(
    "before the first saved Round",
  );
  await expect(gamesApi.removePhase(game.id, "classic-1")).rejects.toThrow(
    "before the first saved Round",
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
