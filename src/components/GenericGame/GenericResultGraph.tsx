import type { GenericGraph } from "../../types";
import { GraphAccessibleTable } from "../Standings/GraphAccessibleTable";
import { GraphEndpointAvatarGroup } from "../Standings/GraphEndpointAvatarGroup";
import { GraphAxisLabels, GraphRoundAxis, GraphSeriesPaths } from "../Standings/GraphPlot";
import { graphContentClasses, graphShellClasses, graphSvgClasses } from "../Standings/graphLayout";
import { getGenericGraphView } from "./genericGraphView";

export function GenericResultGraph({ graph }: { graph: GenericGraph }) {
  const view = getGenericGraphView(graph);
  const chartStart = view.roundLabels[0]?.x ?? 0;
  const chartEnd = view.roundLabels.at(-1)?.x ?? view.width;

  return (
    <div className={graphShellClasses}>
      <GraphAccessibleTable
        title={`${graph.metric} progress details`}
        roundLabels={view.roundLabels}
        series={view.series}
        formatPoint={(point) => String(point.value)}
      />
      <div className={graphContentClasses}>
        <svg
          role="img"
          aria-label={`${graph.metric} progress by round`}
          viewBox={`0 0 ${view.width} ${view.height}`}
          preserveAspectRatio="none"
          className={graphSvgClasses}
        >
          {view.valueLabels.map((label) => (
            <line
              key={label.value}
              x1={chartStart}
              x2={chartEnd}
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
              key: `value-${label.value}`,
              label: label.label,
              x: view.valueLabelX,
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
            key={`${group.roundNumber}:${group.value}`}
            label={String(group.value)}
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
