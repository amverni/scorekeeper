import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { deleteDB } from "idb";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActiveGame, PlayerId } from "../../types";
import { closeDB } from "../db";
import { gameListOptions } from "../hooks/useGames";
import {
  activeGenericGamesOptions,
  genericGameDetailOptions,
  genericGameListOptions,
  genericGameScoreboardOptions,
} from "../hooks/useGenericGames";
import { playerListOptions, playersByIdsOptions, useUpdatePlayer } from "../hooks/usePlayers";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { phasesApi } from "./phases";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";
import { deriveStandings } from "./standings";

beforeEach(resetDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

it.each([
  { fallback: "configured Tiebreaker", roundWinner: "amy", amyScore: 5, winner: "bob" },
  { fallback: "most recent Round Winner", roundWinner: "amy", amyScore: 0, winner: "amy" },
  { fallback: "Game Creation Order", roundWinner: "dan", amyScore: 0, winner: "bob" },
] as const)("preserves the normal Phase $fallback without applying it to shared manual wins", async ({
  roundWinner,
  amyScore,
  winner,
}) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Moss", isFavorite: 0 });
  const dan = await playersApi.create({ name: "Dan", color: "Rose", isFavorite: 0 });
  const players = { amy, bob, cam, dan };
  const roster = [bob.id, amy.id, cam.id, dan.id];
  const normal = await createPhaseGame(roster);
  const early = await createPhaseGame(roster);
  const generic = await genericGamesApi.create({
    players: roster,
    settings: { mode: "points", pointsDirection: "low", tiebreaker: null, dealer: false },
  });
  for (const game of [normal, early]) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: cam.id,
      scores: [
        { playerId: bob.id, phaseStatus: "completed", score: 0 },
        { playerId: amy.id, phaseStatus: "completed", score: 0 },
        { playerId: cam.id, phaseStatus: "completed", score: 10 },
        { playerId: dan.id, phaseStatus: "failed", score: 20 },
      ],
    });
  }
  await genericRoundsApi.add({
    gameId: generic.id,
    mode: "points",
    scores: [
      { playerId: bob.id, points: "-5", tiebreaker: "999" },
      { playerId: amy.id, points: "-5", tiebreaker: "-999" },
      { playerId: cam.id, points: "0", tiebreaker: "not a score" },
      { playerId: dan.id, points: "5", tiebreaker: "" },
    ],
  });

  const [normalResult, earlyResult, genericResult] = await Promise.all([
    roundsApi.add({
      gameId: normal.id,
      roundWinnerId: players[roundWinner].id,
      scores: [
        { playerId: bob.id, phaseStatus: "completed", score: 0 },
        { playerId: amy.id, phaseStatus: "completed", score: amyScore },
        { playerId: cam.id, phaseStatus: "failed", score: 10 },
        { playerId: dan.id, phaseStatus: "completed", score: 0 },
      ],
    }),
    gamesApi.finish(early.id),
    genericGamesApi.finish(generic.id),
  ]);
  expect(normalResult).toMatchObject({
    outcome: "roundAdded",
  });
  const firstFinisher = (await gamesApi.getView(normal.id))?.pendingFinishChoice;
  if (!firstFinisher) throw new Error("Missing first-finisher choice");
  expect(
    await gamesApi.resolveFinishChoice(normal.id, "finish", firstFinisher.token),
  ).toMatchObject({
    completionType: "normal",
    winnerIds: [players[winner].id],
  });
  expect(earlyResult).toMatchObject({
    completionType: "manual",
    winnerIds: [bob.id, amy.id],
  });
  expect(genericResult).toMatchObject({
    completionType: "manual",
    winnerIds: [bob.id, amy.id],
  });

  await playersApi.update(amy.id, { name: "Amelia", color: "Ocean", isFavorite: 1 });
  await Promise.all(roster.map((id) => playersApi.delete(id)));
  closeDB();
  expect(await playersApi.getAll()).toEqual([]);
  expect(await gamesApi.getActive()).toEqual([]);
  expect(await genericGamesApi.getActiveViews()).toEqual([]);
  const identities = [
    { id: bob.id, name: "Bob", color: "Ocean" },
    { id: amy.id, name: "Amy", color: "Jam" },
    { id: cam.id, name: "Cam", color: "Moss" },
    { id: dan.id, name: "Dan", color: "Rose" },
  ];
  for (const gameId of [normal.id, early.id]) {
    const game = await gamesApi.getById(gameId);
    if (!game) throw new Error("Missing completed Phase Game");
    const standings = deriveStandings({
      game,
      players: [],
      rounds: await roundsApi.getByGameId(gameId),
    });
    expect(standings.includedPlayers).toEqual(identities);
    expect(standings.phaseGraphSeries.map((series) => series.player)).toEqual(identities);
    expect(standings.tiebreakerGraphSeries.map((series) => series.player)).toEqual(identities);
    expect(standings.hasFinishedPlayers).toBe(gameId === normal.id);
  }
  expect((await gamesApi.getList()).map((game) => game.players)).toEqual([identities, identities]);
  expect((await genericGamesApi.getDetail(generic.id))?.players).toEqual(identities);
  const scoreboard = await genericGamesApi.getScoreboard(generic.id);
  expect(scoreboard?.standings).toEqual([
    { player: identities[0], totalPoints: -5, place: 1 },
    { player: identities[1], totalPoints: -5, place: 1 },
    { player: identities[2], totalPoints: 0, place: 3 },
    { player: identities[3], totalPoints: 5, place: 4 },
  ]);
  expect(scoreboard?.primaryGraph.series.map((series) => series.player)).toEqual(identities);
  expect(scoreboard?.tiebreakerGraph).toBeNull();
  expect((await genericGamesApi.getList())[0].players).toEqual(identities);
});

