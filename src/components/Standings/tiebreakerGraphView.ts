import type {
  GameTiebreaker,
  PlayerId,
  PlayerIdentity,
  Round,
  TiebreakerGraphPoint,
  TiebreakerGraphSeries,
} from "../../types";
import {
  formatTiebreakerValue,
  isLowerBetterTiebreaker,
  toTiebreakerStandingValue,
} from "../../utils";
import {
  GRAPH_BOTTOM,
  GRAPH_LEFT,
  GRAPH_TOP,
  GRAPH_WIDTH,
  getGraphPlayerColor,
  getRoundLabelStride,
  getRoundNumbers,
  getRoundXByNumber,
  roundToTwoDecimals,
  shouldShowRoundLabel,
} from "./graphLayout";

const GRAPH_HEIGHT = 224;
const CHART_HEIGHT = GRAPH_HEIGHT - GRAPH_TOP - GRAPH_BOTTOM;

export interface TiebreakerGraphViewInput {
  series: readonly TiebreakerGraphSeries[];
  tiebreaker: GameTiebreaker;
  rounds?: readonly Round[];
  endpointPlayerOrder?: readonly PlayerId[];
}

export interface TiebreakerGraphView {
  width: number;
  height: number;
  roundLabels: TiebreakerRoundLabel[];
  valueLabels: TiebreakerValueLabel[];
  series: TiebreakerGraphViewSeries[];
  latestEndpointGroups: TiebreakerEndpointGroup[];
}

export interface TiebreakerRoundLabel {
  roundNumber: number;
  label: string | null;
  showLabel: boolean;
  x: number;
}

export interface TiebreakerValueLabel {
  value: number;
  label: string;
  y: number;
}

export interface TiebreakerGraphViewSeries {
  player: PlayerIdentity;
  color: string;
  linePoints: PositionedTiebreakerGraphPoint[];
  path: string;
}

export interface PositionedTiebreakerGraphPoint extends TiebreakerGraphPoint {
  x: number;
  y: number;
}

export interface TiebreakerEndpointGroup {
  key: string;
  label: string;
  x: number;
  y: number;
  players: PlayerIdentity[];
}

export function getTiebreakerGraphView({
  series,
  tiebreaker,
  rounds = [],
  endpointPlayerOrder,
}: TiebreakerGraphViewInput): TiebreakerGraphView {
  const roundNumbers = getRoundNumbers(series);
  const roundLabelStride = getRoundLabelStride(roundNumbers.length);
  const roundXByNumber = getRoundXByNumber(roundNumbers);
  const standingRange = getStandingRange(series);
  const seriesOrder = new Map(
    endpointPlayerOrder
      ? endpointPlayerOrder.map((id, index) => [id, index])
      : series.map((graphSeries, index) => [graphSeries.player.id, index]),
  );
  const mostRecentRoundWin = getMostRecentRoundWinByPlayer(endpointPlayerOrder ? [] : rounds);
  const viewSeries = series.map((graphSeries) => {
    const linePoints = graphSeries.points.map((point) => ({
      ...point,
      x: roundXByNumber.get(point.roundNumber) ?? GRAPH_LEFT,
      y: getY(point.standingValue, standingRange),
    }));

    return {
      player: graphSeries.player,
      color: getGraphPlayerColor(graphSeries.player),
      linePoints,
      path: linePoints.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" "),
    };
  });

  return {
    width: GRAPH_WIDTH,
    height: GRAPH_HEIGHT,
    roundLabels: roundNumbers.map((roundNumber, index) => ({
      roundNumber,
      label: roundNumber === 0 ? null : String(roundNumber),
      showLabel: shouldShowRoundLabel(roundNumber, index, roundNumbers.length, roundLabelStride),
      x: roundXByNumber.get(roundNumber) ?? GRAPH_LEFT,
    })),
    valueLabels: getValueLabels(standingRange, tiebreaker),
    series: viewSeries,
    latestEndpointGroups: getLatestEndpointGroups(
      viewSeries,
      tiebreaker,
      mostRecentRoundWin,
      seriesOrder,
    ),
  };
}

interface StandingRange {
  best: number;
  worst: number;
}

function getStandingRange(series: readonly TiebreakerGraphSeries[]): StandingRange {
  const values = series.flatMap((graphSeries) =>
    graphSeries.points.map((point) => point.standingValue),
  );
  if (values.length === 0) return { best: 0, worst: 0 };

  return {
    best: Math.max(...values),
    worst: Math.min(...values),
  };
}

function getY(standingValue: number, range: StandingRange): number {
  if (range.best === range.worst) return GRAPH_TOP + CHART_HEIGHT / 2;

  return roundToTwoDecimals(
    GRAPH_TOP + ((range.best - standingValue) / (range.best - range.worst)) * CHART_HEIGHT,
  );
}

function getValueLabels(range: StandingRange, tiebreaker: GameTiebreaker): TiebreakerValueLabel[] {
  if (range.best === range.worst) {
    const value = getTiebreakerValueFromStandingValue(range.best, tiebreaker);
    return [
      {
        value,
        label: formatTiebreakerValue(value, tiebreaker),
        y: getY(range.best, range),
      },
    ];
  }

  const bestValue = getTiebreakerValueFromStandingValue(range.best, tiebreaker);
  const worstValue = getTiebreakerValueFromStandingValue(range.worst, tiebreaker);
  const midpointValue = Math.round((bestValue + worstValue) / 2);

  return Array.from(new Set([bestValue, midpointValue, worstValue])).map((value) => {
    const standingValue = toTiebreakerStandingValue(value, tiebreaker);
    return {
      value,
      label: formatTiebreakerValue(value, tiebreaker),
      y: getY(standingValue, range),
    };
  });
}

function getTiebreakerValueFromStandingValue(
  standingValue: number,
  tiebreaker: GameTiebreaker,
): number {
  return isLowerBetterTiebreaker(tiebreaker) ? Math.abs(standingValue) : standingValue;
}

function getLatestEndpointGroups(
  series: readonly TiebreakerGraphViewSeries[],
  tiebreaker: GameTiebreaker,
  mostRecentRoundWin: ReadonlyMap<PlayerId, number>,
  seriesOrder: ReadonlyMap<PlayerId, number>,
): TiebreakerEndpointGroup[] {
  const groups = new Map<string, TiebreakerEndpointGroup>();

  for (const graphSeries of series) {
    const latestPoint = graphSeries.linePoints.at(-1);
    if (!latestPoint) continue;

    const key = String(latestPoint.standingValue);
    const group = groups.get(key);
    if (group) {
      group.players.push(graphSeries.player);
    } else {
      groups.set(key, {
        key,
        label: formatTiebreakerValue(latestPoint.value, tiebreaker),
        x: latestPoint.x,
        y: latestPoint.y,
        players: [graphSeries.player],
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      players: group.players
        .slice()
        .sort(
          (a, b) =>
            (mostRecentRoundWin.get(b.id) ?? -1) - (mostRecentRoundWin.get(a.id) ?? -1) ||
            (seriesOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (seriesOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        ),
    }))
    .sort((a, b) => a.y - b.y);
}

function getMostRecentRoundWinByPlayer(rounds: readonly Round[]): ReadonlyMap<PlayerId, number> {
  const mostRecentRoundWin = new Map<PlayerId, number>();
  for (const round of rounds) {
    if (round.roundWinnerId !== null) {
      mostRecentRoundWin.set(round.roundWinnerId, round.roundNumber);
    }
  }
  return mostRecentRoundWin;
}
