import type { PhaseGraphPoint, PhaseGraphSeries, PlayerIdentity, StandingsRow } from "../../types";
import {
  GRAPH_BOTTOM,
  GRAPH_RIGHT,
  GRAPH_TOP,
  GRAPH_WIDTH,
  getGraphPlayerColor,
  getRoundLabelStride,
  getRoundNumbers,
  getRoundXByNumber,
  shouldShowRoundLabel,
} from "./graphLayout";

const PHASE_SPACING = 52;
const MAX_GRAPH_HEIGHT = 320;
const PHASE_GRAPH_LEFT = 40;
const PHASE_CHART_WIDTH = GRAPH_WIDTH - PHASE_GRAPH_LEFT - GRAPH_RIGHT;
const PHASE_GRAPH_HORIZONTAL_LAYOUT = {
  left: PHASE_GRAPH_LEFT,
  right: GRAPH_RIGHT,
  width: GRAPH_WIDTH,
};

export interface PhaseGraphViewInput {
  series: readonly PhaseGraphSeries[];
  totalPhases: number;
  rows?: readonly StandingsRow[];
}

export interface PhaseGraphView {
  width: number;
  height: number;
  roundLabels: RoundLabel[];
  phaseLabels: PhaseLabel[];
  series: PhaseGraphViewSeries[];
  latestEndpointGroups: LatestPhaseEndpointGroup[];
}

export interface RoundLabel {
  roundNumber: number;
  label: string | null;
  showLabel: boolean;
  x: number;
}

export interface PhaseLabel {
  value: number;
  label: string | null;
  isFinished: boolean;
  y: number;
}

export interface PhaseGraphViewSeries {
  player: PlayerIdentity;
  color: string;
  linePoints: PositionedPhaseGraphPoint[];
  path: string;
}

export interface PositionedPhaseGraphPoint extends PhaseGraphPoint {
  x: number;
  y: number;
}

export interface LatestPhaseEndpointGroup {
  key: string;
  label: string;
  x: number;
  y: number;
  players: PlayerIdentity[];
}

export function getPhaseGraphView({
  series,
  totalPhases,
  rows = [],
}: PhaseGraphViewInput): PhaseGraphView {
  const maxStandingValue = totalPhases + 1;
  const phaseSpacing = getPhaseSpacing(totalPhases);
  const roundNumbers = getRoundNumbers(series);
  const roundLabelStride = getRoundLabelStride(roundNumbers.length, PHASE_CHART_WIDTH);
  const roundXByNumber = getRoundXByNumber(roundNumbers, PHASE_GRAPH_HORIZONTAL_LAYOUT);
  const height = GRAPH_TOP + (maxStandingValue - 1) * phaseSpacing + GRAPH_BOTTOM;
  const rowOrder = new Map(rows.map((row, index) => [row.player.id, index]));
  const viewSeries = series.map((graphSeries) => {
    const linePoints = graphSeries.points.map((point) => ({
      ...point,
      x: roundXByNumber.get(point.roundNumber) ?? PHASE_GRAPH_LEFT,
      y: getY(point.standingValue, maxStandingValue, phaseSpacing),
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
    height,
    roundLabels: roundNumbers.map((roundNumber, index) => ({
      roundNumber,
      label: roundNumber === 0 ? null : String(roundNumber),
      showLabel: shouldShowRoundLabel(roundNumber, index, roundNumbers.length, roundLabelStride),
      x: roundXByNumber.get(roundNumber) ?? PHASE_GRAPH_LEFT,
    })),
    phaseLabels: Array.from({ length: maxStandingValue }, (_, index) => {
      const value = maxStandingValue - index;
      return {
        value,
        label: value > totalPhases ? null : String(value),
        isFinished: value > totalPhases,
        y: getY(value, maxStandingValue, phaseSpacing),
      };
    }),
    series: viewSeries,
    latestEndpointGroups: getLatestEndpointGroups(viewSeries, rowOrder),
  };
}

function getY(standingValue: number, maxStandingValue: number, phaseSpacing: number): number {
  return GRAPH_TOP + (maxStandingValue - standingValue) * phaseSpacing;
}

function getPhaseSpacing(totalPhases: number): number {
  const phaseSteps = Math.max(totalPhases, 1);
  const maxSpacing = Math.floor((MAX_GRAPH_HEIGHT - GRAPH_TOP - GRAPH_BOTTOM) / phaseSteps);
  return Math.min(PHASE_SPACING, maxSpacing);
}

function getLatestEndpointGroups(
  series: readonly PhaseGraphViewSeries[],
  rowOrder: ReadonlyMap<string, number>,
): LatestPhaseEndpointGroup[] {
  const groups = new Map<string, LatestPhaseEndpointGroup>();

  for (const graphSeries of series) {
    const latestPoint = graphSeries.linePoints.at(-1);
    if (!latestPoint) continue;

    const key = `${latestPoint.roundNumber}:${latestPoint.standingValue}`;
    const group = groups.get(key);
    if (group) {
      group.players.push(graphSeries.player);
    } else {
      groups.set(key, {
        key,
        label: formatPhaseProgressLabel(latestPoint, "lower"),
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
            (rowOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (rowOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        ),
    }))
    .sort((a, b) => a.y - b.y);
}

type PhaseProgressLabelCase = "lower" | "sentence";

export function formatPhaseProgressLabel(
  point: Pick<PhaseGraphPoint, "currentPhase" | "isFinished">,
  labelCase: PhaseProgressLabelCase,
): string {
  const label = point.isFinished
    ? `finished phase ${point.currentPhase}`
    : `phase ${point.currentPhase}`;
  return labelCase === "sentence" ? `${label[0]?.toUpperCase() ?? ""}${label.slice(1)}` : label;
}
