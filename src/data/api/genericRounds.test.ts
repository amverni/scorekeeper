import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { deleteDB } from "idb";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  AddGenericRoundInput,
  CompletedGenericGame,
  GenericPointsSettings,
  GenericRound,
  GenericScoreDirection,
} from "../../types";
import { closeDB, getDB } from "../db";
import {
  activeGenericGamesOptions,
  genericGameDetailOptions,
  genericGameKeys,
  genericGameScoreboardOptions,
  useAddGenericRound,
} from "../hooks/useGenericGames";
import { playerListOptions } from "../hooks/usePlayers";
import { roundKeys } from "../hooks/useRounds";
import { gamesApi } from "./games";
import { genericGamesApi } from "./genericGames";
import { genericRoundsApi } from "./genericRounds";
import { playersApi } from "./players";

beforeEach(resetDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});

it("requires an explicit Points Scoring Mode instead of defaulting an incomplete Round payload", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const input: AddGenericRoundInput = {
    gameId: game.id,
    mode: "points",
    scores: [{ playerId: zed.id, points: "0" }],
  };
  Reflect.deleteProperty(input, "mode");
  await expect(genericRoundsApi.add(input)).rejects.toThrow("Scoring Mode");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("saves explicit signed Points and reloads Round values and running totals in Game Creation Order", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  const first = await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: amy.id, points: "-12" },
      { playerId: zed.id, points: "0" },
    ],
  });
  expect(first).toEqual({
    id: expect.any(String),
    revision: 0,
    scorekeeper: "generic",
    mode: "points",
    gameId: game.id,
    roundNumber: 1,
    scores: [
      { playerId: zed.id, points: 0 },
      { playerId: amy.id, points: -12 },
    ],
  });
  const second = await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: zed.id, points: "+7" },
      { playerId: amy.id, points: "2" },
    ],
  });
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([first, second]);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: { id: game.id, status: "active" },
    players: [
      { id: zed.id, totalPoints: 7 },
      { id: amy.id, totalPoints: -10 },
    ],
    rounds: [
      {
        roundNumber: 1,
        scores: [
          { playerId: zed.id, points: 0, totalPoints: 0 },
          { playerId: amy.id, points: -12, totalPoints: -12 },
        ],
      },
      {
        roundNumber: 2,
        scores: [
          { playerId: zed.id, points: 7, totalPoints: 7 },
          { playerId: amy.id, points: 2, totalPoints: -10 },
        ],
      },
    ],
  });
});

it.each([
  "",
  " ",
  "+",
  "-",
  "1.5",
  "-1.5",
  "1.0",
  "9007199254740991.1",
  "9007199254740992",
  "9007199254740993",
  "-9007199254740992",
  "999999999999999999999999999999999999999",
  "1e3",
  "0x10",
  "NaN",
  "Infinity",
  "1 2",
  "1_000",
  "12abc",
  "--2",
  "−2",
  " 1",
  "1\n",
])("rejects non-exact or malformed Points %j without saving Round or activity", async (points) => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points }],
    }),
  ).rejects.toThrow(/Points/);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  ["+0", 0],
  ["-0", 0],
  ["0007", 7],
  ["+9007199254740991", 9007199254740991],
  ["-9007199254740991", -9007199254740991],
])("preserves an explicit exact Points value %s", async (points, expected) => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [{ playerId: zed.id, points: String(points) }],
  });
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    players: [{ id: zed.id, totalPoints: expected }],
    rounds: [{ scores: [{ playerId: zed.id, points: expected, totalPoints: expected }] }],
  });
});

