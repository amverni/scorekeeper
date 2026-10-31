import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { GameTiebreaker } from "../../types";
import { closeDB } from "../db";
import { gamesApi } from "./games";
import { playersApi } from "./players";
import { roundsApi } from "./rounds";

async function resetDatabase() {
  closeDB();
  await deleteDB("phase10-db");
}

beforeEach(resetDatabase);
afterEach(resetDatabase);

async function setup(tiebreaker: GameTiebreaker = "fewestWilds") {
  const amy = await playersApi.create({ name: "Amy", color: "Jam", isFavorite: 0 });
  const bob = await playersApi.create({ name: "Bob", color: "Ocean", isFavorite: 0 });
  const cam = await playersApi.create({ name: "Cam", color: "Lime", isFavorite: 0 });
  const game = await gamesApi.create({
    players: [amy.id, bob.id, cam.id],
    phaseSet: {
      id: "repeated",
      type: "temporary",
      name: "Repeated objectives",
      phases: ["classic-1", "classic-1", "classic-3"],
    },
    settings: {
      inOrderPhases: false,
      tiebreaker,
      roundSkipPenalty: 100,
      sitOutPenalty: 25,
    },
  });
  return { game, amy, bob, cam };
}

it("persists numbered selections and ranks distinct resolved progress, not the selected Phase number", async () => {
  const { game, amy, bob, cam } = await setup();
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, selectedPhase: 3, phaseStatus: "failed", score: 0 },
      { playerId: bob.id, selectedPhase: 2, phaseStatus: "completed", score: 2 },
      { playerId: cam.id, selectedPhase: 1, phaseStatus: "satOut", score: 0 },
    ],
  });

  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.game.settings.inOrderPhases).toBe(false);
  expect(view?.rounds[0].scores.map((entry) => entry.phaseNumber)).toEqual([3, 2, 1]);
  expect(view?.standings.rows.map((row) => [row.player.id, row.place])).toEqual([
    [bob.id, 1],
    [amy.id, 2],
    [cam.id, 2],
  ]);
  expect(view?.players.map((player) => player.progress)).toMatchObject([
    { currentPhase: 1, isFinished: false, selectable: { resolvedPhases: [], totalPhases: 3 } },
    { currentPhase: 1, isFinished: false, selectable: { resolvedPhases: [2], totalPhases: 3 } },
    { currentPhase: 1, isFinished: false, selectable: { resolvedPhases: [], totalPhases: 3 } },
  ]);
});

it("applies Round Skip and Sit Out penalties without treating Sit Out as resolution and prevents duplicate saves", async () => {
  const { game, amy, bob, cam } = await setup("lowestPoints");
  const before = await gamesApi.getView(game.id);
  const scores = [
    { playerId: amy.id, selectedPhase: 3, phaseStatus: "skipped" as const, score: 100 },
    { playerId: bob.id, selectedPhase: 2, phaseStatus: "satOut" as const, score: 25 },
    {
      playerId: cam.id,
      selectedPhase: 1,
      phaseStatus: "failed" as const,
      score: 50,
      pointsCardBreakdown: { p5: 10, p10: 0, skipCard: 0, wild: 0 },
    },
  ] as const;
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [{ ...scores[0], score: 95 }, scores[1], scores[2]],
    }),
  ).rejects.toThrow("configured penalty");
  await expect(
    roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [scores[0], scores[1], { ...scores[2], score: 55 }],
    }),
  ).rejects.toThrow("Points must match cards");
  expect(await gamesApi.getView(game.id)).toEqual(before);
  const input: Parameters<typeof roundsApi.add>[0] = {
    gameId: game.id,
    roundWinnerId: null,
    expectedVersion: before?.version,
    expectedRoundNumber: 1,
    scores: [scores[0], scores[1], scores[2]],
  };
  const outcomes = await Promise.allSettled([roundsApi.add(input), roundsApi.add(input)]);
  expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.rounds).toHaveLength(1);
  expect(view?.players.map((player) => player.tiebreakerTotal)).toEqual([100, 25, 50]);
  expect(view?.players.map((player) => player.progress.selectable?.resolvedPhases)).toEqual([
    [3],
    [],
    [],
  ]);
});