it("isolates a failed Phase completion from competing generic retention and shared Player deletion", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const roster = [amy.id, bob.id];
  const ownedPhase = await phasesApi.create({
    type: "temporary",
    requirements: [{ type: "set", count: 3, isSameColor: false, quantity: 1 }],
  });
  const oldestPhase = await gamesApi.create({
    players: roster,
    phaseSet: {
      id: "owned-phase-set",
      type: "temporary",
      name: "Owned Phase",
      phases: [ownedPhase.id],
    },
    settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 },
  });
  await addPhaseRound(oldestPhase);
  const genericIds: string[] = [];
  for (let index = 0; index < 20; index++) {
    if (index > 0) {
      const phase = await createPhaseGame(roster);
      await addPhaseRound(phase);
      await gamesApi.finish(phase.id);
    }
    const generic = await genericGamesApi.create({
      players: roster,
      settings: { mode: "passFail", tiebreaker: null, dealer: true },
    });
    await genericRoundsApi.add({
      gameId: generic.id,
      mode: "passFail",
      scores: roster.map((playerId) => ({ playerId, passed: false })),
    });
    await genericGamesApi.finish(generic.id);
    genericIds.push(generic.id);
  }
  const pendingPhase = await createPhaseGame(roster);
  await addPhaseRound(pendingPhase);
  const pendingGeneric = await genericGamesApi.create({
    players: roster,
    settings: { mode: "singleRoundWinner", tiebreaker: null, dealer: false },
  });
  await genericRoundsApi.add({
    gameId: pendingGeneric.id,
    mode: "singleRoundWinner",
    scores: [
      { playerId: amy.id, won: false },
      { playerId: bob.id, won: true },
    ],
  });
  const phaseList = await gamesApi.getList();
  const phaseBefore = await gamesApi.getById(pendingPhase.id);
  const roundsBefore = await roundsApi.getByGameId(pendingPhase.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (
      this.name === "games" &&
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      value.id === pendingPhase.id
    ) {
      // A duplicate key fails asynchronously after the finishing Round request succeeds.
      return this.add(value, key);
    }
    return put.call(this, value, key);
  });
  let results: PromiseSettledResult<unknown>[];
  try {
    results = await Promise.allSettled([
      addPhaseRound(pendingPhase),
      genericGamesApi.finish(pendingGeneric.id),
      playersApi.delete(amy.id),
    ]);
  } finally {
    failure.mockRestore();
  }
  expect(results).toMatchObject([
    { status: "rejected", reason: { name: "ConstraintError" } },
    { status: "fulfilled", value: { winnerIds: [bob.id] } },
    { status: "rejected", reason: { message: expect.stringContaining("Active Game") } },
  ]);

  closeDB();
  expect(await gamesApi.getList()).toEqual(phaseList);
  expect(await gamesApi.getById(pendingPhase.id)).toEqual(phaseBefore);
  expect(await roundsApi.getByGameId(pendingPhase.id)).toEqual(roundsBefore);
  expect(await phasesApi.getById(ownedPhase.id)).toEqual(ownedPhase);
  const retainedGeneric = await genericGamesApi.getList();
  expect(retainedGeneric).toHaveLength(20);
  expect(retainedGeneric.every((game) => game.status === "completed")).toBe(true);
  expect(retainedGeneric.map((game) => game.id).sort()).toEqual(
    [...genericIds.slice(1), pendingGeneric.id].sort(),
  );
  expect(await genericGamesApi.getById(genericIds[0])).toBeUndefined();
  expect(await playersApi.getById(amy.id)).toEqual(amy);

  await addPhaseRound(pendingPhase);
  await playersApi.delete(amy.id);
  await playersApi.delete(bob.id);
  closeDB();
  expect(await gamesApi.getById(oldestPhase.id)).toBeUndefined();
  expect(await phasesApi.getById(ownedPhase.id)).toBeUndefined();
  expect(await gamesApi.getList()).toHaveLength(20);
  expect(await genericGamesApi.getList()).toEqual(retainedGeneric);
  expect(await gamesApi.getById(pendingPhase.id)).toMatchObject({
    status: "completed",
    winnerIds: [amy.id],
    playerSnapshots: [
      { id: amy.id, name: "Amy", color: "Jam" },
      { id: bob.id, name: "Bob", color: "Ocean" },
    ],
  });
  expect(await roundsApi.getByGameId(pendingPhase.id)).toHaveLength(2);
});