it.each([
  "empty",
  "missing",
  "duplicate",
  "outsider",
  "extra",
])("requires exactly one score for every Player and no other entries (%s)", async (invalid) => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  const zedScore = { playerId: zed.id, points: "2" };
  const amyScore = { playerId: amy.id, points: "3" };
  const outsiderScore = { playerId: "outsider", points: "4" };
  const scores = {
    empty: [],
    missing: [zedScore],
    duplicate: [zedScore, amyScore, zedScore],
    outsider: [zedScore, outsiderScore],
    extra: [zedScore, amyScore, outsiderScore],
  }[invalid];
  await expect(
    genericRoundsApi.add({ mode: "points", gameId: game.id, scores: scores ?? [] }),
  ).rejects.toThrow("every Player exactly once");
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  ["9007199254740991", "1"],
  ["-9007199254740991", "-1"],
  ["9007199254740991", "9007199254740991"],
])("rejects individually exact scores whose cumulative Points overflow (%s + %s)", async (first, next) => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  vi.spyOn(Date, "now").mockReturnValue(100);
  const saved = await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: zed.id, points: "3" },
      { playerId: amy.id, points: first },
    ],
  });
  const before = await genericGamesApi.getScoreboard(game.id);
  vi.spyOn(Date, "now").mockReturnValue(200);
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [
        { playerId: zed.id, points: "4" },
        { playerId: amy.id, points: next },
      ],
    }),
  ).rejects.toThrow(/total.*Points.*between/i);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([saved]);
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  expect((await genericGamesApi.getById(game.id))?.lastActivityAt).toBe(100);
});

it.each([
  "high",
  "low",
] as const)("ranks accumulated Points with %s wins and shared competition places in Game Creation Order", async (direction) => {
  const {
    game,
    players: [zed, amy, bob],
  } = await createPointsGame(direction, 3);
  const first = direction === "high" ? ["7", "3", "10"] : ["-7", "-3", "-10"];
  const second = direction === "high" ? ["-2", "2", "-12"] : ["2", "-2", "12"];
  for (const points of [first, second]) {
    await genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [
        { playerId: bob.id, points: points[2] },
        { playerId: amy.id, points: points[1] },
        { playerId: zed.id, points: points[0] },
      ],
    });
  }
  closeDB();
  const scoreboard = await genericGamesApi.getScoreboard(game.id);
  expect(scoreboard?.players.map((player) => player.id)).toEqual([zed.id, amy.id, bob.id]);
  expect(scoreboard?.standings).toEqual([
    { player: identity(zed), totalPoints: direction === "high" ? 5 : -5, place: 1 },
    { player: identity(amy), totalPoints: direction === "high" ? 5 : -5, place: 1 },
    { player: identity(bob), totalPoints: direction === "high" ? -2 : 2, place: 3 },
  ]);
  expect(scoreboard?.game.status).toBe("active");
  expect(scoreboard?.game).not.toHaveProperty("winnerIds");
});

it("starts an empty Game with explicit zero totals and shared first place, without inventing a Round", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual({
    game,
    withdrawnPlayers: [],
    eligiblePlayers: [zed, amy].map(identity),
    primaryGraph: {
      metric: "Points",
      direction: "high",
      series: [zed, amy].map((player) => ({
        player: identity(player),
        points: [{ roundNumber: 0, value: 0 }],
      })),
    },
    tiebreakerGraph: null,
    upcomingDealerId: null,
    players: [
      { ...identity(zed), totalPoints: 0 },
      { ...identity(amy), totalPoints: 0 },
    ],
    rounds: [],
    standings: [
      { player: identity(zed), totalPoints: 0, place: 1 },
      { player: identity(amy), totalPoints: 0, place: 1 },
    ],
  });
});

it.each([
  { mode: "singleRoundWinner" },
  { mode: "passFail" },
  { pointsDirection: "sideways" },
  { tiebreaker: { direction: "sideways" } },
  { dealer: "true" },
])("refuses unsupported persisted Game settings rather than recording a Points Round (%j)", async (invalid) => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const settings: GenericPointsSettings = Object.assign({}, game.settings, invalid);
  await (await getDB()).put("games", { ...game, settings });
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "3" }],
    }),
  ).rejects.toThrow("settings");
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow("settings");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual({ ...game, settings });
});