it("finishes on the last Remaining Phase, preserves repeated objectives, and freezes results through Continuation", async () => {
  const { game, amy, bob, cam } = await setup();
  for (const [amyPhase, bobPhase] of [
    [3, 1],
    [1, 3],
    [2, 2],
  ]) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        {
          playerId: amy.id,
          selectedPhase: amyPhase,
          phaseStatus: amyPhase === 1 ? "skipped" : "completed",
          score: amyPhase === 1 ? 0 : 1,
        },
        {
          playerId: bob.id,
          selectedPhase: bobPhase,
          phaseStatus: bobPhase === 2 ? "failed" : "completed",
          score: bobPhase === 2 ? 9 : 2,
        },
        { playerId: cam.id, selectedPhase: 3, phaseStatus: "failed", score: 0 },
      ],
    });
  }
  closeDB();
  const firstFinish = await gamesApi.getView(game.id);
  expect(firstFinish?.players[0]).toMatchObject({
    finishingRound: 3,
    finishingPlace: 1,
    tiebreakerTotal: 2,
    progress: { isFinished: true, selectable: { resolvedPhases: [1, 2, 3] } },
  });
  expect(firstFinish?.game.status).toBe("active");
  if (!firstFinish?.pendingFinishChoice) throw new Error("Missing first-finisher choice");
  await gamesApi.resolveFinishChoice(game.id, "continue", firstFinish.pendingFinishChoice.token);
  closeDB();
  expect((await gamesApi.getView(game.id))?.upcomingDealerId).toBe(bob.id);
  const result = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: bob.id,
    scores: [
      { playerId: bob.id, selectedPhase: 2, phaseStatus: "completed", score: 1 },
      { playerId: cam.id, selectedPhase: 3, phaseStatus: "failed", score: 0 },
    ],
  });
  closeDB();
  const final = await gamesApi.getView(game.id);
  expect(result.outcome).toBe("gameCompleted");
  expect(final?.game).toMatchObject({
    status: "completed",
    completionType: "normal",
    winnerIds: [amy.id],
    settings: { inOrderPhases: false },
  });
  expect(final?.gameEndingRound).toBe(4);
  expect(
    final?.players.map((player) => [
      player.finishingRound,
      player.finishingPlace,
      player.tiebreakerTotal,
    ]),
  ).toEqual([
    [3, 1, 2],
    [4, 2, 14],
    [null, null, 0],
  ]);
  expect(final?.rounds[3].scores[0]).toMatchObject({ counted: false, source: undefined });
  expect(final?.standings.phaseGraphSeries[0].points.map((point) => point.standingValue)).toEqual([
    0, 1, 2, 3,
  ]);
  expect(final?.upcomingDealerId).toBeNull();
  for (const playerId of game.players) await playersApi.delete(playerId);
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(final);
});

