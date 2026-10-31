import "fake-indexeddb/auto";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { GenericGameSettings } from "../../types";
import { DEFAULT_GAME_SETTINGS } from "../constants/gameSettings";
import { closeDB } from "../db";
import { favoritesApi } from "./favorites";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { phaseSetsApi } from "./phaseSets";
import { phasesApi } from "./phases";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";
import { settingsApi } from "./settings";

beforeEach(resetDatabase);
afterEach(resetDatabase);

it("persists the configured Phase Order for new Games without changing saved Games and resets to Sequential Phase Order", async () => {
  const factory = await settingsApi.get();
  expect(factory.gameDefaults.inOrderPhases).toBe(true);
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const { phaseSetId, ...factorySettings } = factory.gameDefaults;
  const phaseSet = await phaseSetsApi.getById(phaseSetId);
  if (!phaseSet) throw new Error("Missing factory Phase Set");
  const input = {
    players: [amy.id, bob.id],
    phaseSet: { ...phaseSet, type: "temporary" as const },
  };
  const existing = await gamesApi.create({ ...input, settings: factorySettings });
  await settingsApi.updateGameDefaults({
    inOrderPhases: false,
    tiebreaker: "fewestWilds",
    roundSkipPenalty: 45,
    sitOutPenalty: 15,
  });

  closeDB();
  const configured = await settingsApi.get();
  expect(configured.gameDefaults).toEqual({
    inOrderPhases: false,
    tiebreaker: "fewestWilds",
    roundSkipPenalty: 45,
    sitOutPenalty: 15,
    phaseSetId,
  });
  expect(await gamesApi.getById(existing.id)).toEqual(existing);
  const { phaseSetId: configuredPhaseSetId, ...configuredSettings } = configured.gameDefaults;
  expect(configuredPhaseSetId).toBe(phaseSetId);
  const inherited = await gamesApi.create({ ...input, settings: configuredSettings });
  const overridden = await gamesApi.create({
    ...input,
    settings: { ...configuredSettings, inOrderPhases: true },
  });
  await settingsApi.reset();

  closeDB();
  expect(await settingsApi.get()).toEqual(factory);
  expect((await gamesApi.getById(inherited.id))?.settings).toEqual({
    inOrderPhases: false,
    tiebreaker: "fewestWilds",
    roundSkipPenalty: 45,
    sitOutPenalty: 15,
  });
  expect((await gamesApi.getById(overridden.id))?.settings.inOrderPhases).toBe(true);
});

it("rejects an invalid Phase Order default without partially updating other defaults", async () => {
  const before = await settingsApi.updateGameDefaults({
    inOrderPhases: false,
    sitOutPenalty: 15,
  });
  await expect(
    settingsApi.updateGameDefaults({
      // @ts-expect-error Runtime input must be validated before persisting any changes.
      inOrderPhases: "off",
      sitOutPenalty: 45,
    }),
  ).rejects.toThrow("In-order phases must be On or Off.");
  closeDB();
  expect(await settingsApi.get()).toEqual(before);
});

it("preserves other app defaults when Phase Order and another preference are saved concurrently", async () => {
  await settingsApi.get();
  await Promise.all([
    settingsApi.updateGameDefaults({ inOrderPhases: false }),
    settingsApi.setDefaultTiebreaker("fewestWilds"),
    settingsApi.setDefaultSitOutPenalty(15),
  ]);
  closeDB();
  expect((await settingsApi.get()).gameDefaults).toMatchObject({
    inOrderPhases: false,
    tiebreaker: "fewestWilds",
    sitOutPenalty: 15,
    roundSkipPenalty: 100,
  });
});

it("resets all disposable pre-refactor data once, then preserves new data on reopen", async () => {
  const legacy = await openDB("phase10-db", 7, {
    upgrade(db) {
      for (const store of [
        "players",
        "games",
        "rounds",
        "customPhases",
        "customPhaseSets",
        "favorites",
        "settings",
      ]) {
        db.createObjectStore(store);
      }
    },
  });
  for (const store of legacy.objectStoreNames) {
    await legacy.put(store, { id: "legacy", name: "Disposable" }, "legacy");
  }
  legacy.close();

  expect(await playersApi.getAll()).toEqual([]);
  expect(await gamesApi.getAll()).toEqual([]);
  expect(await roundsApi.getByGameId("legacy")).toEqual([]);
  expect(await phasesApi.getAll({ type: "saved" })).toEqual([]);
  expect(await phaseSetsApi.getById("legacy")).toBeUndefined();
  expect(await favoritesApi.getAll("phase")).toEqual([]);
  expect(await favoritesApi.getAll("phaseSet")).toEqual([]);
  expect(await settingsApi.get()).not.toHaveProperty("name");

  const player = await playersApi.create({ name: "New Player", color: "Jam", isFavorite: 1 });
  const settings = await settingsApi.setDefaultSitOutPenalty(25);
  const phase = await phasesApi.create({
    type: "saved",
    requirements: [{ type: "set", count: 4, isSameColor: false, quantity: 1 }],
  });
  await favoritesApi.add("phase", phase.id);
  closeDB();
  expect(await playersApi.getAll()).toEqual([player]);
  expect(await settingsApi.get()).toEqual(settings);
  expect(await phasesApi.getById(phase.id)).toEqual(phase);
  expect(await favoritesApi.getAll("phase")).toEqual([phase.id]);
  closeDB();
  expect(await playersApi.getById(player.id)).toEqual(player);
});