it.each(["empty", "duplicate"])("rejects a corrupted Game roster (%s)", async (invalid) => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const corrupted = { ...game, players: invalid === "empty" ? [] : [zed.id, zed.id] };
  await (await getDB()).put("games", corrupted);
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow("roster");
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "1" }],
    }),
  ).rejects.toThrow("roster");
  expect(await genericGamesApi.getById(game.id)).toEqual(corrupted);
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
});

it.each([
  { mode: "passFail" },
  { roundNumber: 0 },
  { roundNumber: 1.5 },
  { roundNumber: Number.MAX_SAFE_INTEGER + 1 },
  { scores: [] },
  { scores: null },
  { scores: [{ playerId: "outsider", points: 2 }] },
])("surfaces invalid saved Rounds instead of guessing totals or appending (%j)", async (invalid) => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const round: GenericRound = Object.assign(
    {
      scorekeeper: "generic",
      gameId: game.id,
      mode: "points",
      roundNumber: 1,
      scores: [{ playerId: zed.id, points: 1 }],
    },
    invalid,
  );
  await (await getDB()).put("rounds", round);
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow(/Round/);
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "3" }],
    }),
  ).rejects.toThrow(/Round/);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it.each([
  undefined,
  null,
  "1",
  Number.NaN,
  Number.POSITIVE_INFINITY,
  1.5,
  9007199254740992,
])("rejects corrupted persisted Points %s without appending", async (points) => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const score = Object.assign({ playerId: zed.id, points: 0 }, { points });
  const round: GenericRound = {
    scorekeeper: "generic",
    mode: "points",
    gameId: game.id,
    roundNumber: 1,
    scores: [score],
  };
  await (await getDB()).put("rounds", round);
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow("invalid Points");
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "2" }],
    }),
  ).rejects.toThrow("invalid Points");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("rejects a saved partial or duplicate-Player Round instead of filling missing Points with zero", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  for (const scores of [
    [{ playerId: zed.id, points: 2 }],
    [
      { playerId: zed.id, points: 2 },
      { playerId: zed.id, points: 3 },
    ],
  ]) {
    const round: GenericRound = {
      gameId: game.id,
      scorekeeper: "generic",
      mode: "points",
      roundNumber: 1,
      scores: [scores[0], ...scores.slice(1)],
    };
    await (await getDB()).put("rounds", round);
    await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow(
      "every Player exactly once",
    );
    await expect(
      genericRoundsApi.add({
        mode: "points",
        gameId: game.id,
        scores: [
          { playerId: zed.id, points: "0" },
          { playerId: amy.id, points: "0" },
        ],
      }),
    ).rejects.toThrow("every Player exactly once");
    expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
    expect(await genericGamesApi.getById(game.id)).toEqual(game);
  }
});

it("rejects historical overflow even when later valid scores would cancel it", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const db = await getDB();
  for (const [roundNumber, points] of [
    [1, 9007199254740991],
    [2, 1],
    [3, -1],
  ]) {
    await db.put("rounds", {
      gameId: game.id,
      scorekeeper: "generic",
      mode: "points",
      roundNumber,
      scores: [{ playerId: zed.id, points }],
    });
  }
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow("Total Points");
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "-1" }],
    }),
  ).rejects.toThrow("Total Points");
  expect(await genericRoundsApi.getByGameId(game.id)).toHaveLength(3);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("allows exact opposite-signed cancellation at the integer boundaries", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("low", 1);
  for (const points of ["9007199254740991", "-9007199254740991", "-9007199254740991"]) {
    await genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points }],
    });
  }
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    players: [{ totalPoints: -9007199254740991 }],
    rounds: [
      { scores: [{ totalPoints: 9007199254740991 }] },
      { scores: [{ totalPoints: 0 }] },
      { scores: [{ totalPoints: -9007199254740991 }] },
    ],
  });
});