it("preserves Join, Withdrawal, Rejoin and genuine gaps through reversible finishes and Round Deletion", async () => {
  const { game, amy, bob, cam } = await setup();
  const dora = await playersApi.create({ name: "Dora", color: "Jam", isFavorite: 0 });
  let joined = false;
  async function membership(withdrawnPlayers: string[]) {
    const editor = await gamesApi.getEditor(game.id);
    if (!editor) throw new Error("Missing Game editor");
    await gamesApi.edit({
      gameId: game.id,
      version: editor.version,
      players: [...game.players, dora.id],
      withdrawnPlayers,
      confirmImpact: true,
    });
    joined = true;
    closeDB();
  }
  for (let roundNumber = 1; roundNumber <= 5; roundNumber++) {
    const otherScores = [
      { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed" as const, score: 2 },
      { playerId: cam.id, selectedPhase: 2, phaseStatus: "failed" as const, score: 3 },
      ...(joined
        ? [
            {
              playerId: dora.id,
              selectedPhase: 3,
              phaseStatus: "failed" as const,
              score: 1,
            },
          ]
        : []),
    ];
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        otherScores[0],
        ...otherScores.slice(1),
        ...(roundNumber === 4
          ? []
          : [
              {
                playerId: amy.id,
                selectedPhase: roundNumber === 1 ? 3 : roundNumber === 2 ? 2 : 1,
                phaseStatus: roundNumber < 3 ? ("completed" as const) : ("failed" as const),
                score: roundNumber,
              },
            ]),
      ],
    });
    if (roundNumber === 1 || roundNumber === 4) await membership([]);
    if (roundNumber === 3) await membership([amy.id]);
  }
  const original = await gamesApi.getView(game.id);
  const editor = await gamesApi.getRoundEditor(game.id, 3);
  const correction = {
    gameId: game.id,
    roundNumber: 3,
    version: editor.version,
    roundWinnerId: null,
    scores: editor.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" as const } : score,
    ),
  };
  expect(await gamesApi.previewRoundEdit(correction)).toEqual({ requiresConfirmation: true });
  await expect(gamesApi.editRound(correction)).rejects.toThrow("Confirm");
  await gamesApi.editRound({ ...correction, confirmImpact: true });
  closeDB();
  const finished = await gamesApi.getView(game.id);
  expect(finished?.players[0]).toMatchObject({
    finishingRound: 3,
    place: 1,
    tiebreakerTotal: 6,
  });
  expect(finished?.rounds[4].scores[0]).toMatchObject({
    counted: false,
    source: original?.rounds[4].scores[0].source,
  });
  expect(finished?.game.playerMembershipChanges).toEqual(original?.game.playerMembershipChanges);
  const restore = await gamesApi.getRoundEditor(game.id, 3);
  await gamesApi.editRound({
    ...correction,
    version: restore.version,
    scores: editor.round.scores,
    confirmImpact: true,
  });
  closeDB();
  const restored = await gamesApi.getView(game.id);
  expect(restored?.players[0]).toMatchObject({
    finishingRound: null,
    tiebreakerTotal: 11,
    progress: { currentPhase: 1, selectable: { resolvedPhases: [2, 3] } },
  });
  expect(restored?.players[3]).toMatchObject({
    tiebreakerTotal: 4,
    progress: { selectable: { resolvedPhases: [] } },
  });
  expect(restored?.rounds[0].scores[3]).toMatchObject({ counted: false, source: undefined });
  expect(restored?.rounds[3].scores[0]).toMatchObject({ counted: false, source: undefined });
  expect(restored?.rounds.map((round) => round.source.scores)).toEqual(
    original?.rounds.map((round) => round.source.scores),
  );
  const remove = await gamesApi.getRoundEditor(game.id, 2);
  await gamesApi.deleteRound({
    gameId: game.id,
    roundId: remove.round.id,
    version: remove.version,
  });
  closeDB();
  const deleted = await gamesApi.getView(game.id);
  expect(deleted?.players[0].progress.selectable?.resolvedPhases).toEqual([3]);
  expect(deleted?.rounds[2].scores[0]).toMatchObject({ counted: false, source: undefined });
  expect(deleted?.rounds.map((round) => round.source.id)).toEqual(
    original?.rounds
      .filter((round) => round.source.roundNumber !== 2)
      .map((round) => round.source.id),
  );
});

it("retains a later Failed attempt and its tiebreaker contribution when an earlier attempt resolves its Phase", async () => {
  const { game, amy, bob, cam } = await setup();
  for (const score of [1, 4]) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, selectedPhase: 3, phaseStatus: "failed", score },
        { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 2 },
        { playerId: cam.id, selectedPhase: 2, phaseStatus: "failed", score: 3 },
      ],
    });
  }
  const original = await roundsApi.getByGameId(game.id);
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    roundWinnerId: null,
    scores: editor.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" as const } : score,
    ),
  };
  expect(await gamesApi.previewRoundEdit(input)).toEqual({ requiresConfirmation: true });
  await gamesApi.editRound({ ...input, confirmImpact: true });
  closeDB();
  const view = await gamesApi.getView(game.id);
  expect(view?.players[0]).toMatchObject({
    tiebreakerTotal: 5,
    progress: { selectable: { resolvedPhases: [3] } },
  });
  expect(view?.rounds[1].scores[0]).toMatchObject({
    counted: true,
    phaseNumber: 3,
    tiebreakerValue: 4,
    phaseAlreadyResolved: true,
    source: original[1].scores[0],
  });
  const later = await gamesApi.getRoundEditor(game.id, 2);
  const numericEdit = {
    gameId: game.id,
    roundNumber: 2,
    version: later.version,
    roundWinnerId: null,
    scores: later.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, selectedPhase: score.currentPhase, score: 5 } : score,
    ),
  };
  expect(await gamesApi.previewRoundEdit(numericEdit)).toEqual({ requiresConfirmation: false });
  await gamesApi.editRound(numericEdit);
  closeDB();
  expect((await gamesApi.getView(game.id))?.players[0].tiebreakerTotal).toBe(6);
});

