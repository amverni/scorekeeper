import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { phaseSetsApi } from "./phaseSets";
import { phasesApi } from "./phases";
import { phasesCardImportApi } from "./phasesCardImport";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

describe("phaseSetsApi", () => {
  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  it("does not resolve legacy phase set aliases", async () => {
    await expect(phaseSetsApi.getById("classic")).resolves.toBeUndefined();
  });

  it("imports only required Phases, retaining duplicate objectives and matching the saved active list", async () => {
    const [required, removed] = await phasesApi.getByIds(["classic-1", "classic-2"]);
    const input = {
      name: "Shared Game",
      phases: [required, { ...removed, removed: true as const }, required],
    };
    const saved = await phasesCardImportApi.saveImported(input);
    closeDB();
    expect(await phaseSetsApi.getPhases(saved.id)).toMatchObject([
      { requirements: [{ type: "set", count: 3, quantity: 2, isSameColor: false }] },
      { requirements: [{ type: "set", count: 3, quantity: 2, isSameColor: false }] },
    ]);
    expect(await phasesCardImportApi.findSavedMatch(input)).toEqual(saved);
    expect(await phasesCardImportApi.saveImported(input)).toEqual(saved);
    expect(await phaseSetsApi.getAll({ type: "saved" })).toHaveLength(1);
    expect(input.phases[1]).toMatchObject({ removed: true });
    await expect(
      phasesCardImportApi.saveImported({
        name: "No requirements",
        phases: [{ ...removed, removed: true }],
      }),
    ).rejects.toThrow("At least one required Phase");
    expect(await phaseSetsApi.getAll({ type: "saved" })).toHaveLength(1);
  });

  it("does not match a Game with retained Removed Phases to an otherwise identical built-in card", async () => {
    const phaseSet = await phaseSetsApi.getById("original");
    if (!phaseSet) throw new Error("Missing Original Phase Set");
    const [amy, bob] = await Promise.all(
      ["Amy", "Bob"].map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
    );
    const game = await gamesApi.create({
      players: [amy.id, bob.id],
      phaseSet: { ...phaseSet, type: "temporary" },
      settings: {
        inOrderPhases: false,
        tiebreaker: "fewestWilds",
        roundSkipPenalty: 0,
        sitOutPenalty: 0,
      },
    });
    expect(phaseSetsApi.getMatchingBuiltInId((await gamesApi.getPhasesCard(game.id)).phases)).toBe(
      "original",
    );
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, phaseStatus: "failed", selectedPhase: 3, score: 0 },
        { playerId: bob.id, phaseStatus: "failed", selectedPhase: 3, score: 0 },
      ],
    });
    const editor = await gamesApi.getEditor(game.id);
    if (!editor) throw new Error("Missing Game editor");
    await gamesApi.edit({
      gameId: game.id,
      version: editor.version,
      players: game.players,
      phaseOccurrences: game.phaseOccurrences.slice(1),
    });
    closeDB();
    const card = await gamesApi.getPhasesCard(game.id);
    expect(card.phases).toHaveLength(10);
    expect(card.phases[0]).toMatchObject({ removed: true });
    expect(phaseSetsApi.getMatchingBuiltInId(card.phases)).toBeUndefined();
    expect(await phaseSetsApi.getById("original")).toEqual(phaseSet);
  });
});

async function resetDatabase() {
  closeDB();
  await deleteDatabase("phase10-db");
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