it("uses monotonically increasing Round numbers and orders persisted scores independently of standings", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  const db = await getDB();
  for (const roundNumber of [9, 3]) {
    await db.put("rounds", {
      gameId: game.id,
      scorekeeper: "generic",
      mode: "points",
      roundNumber,
      scores: [
        { playerId: amy.id, points: 5 },
        { playerId: zed.id, points: 2 },
      ],
    });
  }
  const round = await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: amy.id, points: "1" },
      { playerId: zed.id, points: "0" },
    ],
  });
  expect(round.roundNumber).toBe(10);
  const scoreboard = await genericGamesApi.getScoreboard(game.id);
  expect(scoreboard?.rounds.map((saved) => saved.roundNumber)).toEqual([3, 9, 10]);
  expect(scoreboard?.rounds[0].scores).toEqual([
    { playerId: zed.id, points: 2, totalPoints: 2 },
    { playerId: amy.id, points: 5, totalPoints: 5 },
  ]);
  expect(scoreboard?.players.map((player) => player.id)).toEqual([zed.id, amy.id]);
  expect(
    scoreboard?.standings.map((row) => [
      row.player.id,
      row.place,
      "totalPoints" in row ? row.totalPoints : undefined,
    ]),
  ).toEqual([
    [amy.id, 1, 11],
    [zed.id, 2, 4],
  ]);
});

it("refuses another Round when its number cannot remain an exact integer", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const round: GenericRound = {
    gameId: game.id,
    scorekeeper: "generic",
    mode: "points",
    roundNumber: 9007199254740991,
    scores: [{ playerId: zed.id, points: 0 }],
  };
  await (await getDB()).put("rounds", round);
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "0" }],
    }),
  ).rejects.toThrow("Round");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("rejects missing or wrong-Scorekeeper Games and foreign-owned saved Rounds", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const phase = await gamesApi.create({
    players: [zed.id],
    phaseSet: { id: "phase-set", type: "temporary", name: "Phases", phases: ["phase-1"] },
    settings: { tiebreaker: "lowestPoints", roundSkipPenalty: 100, sitOutPenalty: 0 },
  });
  for (const gameId of ["missing", phase.id]) {
    await expect(
      genericRoundsApi.add({
        mode: "points",
        gameId,
        scores: [{ playerId: zed.id, points: "2" }],
      }),
    ).rejects.toThrow("Generic Game not found");
    expect(await genericGamesApi.getScoreboard(gameId)).toBeNull();
  }
  expect(await gamesApi.getById(phase.id)).toEqual(phase);
  await (await getDB()).put("rounds", {
    gameId: game.id,
    scorekeeper: "phase10",
    roundNumber: 1,
    roundWinnerId: zed.id,
    scores: [{ playerId: zed.id, score: 0, currentPhase: 1, phaseStatus: "completed" }],
  });
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow("another Scorekeeper");
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "2" }],
    }),
  ).rejects.toThrow("another Scorekeeper");
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("reads Completed Game snapshot identities but never accepts another Round", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  const round = await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: zed.id, points: "7" },
      { playerId: amy.id, points: "2" },
    ],
  });
  const completed: CompletedGenericGame = {
    ...game,
    status: "completed",
    completionType: "manual",
    completedAt: 100,
    lastActivityAt: 100,
    winnerIds: [zed.id],
    playerSnapshots: [zed, amy].map(identity),
  };
  await (await getDB()).put("games", completed);
  await playersApi.update(zed.id, { name: "Renamed", color: "Ocean" });
  await playersApi.delete(amy.id);
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [
        { playerId: zed.id, points: "1" },
        { playerId: amy.id, points: "1" },
      ],
    }),
  ).rejects.toThrow("Completed Game");
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    game: completed,
    players: [
      { ...identity(zed), totalPoints: 7 },
      { ...identity(amy), totalPoints: 2 },
    ],
  });
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([round]);
  expect(await genericGamesApi.getById(game.id)).toEqual(completed);
});

