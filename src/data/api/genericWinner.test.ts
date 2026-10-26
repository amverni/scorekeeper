import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  AddGenericWinnerRoundInput,
  CreateGenericGameInput,
  GenericGame,
  GenericSingleRoundWinnerSettings,
} from "../../types";
import { closeDB, getDB } from "../db";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}

beforeEach(resetDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

async function createWinnerGame(names = ["Zed", "Amy", "Bob"], dealer = true) {
  const players = [];
  for (const name of names) {
    players.push(await playersApi.create({ name, color: "Jam", isFavorite: 0 }));
  }
  const game = await genericGamesApi.create({
    players: players.map((player) => player.id),
    settings: { mode: "singleRoundWinner", tiebreaker: null, dealer },
  });
  return { game, players };
}

function winnerRoundInput(
  game: Pick<GenericGame, "id" | "players">,
  winnerId = game.players[0],
): AddGenericWinnerRoundInput {
  return {
    gameId: game.id,
    mode: "singleRoundWinner",
    scores: game.players.map((playerId) => ({ playerId, won: playerId === winnerId })),
  };
}

it("saves explicit wins and losses in Game Creation Order and reloads accumulated wins with Dealer rotation", async () => {
  const {
    game,
    players: [zed, amy, bob],
  } = await createWinnerGame();
  const first = await genericRoundsApi.add({
    gameId: game.id,
    mode: "singleRoundWinner",
    scores: [
      { playerId: bob.id, won: false },
      { playerId: amy.id, won: true },
      { playerId: zed.id, won: false },
    ],
  });

  expect(first).toEqual({
    id: expect.any(String),
    revision: 0,
    scorekeeper: "generic",
    mode: "singleRoundWinner",
    gameId: game.id,
    roundNumber: 1,
    scores: [
      { playerId: zed.id, won: false },
      { playerId: amy.id, won: true },
      { playerId: bob.id, won: false },
    ],
  });
  await genericRoundsApi.add({
    gameId: game.id,
    mode: "singleRoundWinner",
    scores: [
      { playerId: zed.id, won: true },
      { playerId: amy.id, won: false },
      { playerId: bob.id, won: false },
    ],
  });
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toHaveLength(2);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { status: "active", settings: { mode: "singleRoundWinner", dealer: true } },
    players: [
      { id: zed.id, totalWins: 1 },
      { id: amy.id, totalWins: 1 },
      { id: bob.id, totalWins: 0 },
    ],
    rounds: [
      {
        roundNumber: 1,
        dealerId: zed.id,
        scores: [
          { playerId: zed.id, won: false, totalWins: 0 },
          { playerId: amy.id, won: true, totalWins: 1 },
          { playerId: bob.id, won: false, totalWins: 0 },
        ],
      },
      {
        roundNumber: 2,
        dealerId: amy.id,
        scores: [
          { playerId: zed.id, won: true, totalWins: 1 },
          { playerId: amy.id, won: false, totalWins: 1 },
          { playerId: bob.id, won: false, totalWins: 0 },
        ],
      },
    ],
    standings: [
      { player: { id: zed.id }, totalWins: 1, place: 1 },
      { player: { id: amy.id }, totalWins: 1, place: 1 },
      { player: { id: bob.id }, totalWins: 0, place: 3 },
    ],
    upcomingDealerId: bob.id,
  });
});

