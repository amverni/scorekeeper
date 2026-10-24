import type { GameTiebreaker, PlayerId, Round, TiebreakerGraphSeries } from "../../types";
import { formatTiebreakerValue } from "../../utils";
import { GraphAccessibleTable } from "./GraphAccessibleTable";
import { GraphEndpointAvatarGroup } from "./GraphEndpointAvatarGroup";
import { GraphAxisLabels, GraphRoundAxis, GraphSeriesPaths } from "./GraphPlot";
import { GRAPH_LEFT, graphContentClasses, graphShellClasses, graphSvgClasses } from "./graphLayout";
import { getTiebreakerGraphView } from "./tiebreakerGraphView";

const TIEBREAKER_AXIS_LABEL_X = GRAPH_LEFT - 18;

export interface TiebreakerGraphProps {
  series: readonly TiebreakerGraphSeries[];
  tiebreaker: GameTiebreaker;
  rounds?: readonly Round[];
  endpointPlayerOrder?: readonly PlayerId[];
}

export function TiebreakerGraph({
  series,
  tiebreaker,
  rounds,
  endpointPlayerOrder,
}: TiebreakerGraphProps) {
  const view = getTiebreakerGraphView({ series, tiebreaker, rounds, endpointPlayerOrder });
  const chartStartX = view.roundLabels[0]?.x ?? 0;
  const chartEndX = view.roundLabels.at(-1)?.x ?? view.width;

  if (series.length === 0) {
    return (
      <div className="glass flex h-full items-center justify-center rounded-2xl px-6 text-center text-sm text-text-secondary">
        No Tiebreaker progress to show yet.
      </div>
    );
  }

  return (
    <div className={graphShellClasses}>
      <GraphAccessibleTable
        title="Tiebreaker progress details"
        roundLabels={view.roundLabels}
        series={view.series}
        formatPoint={(point) => formatTiebreakerValue(point.value, tiebreaker)}
      />
      <div className={graphContentClasses}>
        <svg
          role="img"
          aria-label="Tiebreaker progress by round"
          viewBox={`0 0 ${view.width} ${view.height}`}
          preserveAspectRatio="none"
          className={graphSvgClasses}
        >
          {view.valueLabels.map((label) => (
            <line
              key={`${label.value}-${label.y}`}
              x1={chartStartX}
              x2={chartEndX}
              y1={label.y}
              y2={label.y}
              stroke="var(--color-text-secondary)"
              strokeOpacity={0.16}
            />
          ))}

          <GraphSeriesPaths series={view.series} />
          <GraphRoundAxis roundLabels={view.roundLabels} height={view.height} />
        </svg>

        <GraphAxisLabels
          graphWidth={view.width}
          graphHeight={view.height}
          labels={[
            ...view.valueLabels.map((label) => ({
              key: `value-${label.value}-${label.y}`,
              label: label.label,
              x: TIEBREAKER_AXIS_LABEL_X,
              y: label.y,
              anchor: "end" as const,
            })),
            ...view.roundLabels
              .filter((label) => label.showLabel && label.label)
              .map((label) => ({
                key: `round-${label.roundNumber}`,
                label: label.label ?? "",
                x: label.x,
                y: view.height - 14,
                anchor: "middle" as const,
              })),
          ]}
        />

        {view.latestEndpointGroups.map((group) => (
          <GraphEndpointAvatarGroup
            key={group.key}
            label={group.label}
            players={group.players}
            x={group.x}
            y={group.y}
            graphWidth={view.width}
            graphHeight={view.height}
          />
        ))}
      </div>
    </div>
  );
}
