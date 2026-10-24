import type { GamePlayerView, PlayerId } from "../../types";
import { ScoreboardPlayerName } from "./ScoreboardPlayerName";

interface ScoreboardHeaderProps {
  players: GamePlayerView[];
  namesExpanded: boolean;
  onToggleNames: () => void;
  upcomingDealerId: PlayerId | null;
}

export function ScoreboardHeader({
  players,
  upcomingDealerId,
  namesExpanded,
  onToggleNames,
}: ScoreboardHeaderProps) {
  return (
    <>
      {/* Top-left empty corner cell */}
      <div className="scoreboard-cell scoreboard-cell--sticky-corner" aria-hidden />
      {players.map((player, idx) => {
        const isLast = idx === players.length - 1;
        const isUpcomingDealer = player.id === upcomingDealerId;
        return (
          <div
            key={player.id}
            className={[
              "scoreboard-cell scoreboard-cell--sticky-top",
              isLast ? "scoreboard-cell--last-col" : "",
              isUpcomingDealer ? "scoreboard-cell--upcoming-dealer" : "",
            ].join(" ")}
          >
            {isUpcomingDealer && (
              <span className="sr-only">Upcoming Round Dealer: {player.name}</span>
            )}
            <div className="flex flex-col items-center gap-1">
              <ScoreboardPlayerName
                player={player}
                expanded={namesExpanded}
                onToggle={onToggleNames}
              />
              <span className="text-2xl font-medium leading-none tabular-nums text-text-primary">
                {player.progress.currentPhase}
              </span>
              <span className="text-sm leading-none text-text-secondary tabular-nums">
                {player.formattedTiebreaker}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}