it.each([
  0, 2,
])("rejects %s winners without saving a Round or changing activity", async (winnerCount) => {
  const { game, players } = await createWinnerGame();
  await expect(
    genericRoundsApi.add({
      gameId: game.id,
      mode: "singleRoundWinner",
      scores: players.map((player, index) => ({ playerId: player.id, won: index < winnerCount })),
    }),
  ).rejects.toThrow("exactly one winner");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  "unknown",
  "",
  null,
  1,
  true,
])("rejects an unsupported Round Scoring Mode %j instead of treating it as Points", async (mode) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [amy.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  const input = Object.assign(
    { gameId: game.id, mode: "points" as const, scores: [{ playerId: amy.id, points: "3" }] },
    { mode },
  );
  await expect(genericRoundsApi.add(input)).rejects.toThrow(/mode/i);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  "empty",
  "missing",
  "duplicate",
  "outsider",
  "extra",
] as const)("requires exactly one win or loss for every Player in a Generic Round (%s)", async (invalid) => {
  const { game } = await createWinnerGame();
  const outsider = await playersApi.create({ name: "Cam", color: "Ocean", isFavorite: 0 });
  const [zed, amy, bob] = winnerRoundInput(game).scores;
  const outsiderScore = { playerId: outsider.id, won: false };
  const scores = {
    empty: [],
    missing: [zed, amy],
    duplicate: [zed, amy, amy],
    outsider: [zed, amy, outsiderScore],
    extra: [zed, amy, bob, outsiderScore],
  }[invalid];
  await expect(
    genericRoundsApi.add({ gameId: game.id, mode: "singleRoundWinner", scores }),
  ).rejects.toThrow("every Player exactly once");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  undefined,
  null,
  0,
  1,
  "false",
  "true",
  "",
  {},
  [],
])("rejects a non-boolean win or loss %j without coercion", async (won) => {
  const { game } = await createWinnerGame();
  const input = winnerRoundInput(game);
  Object.assign(input.scores[1], { won });
  await expect(genericRoundsApi.add(input)).rejects.toThrow("valid win or loss");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("requires an explicit loss instead of treating a missing win or loss as false", async () => {
  const { game } = await createWinnerGame();
  const input = winnerRoundInput(game);
  Reflect.deleteProperty(input.scores[1], "won");
  await expect(genericRoundsApi.add(input)).rejects.toThrow("valid win or loss");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  undefined,
  null,
  {},
])("rejects a missing or non-array collection of Generic Round entries (%j)", async (scores) => {
  const { game } = await createWinnerGame();
  const input = Object.assign(winnerRoundInput(game), { scores });
  await expect(genericRoundsApi.add(input)).rejects.toThrow("every Player exactly once");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("rejects Points entries in a Single Round Winner Game", async () => {
  const { game } = await createWinnerGame();
  await expect(
    genericRoundsApi.add({
      gameId: game.id,
      mode: "points",
      scores: game.players.map((playerId) => ({ playerId, points: "1" })),
    }),
  ).rejects.toThrow("Round mode must match");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("rejects Single Round Winner entries in a Points Game", async () => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const game = await genericGamesApi.create({
    players: [amy.id],
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  await expect(genericRoundsApi.add(winnerRoundInput(game))).rejects.toThrow(
    "Round mode must match",
  );
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("requires an explicit Single Round Winner Scoring Mode when saving wins and losses", async () => {
  const { game } = await createWinnerGame();
  const input = winnerRoundInput(game);
  Reflect.deleteProperty(input, "mode");
  await expect(genericRoundsApi.add(input)).rejects.toThrow();
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  { pointsDirection: "high" },
  { pointsDirection: "low" },
  { pointsDirection: undefined },
  { tiebreaker: { direction: "high" } },
  { tiebreaker: { direction: "low" } },
  { tiebreaker: undefined },
])("rejects hidden Points or Generic Tiebreaker settings for Single Round Winner (%j)", async (hidden) => {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const settings: GenericSingleRoundWinnerSettings = {
    mode: "singleRoundWinner",
    tiebreaker: null,
    dealer: false,
  };
  Object.assign(settings, hidden);
  await expect(genericGamesApi.create({ players: [amy.id], settings })).rejects.toThrow("settings");
  closeDB();
  expect(await genericGamesApi.getList()).toEqual([]);
});

it("saves only wins and losses when a Round carries hidden Points or Generic Tiebreaker values", async () => {
  const { game } = await createWinnerGame();
  const input = winnerRoundInput(game, game.players[1]);
  const expectedScores = structuredClone(input.scores);
  for (const score of input.scores) {
    Object.assign(score, { points: score.won ? -100 : 100, tiebreaker: score.won ? -50 : 50 });
  }
  const round = await genericRoundsApi.add(input);
  expect(round.scores).toEqual(expectedScores);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  const scoreboard = await genericGamesApi.getScoreboard(game.id);
  expect(scoreboard?.rounds[0].scores).toEqual(
    expectedScores.map((score) => ({ ...score, totalWins: score.won ? 1 : 0 })),
  );
  expect(scoreboard?.standings).toEqual([
    { player: { id: game.players[1], name: "Amy", color: "Jam" }, totalWins: 1, place: 1 },
    { player: { id: game.players[0], name: "Zed", color: "Jam" }, totalWins: 0, place: 2 },
    { player: { id: game.players[2], name: "Bob", color: "Jam" }, totalWins: 0, place: 2 },
  ]);
  expect((await genericGamesApi.finish(game.id)).winnerIds).toEqual([game.players[1]]);
});

it.each([
  "points",
  "singleRoundWinner",
] as const)("rejects a saved %s Round belonging to the other Scoring Mode instead of reinterpreting it", async (savedMode) => {
  const { game: winnerGame, players } = await createWinnerGame();
  const pointsGame = await genericGamesApi.create({
    players: players.map((player) => player.id),
    settings: { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
  });
  const winnerInput = winnerRoundInput(winnerGame);
  const pointsInput = {
    mode: "points" as const,
    gameId: pointsGame.id,
    scores: players.map((player) => ({ playerId: player.id, points: "0" })),
  };
  const winnerRound = await genericRoundsApi.add(winnerInput);
  const pointsRound = await genericRoundsApi.add(pointsInput);
  const target = savedMode === "points" ? winnerGame : pointsGame;
  const foreignRound = savedMode === "points" ? pointsRound : winnerRound;
  const input = savedMode === "points" ? winnerInput : pointsInput;
  const before = await genericGamesApi.getById(target.id);
  // Simulate persisted corruption that the public Round API correctly refuses to create.
  await (await getDB()).put("rounds", { ...foreignRound, gameId: target.id, roundNumber: 2 });
  closeDB();
  const rounds = await genericRoundsApi.getByGameId(target.id);
  await expect(genericGamesApi.getScoreboard(target.id)).rejects.toThrow("Invalid Generic Round");
  await expect(genericGamesApi.finish(target.id)).rejects.toThrow("Invalid Generic Round");
  await expect(genericRoundsApi.add(input)).rejects.toThrow("Invalid Generic Round");
  closeDB();
  expect(await genericGamesApi.getById(target.id)).toEqual(before);
  expect(await genericRoundsApi.getByGameId(target.id)).toEqual(rounds);
});

it.each([
  "unknown mode",
  "missing loss",
  "zero winners",
  "two winners",
] as const)("rejects a corrupted saved Single Round Winner Round (%s)", async (corruption) => {
  const { game } = await createWinnerGame();
  const saved = await genericRoundsApi.add(winnerRoundInput(game));
  if (saved.mode !== "singleRoundWinner") throw new Error("Expected Single Round Winner");
  if (corruption === "unknown mode") Object.assign(saved, { mode: "unknown" });
  if (corruption === "missing loss") Reflect.deleteProperty(saved.scores[1], "won");
  if (corruption === "zero winners") saved.scores[0].won = false;
  if (corruption === "two winners") saved.scores[1].won = true;
  const before = await genericGamesApi.getById(game.id);
  await (await getDB()).put("rounds", saved);
  const error = {
    "unknown mode": "Invalid Generic Round",
    "missing loss": "valid win or loss",
    "zero winners": "exactly one winner",
    "two winners": "exactly one winner",
  }[corruption];
  closeDB();
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow(error);
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow(error);
  await expect(genericRoundsApi.add(winnerRoundInput(game))).rejects.toThrow(error);
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(before);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([saved]);
});

it("keeps an unplayed Single Round Winner Game active with zero wins and shared first place", async () => {
  const { game, players } = await createWinnerGame();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual({
    game,
    withdrawnPlayers: [],
    eligiblePlayers: players.map(({ id, name, color }) => ({ id, name, color })),
    primaryGraph: {
      metric: "Rounds Won",
      direction: "high",
      series: players.map(({ id, name, color }) => ({
        player: { id, name, color },
        points: [{ roundNumber: 0, value: 0 }],
      })),
    },
    tiebreakerGraph: null,
    players: players.map(({ id, name, color }) => ({ id, name, color, totalWins: 0 })),
    rounds: [],
    standings: players.map(({ id, name, color }) => ({
      player: { id, name, color },
      totalWins: 0,
      place: 1,
    })),
    upcomingDealerId: players[0].id,
  });
  expect(await genericRoundsApi.hasRounds(game.id)).toBe(false);
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow("at least one saved Round");
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  await expect(playersApi.delete(players[0].id)).rejects.toThrow("Active Game");
});

it.each([
  false,
  true,
])("manually finishes a solo Single Round Winner Game without inventing Points (Dealer: %s)", async (dealer) => {
  const {
    game,
    players: [amy],
  } = await createWinnerGame(["Amy"], dealer);
  for (let round = 0; round < 2; round++) {
    await genericRoundsApi.add(winnerRoundInput(game));
  }
  expect(await genericGamesApi.getById(game.id)).toMatchObject({ status: "active" });
  const completed = await genericGamesApi.finish(game.id);
  expect(completed.winnerIds).toEqual([amy.id]);
  expect(completed.completionType).toBe("manual");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual({
    game: completed,
    withdrawnPlayers: [],
    eligiblePlayers: [{ id: amy.id, name: "Amy", color: "Jam" }],
    primaryGraph: {
      metric: "Rounds Won",
      direction: "high",
      series: [
        {
          player: { id: amy.id, name: "Amy", color: "Jam" },
          points: [
            { roundNumber: 0, value: 0 },
            { roundNumber: 1, value: 1 },
            { roundNumber: 2, value: 2 },
          ],
        },
      ],
    },
    tiebreakerGraph: null,
    players: [{ id: amy.id, name: "Amy", color: "Jam", totalWins: 2 }],
    rounds: [1, 2].map((roundNumber) => ({
      id: expect.any(String),
      roundNumber,
      dealerId: dealer ? amy.id : null,
      scores: [{ playerId: amy.id, won: true, totalWins: roundNumber }],
    })),
    standings: [{ player: { id: amy.id, name: "Amy", color: "Jam" }, totalWins: 2, place: 1 }],
    upcomingDealerId: null,
  });
});

it("awards shared Generic Game Winners without using Game Creation Order to break tied wins", async () => {
  const {
    game,
    players: [zed, amy, bob],
  } = await createWinnerGame();
  await genericRoundsApi.add(winnerRoundInput(game, amy.id));
  await genericRoundsApi.add(winnerRoundInput(game, zed.id));
  const completed = await genericGamesApi.finish(game.id);
  expect(completed.winnerIds).toEqual([zed.id, amy.id]);
  closeDB();
  const scoreboard = await genericGamesApi.getScoreboard(game.id);
  expect(scoreboard?.players.map((player) => player.id)).toEqual([zed.id, amy.id, bob.id]);
  expect(scoreboard?.standings).toEqual([
    { player: { id: zed.id, name: "Zed", color: "Jam" }, totalWins: 1, place: 1 },
    { player: { id: amy.id, name: "Amy", color: "Jam" }, totalWins: 1, place: 1 },
    { player: { id: bob.id, name: "Bob", color: "Jam" }, totalWins: 0, place: 3 },
  ]);
  expect(scoreboard?.game).toEqual(completed);
  expect(await genericGamesApi.getActive()).toEqual([]);
});

it("preserves completed Player names and colors in the scoreboard and history after saved Players change", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createWinnerGame(["Zed", "Amy"]);
  await genericRoundsApi.add(winnerRoundInput(game, amy.id));
  await playersApi.update(zed.id, { name: "Zelda", color: "Moss" });
  await playersApi.update(amy.id, { name: "Amelia", color: "Ocean" });
  closeDB();
  const snapshots = [
    { id: zed.id, name: "Zelda", color: "Moss" },
    { id: amy.id, name: "Amelia", color: "Ocean" },
  ];
  expect((await genericGamesApi.getScoreboard(game.id))?.players).toEqual([
    { ...snapshots[0], totalWins: 0 },
    { ...snapshots[1], totalWins: 1 },
  ]);
  expect((await genericGamesApi.getList({ activeOnly: true }))[0]?.players).toMatchObject(
    snapshots,
  );
  const clock = vi.spyOn(Date, "now").mockReturnValue(500);
  const completed = await genericGamesApi.finish(game.id);
  clock.mockRestore();
  expect(completed).toEqual({
    ...game,
    status: "completed",
    completionType: "manual",
    completedAt: 500,
    lastActivityAt: 500,
    completionOrder: 500,
    winnerIds: [amy.id],
    playerSnapshots: snapshots,
  });
  const scoreboard = await genericGamesApi.getScoreboard(game.id);
  await playersApi.update(zed.id, { name: "Zee", color: "Jam" });
  await playersApi.delete(amy.id);
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(scoreboard);
  expect(await genericGamesApi.getDetail(game.id)).toEqual({ game: completed, players: snapshots });
  expect(await genericGamesApi.getList()).toEqual([
    { id: game.id, status: "completed", lastActivityAt: 500, players: snapshots },
  ]);
  expect(await genericGamesApi.getList({ activeOnly: true })).toEqual([]);
});

it("rejects additional Rounds or repeated completion without rewriting a Completed Game", async () => {
  const { game } = await createWinnerGame();
  const input = winnerRoundInput(game);
  const round = await genericRoundsApi.add(input);
  const completed = await genericGamesApi.finish(game.id);
  const before = await genericGamesApi.getScoreboard(game.id);
  vi.spyOn(Date, "now").mockReturnValue(completed.completedAt + 100);
  await expect(genericRoundsApi.add(input)).rejects.toThrow("Completed Game");
  await expect(genericGamesApi.finish(game.id)).rejects.toThrow("Completed Game");
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(completed);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
});

it("fixes Single Round Winner settings and Game Creation Order before awaiting creation", async () => {
  const {
    players: [zed, amy],
  } = await createWinnerGame(["Zed", "Amy"]);
  const input: CreateGenericGameInput = {
    players: [amy.id, zed.id],
    settings: { mode: "singleRoundWinner", tiebreaker: null, dealer: true },
  };
  const creating = genericGamesApi.create(input);
  input.players.reverse();
  input.settings.dealer = false;
  input.settings = { mode: "points", pointsDirection: "low", tiebreaker: null, dealer: false };
  const game = await creating;
  const expected = structuredClone(game);
  expect(game.players).toEqual([amy.id, zed.id]);
  expect(game.settings).toEqual({ mode: "singleRoundWinner", tiebreaker: null, dealer: true });
  game.players.reverse();
  game.settings.dealer = false;
  game.settings = input.settings;
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(expected);
  expect(await genericGamesApi.getDetail(game.id)).toEqual({
    game: expected,
    players: [amy, zed],
  });
  await genericRoundsApi.add(winnerRoundInput(expected));
  const scoreboard = await genericGamesApi.getScoreboard(game.id);
  expect(scoreboard?.game.settings).toEqual(expected.settings);
  expect(scoreboard?.players.map((player) => player.id)).toEqual([amy.id, zed.id]);
  expect(scoreboard?.upcomingDealerId).toBe(zed.id);
});

it("detaches a Generic Round draft across await and isolates returned Rounds and scoreboard values", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createWinnerGame(["Zed", "Amy"]);
  const other = await genericGamesApi.create({
    players: game.players,
    settings: { mode: "singleRoundWinner", tiebreaker: null, dealer: false },
  });
  const input = winnerRoundInput(game, amy.id);
  const expectedScores = structuredClone(input.scores);
  const adding = genericRoundsApi.add(input);
  input.gameId = other.id;
  input.scores[0].won = true;
  input.scores[1].won = false;
  input.scores.reverse();
  Object.assign(input, { mode: "points" });
  const round = await adding;
  expect(round).toEqual({
    id: expect.any(String),
    revision: 0,
    gameId: game.id,
    scorekeeper: "generic",
    mode: "singleRoundWinner",
    roundNumber: 1,
    scores: expectedScores,
  });
  const expectedRound = structuredClone(round);
  if (round.mode !== "singleRoundWinner") throw new Error("Expected Single Round Winner");
  round.scores[0].won = true;
  round.scores[1].won = false;
  round.scores.reverse();
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([expectedRound]);
  expect(await genericRoundsApi.getByGameId(other.id)).toEqual([]);
  const scoreboard = await genericGamesApi.getScoreboard(game.id);
  if (!scoreboard) throw new Error("Expected a scoreboard");
  const expectedScoreboard = structuredClone(scoreboard);
  scoreboard.game.players.reverse();
  scoreboard.game.settings.dealer = false;
  scoreboard.players[0].name = "Changed";
  Object.assign(scoreboard.players[1], { totalWins: 99 });
  Object.assign(scoreboard.rounds[0].scores[0], { won: true, totalWins: 99 });
  scoreboard.standings[0].place = 99;
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(expectedScoreboard);
  expect(expectedScoreboard.standings[0]).toMatchObject({
    player: { id: amy.id },
    totalWins: 1,
    place: 1,
  });
  expect(expectedScoreboard.players[0]).toMatchObject({ id: zed.id, totalWins: 0 });
});

it("detaches the returned Generic Game Winners and Player snapshots from the saved result", async () => {
  const { game } = await createWinnerGame();
  await genericRoundsApi.add(winnerRoundInput(game));
  const completed = await genericGamesApi.finish(game.id);
  const expected = structuredClone(completed);
  completed.winnerIds[0] = game.players[1];
  completed.playerSnapshots[0].name = "Changed";
  completed.playerSnapshots[0].color = "Ocean";
  completed.playerSnapshots.reverse();
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual(expected);
  expect((await genericGamesApi.getDetail(game.id))?.players).toEqual(expected.playerSnapshots);
  expect((await genericGamesApi.getList())[0]?.players).toEqual(expected.playerSnapshots);
});

it.each([
  false,
  true,
])("keeps Dealer tracking independent of wins and stops upcoming Dealer after completion (Dealer: %s)", async (dealer) => {
  const {
    game,
    players: [zed, amy, bob],
  } = await createWinnerGame(undefined, dealer);
  expect((await genericGamesApi.getScoreboard(game.id))?.upcomingDealerId).toBe(
    dealer ? zed.id : null,
  );
  for (const winner of [bob, bob, zed, amy]) {
    await genericRoundsApi.add(winnerRoundInput(game, winner.id));
  }
  closeDB();
  const active = await genericGamesApi.getScoreboard(game.id);
  const dealers = dealer ? [zed.id, amy.id, bob.id, zed.id] : [null, null, null, null];
  expect(active?.rounds.map((round) => round.dealerId)).toEqual(dealers);
  expect(active?.upcomingDealerId).toBe(dealer ? amy.id : null);
  expect(active?.standings[0]).toMatchObject({
    player: { id: bob.id },
    totalWins: 2,
    place: 1,
  });
  expect((await genericGamesApi.finish(game.id)).winnerIds).toEqual([bob.id]);
  closeDB();
  const completed = await genericGamesApi.getScoreboard(game.id);
  expect(completed?.rounds.map((round) => round.dealerId)).toEqual(dealers);
  expect(completed?.upcomingDealerId).toBeNull();
});

it("retains the latest 20 Completed Generic Games across Scoring Modes while preserving Active Games", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const {
    game: active,
    players: [amy],
  } = await createWinnerGame(["Amy"]);
  const completed: GenericGame[] = [];
  for (let index = 0; index < 21; index++) {
    clock.mockReturnValue(1000 - index);
    const game = await genericGamesApi.create({
      players: [amy.id],
      settings:
        index % 2 === 0
          ? { mode: "singleRoundWinner", tiebreaker: null, dealer: false }
          : { mode: "points", pointsDirection: "high", tiebreaker: null, dealer: false },
    });
    await genericRoundsApi.add(
      game.settings.mode === "singleRoundWinner"
        ? winnerRoundInput(game)
        : { mode: "points", gameId: game.id, scores: [{ playerId: amy.id, points: "0" }] },
    );
    completed.push(await genericGamesApi.finish(game.id));
  }
  closeDB();
  const oldest = completed[0];
  const latest = completed[20];
  expect(oldest.settings.mode).toBe("singleRoundWinner");
  expect(await genericGamesApi.getById(oldest.id)).toBeUndefined();
  expect(await genericGamesApi.getScoreboard(oldest.id)).toBeNull();
  expect(await genericRoundsApi.getByGameId(oldest.id)).toEqual([]);
  expect(await genericRoundsApi.hasRounds(oldest.id)).toBe(false);
  expect(await genericGamesApi.getById(latest.id)).toEqual(latest);
  expect(await genericRoundsApi.getByGameId(latest.id)).toHaveLength(1);
  const history = (await genericGamesApi.getList()).filter((game) => game.status === "completed");
  expect(history.map((game) => game.id).sort()).toEqual(
    completed
      .slice(1)
      .map((game) => game.id)
      .sort(),
  );
  expect(await genericGamesApi.getActive()).toEqual([active]);
  expect(await playersApi.getById(amy.id)).toEqual(amy);
});
