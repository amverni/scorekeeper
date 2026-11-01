import type { ReactNode } from "react";

export function ScorecardRow({
  as = "div",
  roundNumber,
  children,
}: {
  as?: "div" | "tr";
  roundNumber: number;
  children: ReactNode;
}) {
  const Row = as;
  const Space = as === "tr" ? "td" : "div";

  return (
    <Row data-scorecard-round={roundNumber} className="scorecard-round">
      {children}
      {(["left", "right"] as const).map((side) => (
        <Space
          key={side}
          role="presentation"
          data-scorecard-action={side}
          className={["scorecard-action-space", `scorecard-action-space--${side}`].join(" ")}
        />
      ))}
    </Row>
  );
}