it("changes an earlier Failed attempt to a Phase resolved later and reloads the recorded selection", async () => {
  const { game, amy, bob, cam } = await setup();
  for (const [phase, result, score] of [
    [1, "failed", 1],
    [3, "completed", 4],
  ] as const) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, selectedPhase: phase, phaseStatus: result, score },
        { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 2 },
        { playerId: cam.id, selectedPhase: 2, phaseStatus: "failed", score: 3 },
      ],
    });
  }
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    roundWinnerId: null,
    confirmImpact: true,
    scores: editor.round.scores.map((score) => ({
      ...score,
      selectedPhase: score.playerId === amy.id ? 3 : score.currentPhase,
    })),
  };
  const before = await gamesApi.getView(game.id);
  for (const phaseStatus of ["completed", "skipped"] as const) {
    const duplicate = {
      ...input,
      scores: input.scores.map((score) =>
        score.playerId === amy.id ? { ...score, phaseStatus, score: 0 } : score,
      ),
    };
    await expect(gamesApi.previewRoundEdit(duplicate)).rejects.toThrow("already resolved");
    await expect(gamesApi.editRound(duplicate)).rejects.toThrow("already resolved");
    closeDB();
    expect(await gamesApi.getView(game.id)).toEqual(before);
  }
  const outcomes = await Promise.allSettled([gamesApi.editRound(input), gamesApi.editRound(input)]);
  expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
  closeDB();
  const reloaded = await gamesApi.getView(game.id);
  expect(reloaded?.rounds[0].scores[0]).toMatchObject({
    counted: true,
    phaseNumber: 3,
    source: { currentPhase: 3, phaseStatus: "failed", score: 1 },
  });
  expect(reloaded?.players[0]).toMatchObject({
    tiebreakerTotal: 5,
    progress: { selectable: { resolvedPhases: [3] } },
  });
  expect((await gamesApi.getRoundEditor(game.id, 1)).round.scores[0].currentPhase).toBe(3);
});

it("rejects a newly selected Phase resolved before the edited Round without partially saving", async () => {
  const { game, amy, bob, cam } = await setup();
  for (const [phase, result] of [
    [2, "completed"],
    [1, "failed"],
  ] as const) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, selectedPhase: phase, phaseStatus: result, score: 1 },
        { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 2 },
        { playerId: cam.id, selectedPhase: 2, phaseStatus: "failed", score: 3 },
      ],
    });
  }
  const editor = await gamesApi.getRoundEditor(game.id, 2);
  const before = await gamesApi.getView(game.id);
  for (const selectedPhase of [2, 0, 4, 1.5, Number.NaN]) {
    const input = {
      gameId: game.id,
      roundNumber: 2,
      version: editor.version,
      roundWinnerId: null,
      confirmImpact: true,
      scores: editor.round.scores.map((score) => ({
        ...score,
        score: 5,
        selectedPhase: score.playerId === amy.id ? selectedPhase : score.currentPhase,
      })),
    };
    await expect(gamesApi.previewRoundEdit(input)).rejects.toThrow(
      selectedPhase === 2 ? "resolved before this Round" : "valid Phase Number",
    );
    await expect(gamesApi.editRound(input)).rejects.toThrow(
      selectedPhase === 2 ? "resolved before this Round" : "valid Phase Number",
    );
    closeDB();
    expect(await gamesApi.getView(game.id)).toEqual(before);
  }
});