it("requires all saved Players to still exist before adding or displaying a Round", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  await (await getDB()).delete("players", amy.id);
  await expect(
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [
        { playerId: zed.id, points: "1" },
        { playerId: amy.id, points: "1" },
      ],
    }),
  ).rejects.toThrow("Player no longer exists");
  await expect(genericGamesApi.getScoreboard(game.id)).rejects.toThrow("Player no longer exists");
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual([]);
  expect(await genericGamesApi.getById(game.id)).toEqual(game);
});

it("snapshots Round input before awaits so caller edits cannot change a pending save", async () => {
  const {
    game,
    players: [zed, amy],
  } = await createPointsGame();
  const input: AddGenericRoundInput = {
    mode: "points",
    gameId: game.id,
    scores: [
      { playerId: amy.id, points: "3" },
      { playerId: zed.id, points: "2" },
    ],
  };
  const pending = genericRoundsApi.add(input);
  input.gameId = "missing";
  input.scores[0].points = "100";
  input.scores[0].playerId = zed.id;
  input.scores.length = 0;
  const saved = await pending;
  if (saved.mode !== "points") throw new Error("Expected Points Round");
  saved.scores[0].points = 42;
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    players: [
      { id: zed.id, totalPoints: 2 },
      { id: amy.id, totalPoints: 3 },
    ],
  });
});

it.each([
  "failure",
  "abort",
])("rolls back Round and activity when Game persistence fails (%s)", async (failureKind) => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [{ playerId: zed.id, points: "1" }],
  });
  const before = await genericGamesApi.getScoreboard(game.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    if (this.name === "games" && failureKind === "failure") {
      throw new DOMException("Activity save failed", "UnknownError");
    }
    const request = put.call(this, value, key);
    if (this.name === "games") {
      request.addEventListener("success", () => this.transaction.abort());
    }
    return request;
  });
  try {
    await expect(
      genericRoundsApi.add({
        mode: "points",
        gameId: game.id,
        scores: [{ playerId: zed.id, points: "2" }],
      }),
    ).rejects.toThrow(failureKind === "failure" ? "Activity save failed" : /abort/i);
  } finally {
    failure.mockRestore();
  }
  closeDB();
  expect(await genericGamesApi.getScoreboard(game.id)).toEqual(before);
  expect(await genericRoundsApi.getByGameId(game.id)).toHaveLength(1);
  await expect(playersApi.delete(zed.id)).rejects.toThrow("Active Game");
});

it("updates activity after a saved Round and reorders Active Games without changing creation state", async () => {
  vi.spyOn(Date, "now").mockReturnValue(10);
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  vi.spyOn(Date, "now").mockReturnValue(20);
  const newer = await genericGamesApi.create({ players: [zed.id], settings: game.settings });
  vi.spyOn(Date, "now").mockReturnValue(30);
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [{ playerId: zed.id, points: "0" }],
  });
  closeDB();
  expect(await genericGamesApi.getById(game.id)).toEqual({ ...game, lastActivityAt: 30 });
  expect((await genericGamesApi.getActiveViews()).map(({ game }) => game.id)).toEqual([
    game.id,
    newer.id,
  ]);
});

it("serializes concurrent additions into distinct Rounds without losing either score", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const saved = await Promise.all(
    ["3", "-1", "7"].map((points) =>
      genericRoundsApi.add({
        mode: "points",
        gameId: game.id,
        scores: [{ playerId: zed.id, points }],
      }),
    ),
  );
  expect(saved.map((round) => round.roundNumber)).toEqual([1, 2, 3]);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toEqual(saved);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    players: [{ totalPoints: 9 }],
    rounds: [
      { scores: [{ totalPoints: 3 }] },
      { scores: [{ totalPoints: 2 }] },
      { scores: [{ totalPoints: 9 }] },
    ],
  });
});

