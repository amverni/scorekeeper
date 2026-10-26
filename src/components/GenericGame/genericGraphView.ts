import type { GenericGraph, PlayerIdentity } from "../../types";
import {
  GRAPH_BOTTOM,
  GRAPH_RIGHT,
  GRAPH_TOP,
  GRAPH_WIDTH,
  getGraphPlayerColor,
  getRoundLabelStride,
  getRoundNumbers,
  getRoundXByNumber,
  roundToTwoDecimals,
  shouldShowRoundLabel,
} from "../Standings/graphLayout";

const GRAPH_HEIGHT = 224;
const AXIS_WIDTH = 96;
const CHART_HEIGHT = GRAPH_HEIGHT - GRAPH_TOP - GRAPH_BOTTOM;
const compactValue = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumSignificantDigits: 2,
});

export function getGenericGraphView(graph: GenericGraph) {
  const roundNumbers = getRoundNumbers(graph.series);
  const stride = getRoundLabelStride(roundNumbers.length, GRAPH_WIDTH - AXIS_WIDTH - GRAPH_RIGHT);
  const roundX = getRoundXByNumber(roundNumbers, {
    left: AXIS_WIDTH,
    right: GRAPH_RIGHT,
    width: GRAPH_WIDTH,
  });
  let min = 0;
  let max = 0;
  for (const series of graph.series) {
    for (const point of series.points) {
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    }
  }
  const getY = (value: number) => {
    if (min === max) return GRAPH_TOP + CHART_HEIGHT / 2;
    const offset = graph.direction === "high" ? max - value : value - min;
    return roundToTwoDecimals(GRAPH_TOP + (offset / (max - min)) * CHART_HEIGHT);
  };
  const series = graph.series.map(({ player, points }) => {
    const linePoints = points.map((point) => ({
      ...point,
      x: roundX.get(point.roundNumber) ?? AXIS_WIDTH,
      y: getY(point.value),
    }));
    return {
      player,
      color: getGraphPlayerColor(player),
      linePoints,
      path: linePoints.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" "),
    };
  });
  const groups = new Map<
    string,
    { roundNumber: number; value: number; x: number; y: number; players: PlayerIdentity[] }
  >();
  for (const entry of series) {
    const latest = entry.linePoints.at(-1);
    if (!latest) continue;
    const key = `${latest.roundNumber}:${latest.value}`;
    const group = groups.get(key);
    if (group) group.players.push(entry.player);
    else groups.set(key, { ...latest, players: [entry.player] });
  }
  const middle = Math.round(min + (max - min) / 2);
  return {
    width: GRAPH_WIDTH,
    height: GRAPH_HEIGHT,
    valueLabelX: AXIS_WIDTH - 12,
    roundLabels: roundNumbers.map((roundNumber, index) => ({
      roundNumber,
      label: roundNumber === 0 ? null : String(roundNumber),
      showLabel: shouldShowRoundLabel(roundNumber, index, roundNumbers.length, stride),
      x: roundX.get(roundNumber) ?? AXIS_WIDTH,
    })),
    valueLabels: [...new Set([min, middle, max])].map((value) => ({
      value,
      label: Math.abs(value) >= 10_000 ? compactValue.format(value) : String(value),
      y: getY(value),
    })),
    series,
    latestEndpointGroups: [...groups.values()],
  };
}
