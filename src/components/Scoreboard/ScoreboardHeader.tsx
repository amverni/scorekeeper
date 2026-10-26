import type { GamePlayerView, PlayerId } from "../../types";
import { ScoreboardPlayerName } from "./ScoreboardPlayerName";

interface ScoreboardHeaderProps {
  players: GamePlayerView[];
  namesExpanded: boolean;
  onToggleNames: () => void;
  upcomingDealerId: PlayerId | null;
  completed: boolean;
}

export function ScoreboardHeader({
  players,
  upcomingDealerId,
  namesExpanded,
  onToggleNames,
  completed,
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
              player.place === null ? "opacity-45" : "",
            ].join(" ")}
          >
            {isUpcomingDealer && (
              <span className="sr-only">Upcoming Round Dealer: {player.name}</span>
            )}
            <div
              className={[
                "flex flex-col items-center gap-1",
                player.place === null ? "grayscale" : "",
              ].join(" ")}
            >
              <ScoreboardPlayerName
                player={player}
                expanded={namesExpanded}
                onToggle={onToggleNames}
              />
              <span className="text-2xl font-medium leading-none tabular-nums text-text-primary">
                <span className="sr-only">
                  {player.place === null
                    ? "Unranked"
                    : completed || player.finishingPlace !== null
                      ? `Place ${player.place}`
                      : `Current Phase ${player.progress.currentPhase}`}
                </span>
                <span aria-hidden>
                  {player.place === null
                    ? "\u2014"
                    : completed || player.finishingPlace !== null
                      ? formatPlace(player.place)
                      : player.progress.currentPhase}
                </span>
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

function formatPlace(place: number): string {
  const lastTwo = place % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[place % 10] ?? "th");
  return `${place}${suffix}`;
}
