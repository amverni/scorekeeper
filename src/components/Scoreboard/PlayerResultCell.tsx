import { Check, type LucideIcon, Minus, Redo, X } from "lucide-react";
import type { PhaseStatus, RoundScore } from "../../types";
import { DealerMarker } from "../ui";

interface PlayerResultCellProps {
  /** RoundScore for the player in this round. Omitted for the ghost row. */
  score?: RoundScore;
  /** Phase number to display; for completed rows == score.currentPhase, for ghost == next phase. */
  phaseNumber: number;
  /** True when this is the dealer's cell for the round. */
  isDealer: boolean;
  /** True when this player won (went out in) this round. */
  isRoundWinner: boolean;
  /** "completed" renders status icon + colored phase; "ghost" renders neutral phase, no icon. */
  variant: "completed" | "ghost";
  removed?: boolean;
  /** Optional extra content rendered below the cell (per-round + running tiebreaker values). */
  extras?: React.ReactNode;
}

const STATUS_COLOR_CLASS: Record<PhaseStatus, string> = {
  completed: "text-[#27500A] dark:text-[#7DD86A]",
  failed: "text-[#A32D2D] dark:text-[#FF8585]",
  skipped: "text-[#CA8A04] dark:text-[#FACC15]",
  satOut: "text-text-secondary",
};

const STATUS_ICON: Record<PhaseStatus, LucideIcon> = {
  completed: Check,
  failed: X,
  skipped: Redo,
  satOut: Minus,
};

export function PlayerResultCell({
  score,
  phaseNumber,
  isDealer,
  isRoundWinner,
  variant,
  removed = false,
  extras,
}: PlayerResultCellProps) {
  const status = score?.phaseStatus;
  const isGhost = variant === "ghost";
  const StatusIcon = status ? STATUS_ICON[status] : null;

  const phaseColor =
    isGhost || removed
      ? "text-text-secondary"
      : (status && STATUS_COLOR_CLASS[status]) || "text-text-primary";

  const iconColor =
    isGhost || removed
      ? "text-text-secondary"
      : (status && STATUS_COLOR_CLASS[status]) || "text-text-secondary";

  return (
    <div className={`relative flex w-full flex-col items-center ${isGhost ? "opacity-55" : ""}`}>
      <div className="scoreboard-entry">
        {isDealer && (
          <DealerMarker
            className={["scoreboard-entry__dealer", isGhost ? "opacity-60" : ""].join(" ")}
          />
        )}
        <span
          className={[
            "scoreboard-entry__value scoreboard-entry__phase relative text-base font-medium leading-none tabular-nums",
            phaseColor,
          ].join(" ")}
        >
          {isRoundWinner && (
            <span
              aria-hidden
              className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 size-5 rounded-full border border-current"
            />
          )}
          {phaseNumber}
        </span>
        {!isGhost && StatusIcon && (
          <span
            aria-hidden
            className={["scoreboard-entry__result leading-none", iconColor].join(" ")}
          >
            <StatusIcon size={14} strokeWidth={2.5} />
          </span>
        )}
      </div>
      {extras}
    </div>
  );
}
