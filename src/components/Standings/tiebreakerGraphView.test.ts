import { describe, expect, it } from "vitest";
import type { GameTiebreaker, Round, TiebreakerGraphSeries } from "../../types";
import { phaseGraphPlayers } from "./phaseGraphTestFixtures";
import { getTiebreakerGraphView } from "./tiebreakerGraphView";

describe("getTiebreakerGraphView", () => {
  it("maps lower-is-better totals so lower Tiebreaker totals render higher on screen", () => {
    const view = getTiebreakerGraphView({
      tiebreaker: "lowestPoints",
      series: [
        makeTiebreakerSeries(phaseGraphPlayers.amy, [
          [0, 0, 0],
          [1, 10, -10],
          [2, 10, -10],
        ]),
        makeTiebreakerSeries(phaseGraphPlayers.bob, [
          [0, 0, 0],
          [1, 20, -20],
          [2, 50, -50],
        ]),
      ],
    });

    expect(view.width).toBe(360);
    expect(view.height).toBe(224);
    expect(view.roundLabels).toEqual([
      { roundNumber: 0, label: null, showLabel: false, x: 64 },
      { roundNumber: 1, label: "1", showLabel: true, x: 180 },
      { roundNumber: 2, label: "2", showLabel: true, x: 296 },
    ]);
    expect(view.valueLabels).toEqual([
      { value: 0, label: "0 pts", y: 24 },
      { value: 25, label: "25 pts", y: 102 },
      { value: 50, label: "50 pts", y: 180 },
    ]);
    expect(view.series[0]?.linePoints.map(({ value, x, y }) => ({ value, x, y }))).toEqual([
      { value: 0, x: 64, y: 24 },
      { value: 10, x: 180, y: 55.2 },
      { value: 10, x: 296, y: 55.2 },
    ]);
    expect(view.series[0]?.path).toBe("M 64 24 L 180 55.2 L 296 55.2");
    expect(view.series[1]?.linePoints.at(-1)?.y).toBeGreaterThan(
      view.series[0]?.linePoints.at(-1)?.y ?? 0,
    );
  });

  it("maps higher-is-better totals so higher Tiebreaker totals render higher on screen", () => {
    const view = getTiebreakerGraphView({
      tiebreaker: "highestPoints",
      series: [
        makeTiebreakerSeries(phaseGraphPlayers.amy, [
          [0, 0, 0],
          [1, 10, 10],
          [2, 10, 10],
        ]),
        makeTiebreakerSeries(phaseGraphPlayers.bob, [
          [0, 0, 0],
          [1, 20, 20],
          [2, 50, 50],
        ]),
      ],
    });

    expect(view.valueLabels).toEqual([
      { value: 50, label: "50 pts", y: 24 },
      { value: 25, label: "25 pts", y: 102 },
      { value: 0, label: "0 pts", y: 180 },
    ]);
    expect(view.series[1]?.linePoints.at(-1)?.y).toBeLessThan(
      view.series[0]?.linePoints.at(-1)?.y ?? 0,
    );
  });

  it("orders tied latest endpoints by most recent Round Winner then Game Creation Order", () => {
    const rounds: Round[] = [
      makeRound(1, phaseGraphPlayers.cam.id),
      makeRound(2, phaseGraphPlayers.bob.id),
    ];

    const view = getTiebreakerGraphView({
      tiebreaker: "lowestPoints",
      rounds,
      series: [
        makeTiebreakerSeries(phaseGraphPlayers.amy, [
          [0, 0, 0],
          [2, 10, -10],
        ]),
        makeTiebreakerSeries(phaseGraphPlayers.bob, [
          [0, 0, 0],
          [2, 10, -10],
        ]),
        makeTiebreakerSeries(phaseGraphPlayers.cam, [
          [0, 0, 0],
          [2, 10, -10],
        ]),
      ],
    });

    expect(view.latestEndpointGroups).toEqual([
      {
        key: "2:-10",
        label: "10 pts",
        x: 296,
        y: 180,
        players: [phaseGraphPlayers.bob, phaseGraphPlayers.cam, phaseGraphPlayers.amy],
      },
    ]);
  });

  it("uses fitted compact Round labels and keeps every saved Round tick", () => {
    const view = getTiebreakerGraphView({
      tiebreaker: "roundsWon",
      series: [makeDenseTiebreakerSeries(13, "roundsWon")],
    });

    expect(view.roundLabels).toHaveLength(13);
    expect(view.roundLabels.filter((label) => label.showLabel).map((label) => label.label)).toEqual(
      ["2", "4", "6", "8", "10", "12"],
    );
    expect(view.width).toBe(360);
  });

  it("deduplicates compact value labels when the Tiebreaker range is one unit", () => {
    const view = getTiebreakerGraphView({
      tiebreaker: "roundsWon",
      series: [
        makeTiebreakerSeries(phaseGraphPlayers.amy, [
          [0, 0, 0],
          [1, 1, 1],
        ]),
      ],
    });

    expect(view.valueLabels).toEqual([
      { value: 1, label: "1 win", y: 24 },
      { value: 0, label: "0 wins", y: 180 },
    ]);
  });
});

function makeTiebreakerSeries(
  player: TiebreakerGraphSeries["player"],
  points: Array<[roundNumber: number, value: number, standingValue: number]>,
): TiebreakerGraphSeries {
  return {
    player,
    points: points.map(([roundNumber, value, standingValue]) => ({
      roundNumber,
      value,
      standingValue,
    })),
  };
}

function makeDenseTiebreakerSeries(
  roundCount: number,
  tiebreaker: GameTiebreaker,
): TiebreakerGraphSeries {
  return {
    player: phaseGraphPlayers.amy,
    points: Array.from({ length: roundCount }, (_, index) => ({
      roundNumber: index,
      value: index,
      standingValue: tiebreaker === "roundsWon" ? index : -index,
    })),
  };
}

function makeRound(roundNumber: number, roundWinnerId: string): Round {
  return {
    gameId: "game-1",
    scorekeeper: "phase10",
    roundNumber,
    roundWinnerId,
    scores: [
      {
        playerId: roundWinnerId,
        currentPhase: 1,
        phaseStatus: "completed",
        score: 0,
      },
    ],
  } as Round;
}