it("blocks an earlier duplicate even if the proposed finish would exclude the later resolution", async () => {
  const { game, amy, bob, cam } = await setup();
  for (const [phase, result] of [
    [3, "completed"],
    [2, "completed"],
    [1, "failed"],
    [1, "completed"],
  ] as const) {
    await roundsApi.add({
      gameId: game.id,
      roundWinnerId: null,
      scores: [
        { playerId: amy.id, selectedPhase: phase, phaseStatus: result, score: 1 },
        { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 0 },
        { playerId: cam.id, selectedPhase: 1, phaseStatus: "failed", score: 0 },
      ],
    });
  }
  const before = await gamesApi.getView(game.id);
  const editor = await gamesApi.getRoundEditor(game.id, 3);
  const input = {
    gameId: game.id,
    roundNumber: 3,
    version: editor.version,
    roundWinnerId: null,
    confirmImpact: true,
    scores: editor.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" as const } : score,
    ),
  };
  await expect(gamesApi.previewRoundEdit(input)).rejects.toThrow("already resolved");
  await expect(gamesApi.editRound(input)).rejects.toThrow("already resolved");
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
});

it("rejects duplicate resolutions, invalid selections and stale submissions atomically while retaining historical Failed attempts", async () => {
  const { game, amy, bob, cam } = await setup();
  const first = await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, selectedPhase: 2, phaseStatus: "failed", score: 3 },
      { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 0 },
      { playerId: cam.id, selectedPhase: 3, phaseStatus: "failed", score: 0 },
    ],
  });
  const stale = await gamesApi.getRoundEditor(game.id, 1);
  await roundsApi.add({
    gameId: game.id,
    roundWinnerId: null,
    scores: [
      { playerId: amy.id, selectedPhase: 2, phaseStatus: "completed", score: 1 },
      { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 0 },
      { playerId: cam.id, selectedPhase: 3, phaseStatus: "failed", score: 0 },
    ],
  });
  const editor = await gamesApi.getRoundEditor(game.id, 1);
  const before = await gamesApi.getView(game.id);
  const input = {
    gameId: game.id,
    roundNumber: 1,
    version: editor.version,
    roundWinnerId: null,
    scores: editor.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, phaseStatus: "completed" as const } : score,
    ),
    confirmImpact: true,
  };
  await expect(gamesApi.previewRoundEdit(input)).rejects.toThrow("already resolved");
  await expect(gamesApi.editRound(input)).rejects.toThrow("already resolved");
  await expect(
    roundsApi.edit(game.id, 1, amy.id, { phaseStatus: "skipped", score: 0 }),
  ).rejects.toThrow("already resolved");
  await expect(gamesApi.editRound({ ...input, version: stale.version })).rejects.toThrow(
    "history changed",
  );
  for (const selectedPhase of [2, 0, 4, 1.5, Number.NaN]) {
    await expect(
      roundsApi.add({
        gameId: game.id,
        roundWinnerId: null,
        scores: [
          { playerId: amy.id, selectedPhase, phaseStatus: "completed", score: 0 },
          { playerId: bob.id, selectedPhase: 1, phaseStatus: "failed", score: 0 },
          { playerId: cam.id, selectedPhase: 3, phaseStatus: "failed", score: 0 },
        ],
      }),
    ).rejects.toThrow(/Phase/);
  }
  closeDB();
  expect(await gamesApi.getView(game.id)).toEqual(before);
  await gamesApi.editRound({
    ...input,
    scores: editor.round.scores.map((score) =>
      score.playerId === amy.id ? { ...score, score: 4 } : score,
    ),
  });
  closeDB();
  const after = await gamesApi.getView(game.id);
  expect(after?.rounds[0].scores[0]).toMatchObject({
    counted: true,
    phaseNumber: 2,
    source: { phaseStatus: "failed", score: 4, currentPhase: 2 },
  });
  expect(after?.players[0].tiebreakerTotal).toBe(5);
  expect((await roundsApi.getByGameId(game.id))[0].id).toBe(first.round.id);
});
