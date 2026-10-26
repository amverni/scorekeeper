import { Check } from "lucide-react";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import { numberCircleClasses } from "../ui";
import { standingsRowClasses } from "./StandingsList";
import type { StandingsDisplayRow } from "./standingsDialogView";

interface StandingsRowProps {
  row: StandingsDisplayRow;
}

const phaseScoreClasses = [
  "inline-flex items-center gap-0.5 font-semibold whitespace-nowrap text-text-primary tabular-nums",
].join(" ");

export function StandingsRow({ row }: StandingsRowProps) {
  const placeClasses = [numberCircleClasses, !row.showPlace && "opacity-0"]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      className={[standingsRowClasses, row.place === null ? "grayscale opacity-45" : ""].join(" ")}
    >
      <span className="sr-only">
        {row.place === null
          ? "Unranked"
          : row.showPlace
            ? `Place ${row.place}`
            : `Tied for place ${row.place}`}
      </span>
      <span className={placeClasses} aria-hidden>
        {row.place}
      </span>
      <PlayerAvatar player={row.player} size={16} variant="icon" />
      <span className="min-w-0 flex-1 truncate font-medium" title={row.player.name}>
        {row.player.name}
      </span>
      <span className={phaseScoreClasses}>
        Ph {row.phaseNumber}
        {row.isFinished && (
          <Check className="size-3.5 shrink-0 text-pt-green-500" aria-label="Finished" />
        )}
      </span>
      <span className="whitespace-nowrap text-text-secondary tabular-nums">
        {row.tiebreakerText}
      </span>
    </li>
  );
}