it("refreshes both scorekeepers' cached Active identities and Favorites without rewriting Completed identities", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const roster = [amy.id, bob.id];
  const phase = await createPhaseGame(roster);
  const generic = await genericGamesApi.create({
    players: roster,
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  const completed = await genericGamesApi.create({
    players: roster,
    settings: { mode: "passFail", tiebreaker: null, dealer: false },
  });
  await genericRoundsApi.add({
    gameId: completed.id,
    mode: "passFail",
    scores: roster.map((playerId) => ({ playerId, passed: false })),
  });
  await genericGamesApi.finish(completed.id);
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  const readViews = () =>
    Promise.all([
      client.fetchQuery(gameListOptions()),
      client.fetchQuery(genericGameListOptions()),
      client.fetchQuery(genericGameDetailOptions(generic.id)),
      client.fetchQuery(genericGameScoreboardOptions(generic.id)),
      client.fetchQuery(activeGenericGamesOptions()),
      client.fetchQuery(playersByIdsOptions(roster)),
      client.fetchQuery(playerListOptions({ isFavorite: 1 })),
    ]);
  try {
    const before = await readViews();
    expect(before[6]).toEqual([]);
    let update: ReturnType<typeof useUpdatePlayer>["mutateAsync"] | undefined;
    function MutationHarness() {
      update = useUpdatePlayer().mutateAsync;
      return null;
    }
    renderToString(createElement(QueryClientProvider, { client }, createElement(MutationHarness)));
    if (!update) throw new Error("Mutation hook was not rendered");
    await expect(update({ id: amy.id, updates: { name: "Bob" } })).rejects.toThrow(
      "already exists",
    );
    expect(await readViews()).toEqual(before);
    const edited = await update({
      id: amy.id,
      updates: { name: "Amelia", color: "Moss", isFavorite: 1 },
    });
    const [phaseList, genericList, detail, scoreboard, active, byIds, favorites] =
      await readViews();
    expect(phaseList.find((game) => game.id === phase.id)?.players).toEqual([edited, bob]);
    expect(genericList.find((game) => game.id === generic.id)?.players).toEqual([edited, bob]);
    expect(detail?.players).toEqual([edited, bob]);
    expect(scoreboard?.players[0]).toMatchObject({
      id: amy.id,
      name: "Amelia",
      color: "Moss",
    });
    expect(active[0].players).toEqual([edited, bob]);
    expect(byIds).toEqual([edited, bob]);
    expect(favorites).toEqual([edited]);
    expect(genericList.find((game) => game.id === completed.id)?.players).toEqual([
      { id: amy.id, name: "Amy", color: "Jam" },
      { id: bob.id, name: "Bob", color: "Ocean" },
    ]);
  } finally {
    client.clear();
  }
});

function addPhaseRound(game: ActiveGame) {
  return roundsApi.add({
    gameId: game.id,
    roundWinnerId: game.players[0],
    scores: [
      { playerId: game.players[0], phaseStatus: "completed", score: 0 },
      { playerId: game.players[1], phaseStatus: "failed", score: 10 },
    ],
  });
}

function createPhaseGame(players: PlayerId[]): Promise<ActiveGame> {
  return gamesApi.create({
    players,
    phaseSet: {
      id: "two-phases",
      type: "temporary",
      name: "Two Phases",
      phases: ["phase-1", "phase-2"],
    },
    settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 },
  });
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