it("retries generic list and detail reads after a rejected database open", async () => {
  const incompatible = await openDB("phase10-db", 9);
  incompatible.close();
  const failed = await Promise.allSettled([
    genericGamesApi.getActiveViews(),
    genericGamesApi.getDetail("missing"),
  ]);
  expect(failed.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  await deleteDB("phase10-db");

  expect(await genericGamesApi.getActiveViews()).toEqual([]);
  expect(await genericGamesApi.getDetail("missing")).toBeNull();
  const player = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [player.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  expect(await genericGamesApi.getDetail(game.id)).toEqual({ game, players: [player] });
});

it("preserves both Scorekeepers' active and completed results across database reopens", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 1 });
  const bob = await playersApi.create({ name: "Bob", color: "Rose", isFavorite: 0 });
  const players = [amy.id, bob.id];
  const phase = await gamesApi.create({
    players,
    phaseSet: {
      id: "reopen-phases",
      type: "temporary",
      name: "Two Phases",
      phases: ["classic-1", "classic-2"],
    },
    settings: DEFAULT_GAME_SETTINGS,
  });
  await roundsApi.add({
    gameId: phase.id,
    roundWinnerId: amy.id,
    scores: [
      { playerId: amy.id, score: 0, phaseStatus: "completed" },
      { playerId: bob.id, score: 0, phaseStatus: "completed" },
    ],
  });

  const settings: GenericGameSettings[] = [
    { mode: "points", pointsDirection: "low", tiebreaker: null, dealer: false },
    { mode: "points", pointsDirection: "high", tiebreaker: { direction: "low" }, dealer: true },
    { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
    { mode: "passFail", tiebreaker: null, dealer: false },
  ];
  const genericIds = [];
  for (const rules of settings) {
    const game = await genericGamesApi.create({ players, settings: rules });
    genericIds.push(game.id);
    if (rules.mode === "points") {
      await genericRoundsApi.add({
        gameId: game.id,
        mode: "points",
        scores: players.map((playerId) => ({
          playerId,
          points: "-123",
          ...(rules.tiebreaker ? { tiebreaker: "-7" } : {}),
        })),
      });
    } else if (rules.mode === "singleRoundWinner") {
      await genericRoundsApi.add({
        gameId: game.id,
        mode: "singleRoundWinner",
        scores: [
          { playerId: amy.id, won: true },
          { playerId: bob.id, won: false },
        ],
      });
    } else {
      await genericRoundsApi.add({
        gameId: game.id,
        mode: "passFail",
        scores: players.map((playerId) => ({ playerId, passed: false })),
      });
    }
  }

  closeDB();
  expect((await gamesApi.getActive()).map((game) => game.id)).toEqual([phase.id]);
  expect((await roundsApi.getByGameId(phase.id))[0].scores).toHaveLength(2);
  expect(await genericGamesApi.getActive()).toHaveLength(4);
  for (const [index, id] of genericIds.entries()) {
    const view = await genericGamesApi.getScoreboard(id);
    expect(view?.game.settings).toEqual(settings[index]);
    expect(view?.rounds).toHaveLength(1);
    expect(view?.primaryGraph.series[0].points).toEqual([
      { roundNumber: 0, value: 0 },
      { roundNumber: 1, value: index < 2 ? -123 : index === 2 ? 1 : 0 },
    ]);
  }

  const completedPhase = await gamesApi.finish(phase.id);
  expect(completedPhase.winnerIds).toEqual(players);
  for (const [index, id] of genericIds.entries()) {
    const completed = await genericGamesApi.finish(id);
    expect(completed.winnerIds).toEqual(index === 2 ? [amy.id] : players);
  }
  await playersApi.delete(amy.id);
  await playersApi.delete(bob.id);

  for (let reopen = 0; reopen < 2; reopen++) {
    closeDB();
    expect(await playersApi.getAll()).toEqual([]);
    expect(await gamesApi.getActive()).toEqual([]);
    expect(await genericGamesApi.getActive()).toEqual([]);
    expect(await gamesApi.getById(phase.id)).toEqual(completedPhase);
    expect(await roundsApi.getByGameId(phase.id)).toHaveLength(1);
    const snapshots = [
      { id: amy.id, name: "Amy", color: "Jam" },
      { id: bob.id, name: "Bob", color: "Rose" },
    ];
    expect((await gamesApi.getList())[0].players).toEqual(snapshots);
    expect(await genericGamesApi.getList()).toHaveLength(4);
    for (const [index, id] of genericIds.entries()) {
      const view = await genericGamesApi.getScoreboard(id);
      expect(view?.game).toMatchObject({
        status: "completed",
        completionType: "manual",
        settings: settings[index],
        playerSnapshots: snapshots,
        winnerIds: index === 2 ? [amy.id] : players,
      });
      expect(view?.rounds).toHaveLength(1);
      expect(view?.primaryGraph.series.map((series) => series.player)).toEqual(snapshots);
    }
  }
});

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
