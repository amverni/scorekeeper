import { describe, expect, it } from "vitest";
import { deriveStandings } from "../../data/api/standings";
import type { Round } from "../../types";
import {
  makePhaseGraphGame,
  makePhaseGraphRound,
  makePhaseGraphSeries,
  phaseGraphPlayers,
} from "./phaseGraphTestFixtures";
import { getPhaseGraphView } from "./phaseGraphView";

describe("getPhaseGraphView", () => {
  it("maps baseline and after-round phase progress with compact axis labels", () => {
    const view = getPhaseGraphView({
      series: [
        {
          player: phaseGraphPlayers.amy,
          points: [
            { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
            { roundNumber: 1, currentPhase: 2, isFinished: false, standingValue: 2 },
            { roundNumber: 2, currentPhase: 3, isFinished: true, standingValue: 4 },
          ],
        },
        {
          player: phaseGraphPlayers.bob,
          points: [
            { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
            { roundNumber: 1, currentPhase: 1, isFinished: false, standingValue: 1 },
            { roundNumber: 2, currentPhase: 2, isFinished: false, standingValue: 2 },
          ],
        },
      ],
      totalPhases: 3,
    });

    expect(view.roundLabels).toEqual([
      { roundNumber: 0, label: null, showLabel: false, x: 40 },
      { roundNumber: 1, label: "1", showLabel: true, x: 168 },
      { roundNumber: 2, label: "2", showLabel: true, x: 296 },
    ]);
    expect(view.phaseLabels).toEqual([
      { value: 4, label: null, isFinished: true, y: 24 },
      { value: 3, label: "3", isFinished: false, y: 76 },
      { value: 2, label: "2", isFinished: false, y: 128 },
      { value: 1, label: "1", isFinished: false, y: 180 },
    ]);
    expect(view.series.map((series) => series.player.id)).toEqual(["amy", "bob"]);
    expect(view.series[0]?.linePoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 40, y: 180 },
      { x: 168, y: 128 },
      { x: 296, y: 24 },
    ]);
    expect(view.series[0]?.path).toBe("M 40 180 L 168 128 L 296 24");
    expect(view.series[1]?.linePoints.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 40, y: 180 },
      { x: 168, y: 180 },
      { x: 296, y: 128 },
    ]);
    expect(view.width).toBe(360);
    expect(view.height).toBe(224);
    expect(
      view.latestEndpointGroups.find((group) => group.label === "finished phase 3"),
    ).toMatchObject({
      label: "finished phase 3",
      players: [phaseGraphPlayers.amy],
    });
  });

  it("groups latest tied phase endpoints in tiebreaker order without collapsing players", () => {
    const game = makePhaseGraphGame();
    const rounds: Round[] = [
      makePhaseGraphRound(1, phaseGraphPlayers.cam.id, [
        { playerId: phaseGraphPlayers.amy.id, currentPhase: 1, phaseStatus: "completed", score: 3 },
        { playerId: phaseGraphPlayers.bob.id, currentPhase: 1, phaseStatus: "completed", score: 1 },
        { playerId: phaseGraphPlayers.cam.id, currentPhase: 1, phaseStatus: "completed", score: 1 },
      ]),
    ];
    const standings = deriveStandings({
      game,
      players: [phaseGraphPlayers.amy, phaseGraphPlayers.bob, phaseGraphPlayers.cam],
      rounds,
    });

    const view = getPhaseGraphView({
      series: standings.phaseGraphSeries,
      totalPhases: 3,
      rows: standings.rows,
    });

    expect(view.latestEndpointGroups).toEqual([
      {
        key: "1:2",
        label: "phase 2",
        x: 296,
        y: 128,
        players: [phaseGraphPlayers.cam, phaseGraphPlayers.bob, phaseGraphPlayers.amy],
      },
    ]);
  });

  it("shows every saved Round label while spacing is readable", () => {
    const series = [makePhaseGraphSeries(9)];

    const view = getPhaseGraphView({ series, totalPhases: 3 });

    expect(view.roundLabels).toHaveLength(9);
    expect(view.roundLabels.filter((label) => label.showLabel).map((label) => label.label)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8"],
    );
    expect(view.width).toBe(360);
  });

  it("thins Round labels only when spacing is too dense", () => {
    const series = [makePhaseGraphSeries(13)];

    const view = getPhaseGraphView({ series, totalPhases: 3 });

    expect(view.roundLabels).toHaveLength(13);
    expect(view.roundLabels.filter((label) => label.showLabel).map((label) => label.label)).toEqual(
      ["2", "4", "6", "8", "10", "12"],
    );
    expect(view.width).toBe(360);
  });

  it("does not force the final Round label too close to the previous visible label", () => {
    const series = [makePhaseGraphSeries(12)];

    const view = getPhaseGraphView({ series, totalPhases: 3 });

    expect(view.roundLabels).toHaveLength(12);
    expect(view.roundLabels.filter((label) => label.showLabel).map((label) => label.label)).toEqual(
      ["1", "3", "5", "7", "9", "11"],
    );
  });

  it("fits many saved Rounds into one graph width without dropping ticks", () => {
    const series = [makePhaseGraphSeries(25)];

    const view = getPhaseGraphView({ series, totalPhases: 3 });
    const xPositions = view.roundLabels.map((label) => label.x);
    const roundSpacing = xPositions[1] - xPositions[0];

    expect(view.roundLabels).toHaveLength(25);
    expect(view.width).toBeLessThanOrEqual(360);
    expect(roundSpacing).toBeGreaterThan(0);
    expect(roundSpacing).toBeLessThan(72);
    expect(new Set(xPositions).size).toBe(25);
    expect(Math.max(...xPositions)).toBeLessThanOrEqual(view.width - 64);
  });

  it("keeps every Phase row inside a compact chart height", () => {
    const view = getPhaseGraphView({
      totalPhases: 10,
      series: [
        {
          player: phaseGraphPlayers.amy,
          points: [
            { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
            { roundNumber: 12, currentPhase: 10, isFinished: true, standingValue: 11 },
          ],
        },
      ],
    });
    const yPositions = view.phaseLabels.map((label) => label.y);

    expect(view.height).toBeLessThanOrEqual(320);
    expect(view.phaseLabels).toHaveLength(11);
    expect(Math.min(...yPositions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...yPositions)).toBeLessThanOrEqual(view.height - 44);
  });

  it("reserves endpoint padding so latest avatar groups stay within chart bounds", () => {
    const view = getPhaseGraphView({
      totalPhases: 3,
      rows: [],
      series: [
        {
          player: phaseGraphPlayers.amy,
          points: [
            { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
            { roundNumber: 12, currentPhase: 3, isFinished: true, standingValue: 4 },
          ],
        },
      ],
    });

    expect(view.latestEndpointGroups[0]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    });
    expect(view.latestEndpointGroups[0]?.x).toBeLessThanOrEqual(view.width - 64);
    expect(view.latestEndpointGroups[0]?.y).toBeGreaterThanOrEqual(0);
    expect(view.latestEndpointGroups[0]?.y).toBeLessThanOrEqual(view.height - 44);
  });

  it("keeps large Phase Sets within the mobile graph height", () => {
    const view = getPhaseGraphView({
      totalPhases: 10,
      series: [
        {
          player: phaseGraphPlayers.amy,
          points: [
            { roundNumber: 0, currentPhase: 1, isFinished: false, standingValue: 1 },
            { roundNumber: 1, currentPhase: 10, isFinished: true, standingValue: 11 },
          ],
        },
      ],
    });

    expect(view.height).toBe(318);
    expect(view.phaseLabels).toHaveLength(11);
    expect(view.phaseLabels[0]).toMatchObject({
      label: null,
      isFinished: true,
      y: 24,
    });
    expect(view.phaseLabels.at(-1)).toMatchObject({
      label: "1",
      isFinished: false,
      y: 274,
    });
  });
});
