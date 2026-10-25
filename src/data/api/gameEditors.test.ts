import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
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
  expect(await genericGamesApi.getEditor(game.id)).toEqual({ game, players: [amy] });
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