it("rechecks cumulative bounds after a concurrent save instead of racing past the limit", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  await genericRoundsApi.add({
    mode: "points",
    gameId: game.id,
    scores: [{ playerId: zed.id, points: "9007199254740990" }],
  });
  const input = {
    mode: "points" as const,
    gameId: game.id,
    scores: [{ playerId: zed.id, points: "1" }],
  };
  const results = await Promise.allSettled([
    genericRoundsApi.add(input),
    genericRoundsApi.add(input),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toMatchObject([
    { reason: new Error("Total Points must be between -9007199254740991 and 9007199254740991.") },
  ]);
  closeDB();
  expect(await genericRoundsApi.getByGameId(game.id)).toHaveLength(2);
  expect(await genericGamesApi.getScoreboard(game.id)).toMatchObject({
    players: [{ totalPoints: 9007199254740991 }],
  });
});

it("reads each scoreboard from one transaction while a Round and activity update are being saved", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  vi.spyOn(Date, "now").mockReturnValue(game.lastActivityAt + 1);
  const [before, , after] = await Promise.all([
    genericGamesApi.getScoreboard(game.id),
    genericRoundsApi.add({
      mode: "points",
      gameId: game.id,
      scores: [{ playerId: zed.id, points: "4" }],
    }),
    genericGamesApi.getScoreboard(game.id),
  ]);
  expect(before).toMatchObject({ game, players: [{ totalPoints: 0 }], rounds: [] });
  expect(after).toMatchObject({
    game: { lastActivityAt: game.lastActivityAt + 1 },
    players: [{ totalPoints: 4 }],
    rounds: [{ roundNumber: 1, scores: [{ points: 4, totalPoints: 4 }] }],
  });
});

it("invalidates generic scoreboard, detail and activity only after a successful save without expiring unrelated caches", async () => {
  const {
    game,
    players: [zed],
  } = await createPointsGame("high", 1);
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  try {
    const scoreboardOptions = genericGameScoreboardOptions(game.id);
    expect(scoreboardOptions.queryKey.slice(0, genericGameKeys.all.length)).toEqual(
      genericGameKeys.all,
    );
    const keys = [
      scoreboardOptions.queryKey,
      genericGameDetailOptions(game.id).queryKey,
      activeGenericGamesOptions().queryKey,
    ];
    await Promise.all([
      client.fetchQuery(scoreboardOptions),
      client.fetchQuery(genericGameDetailOptions(game.id)),
      client.fetchQuery(activeGenericGamesOptions()),
      client.fetchQuery(playerListOptions()),
    ]);
    client.setQueryData(roundKeys.list("unrelated-phase-game"), []);
    let save: ReturnType<typeof useAddGenericRound>["mutateAsync"] | undefined;
    function MutationHarness() {
      save = useAddGenericRound().mutateAsync;
      return null;
    }
    renderToString(createElement(QueryClientProvider, { client }, createElement(MutationHarness)));
    if (!save) throw new Error("Mutation hook was not rendered");
    await expect(
      save({ mode: "points", gameId: game.id, scores: [{ playerId: zed.id, points: "" }] }),
    ).rejects.toThrow("Points");
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    await save({ mode: "points", gameId: game.id, scores: [{ playerId: zed.id, points: "-5" }] });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(playerListOptions().queryKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(roundKeys.list("unrelated-phase-game"))?.isInvalidated).toBe(false);
    expect(await client.fetchQuery(scoreboardOptions)).toMatchObject({
      players: [{ id: zed.id, totalPoints: -5 }],
      rounds: [{ roundNumber: 1 }],
    });
    expect(await client.fetchQuery(genericGameScoreboardOptions("missing"))).toBeNull();
  } finally {
    client.clear();
  }
});

function identity({ id, name, color }: { id: string; name: string; color: string }) {
  return { id, name, color };
}

async function createPointsGame(direction: GenericScoreDirection = "high", count = 2) {
  const players = await Promise.all(
    ["Zed", "Amy", "Bob"]
      .slice(0, count)
      .map((name) => playersApi.create({ name, color: "Jam", isFavorite: 0 })),
  );
  const game = await genericGamesApi.create({
    players: players.map((player) => player.id),
    settings: { mode: "points", pointsDirection: direction, tiebreaker: null, dealer: false },
  });
  return { game, players };
}

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}
