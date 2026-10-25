import type { GameRoundView, GameTiebreaker, PlayerIdentity } from "../../types";
import { formatTiebreakerValue } from "../../utils";
import { PlayerResultCell } from "./PlayerResultCell";

interface RoundRowProps {
  round: GameRoundView;
  players: PlayerIdentity[];
  tiebreaker: GameTiebreaker;
  isExpanded: boolean;
  isLastRow: boolean;
  onToggle: () => void;
}

export function RoundRow({
  round: view,
  players,
  tiebreaker,
  isExpanded,
  isLastRow,
  onToggle,
}: RoundRowProps) {
  const { source: round, dealerId } = view;

  const lastColClass = (idx: number) =>
    idx === players.length - 1 ? "scoreboard-cell--last-col" : "";
  const lastRowClass = isLastRow ? "scoreboard-cell--last-row" : "";

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`Round ${round.roundNumber}${!view.counted ? ", not counted" : ""}${isExpanded ? ", expanded" : ""}`}
        className={[
          "scoreboard-cell scoreboard-cell--sticky-left scoreboard-cell--anchor-top cursor-pointer text-left",
          lastRowClass,
          !view.counted ? "opacity-45" : "",
        ].join(" ")}
      >
        <span className="text-base font-medium leading-none tabular-nums text-text-secondary">
          {round.roundNumber}
        </span>
      </button>

      {players.map((player, idx) => {
        const entry = view.scores[idx];
        const score = entry.source;
        const phaseNumber = entry.phaseNumber ?? 0;

        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: keyboard users toggle via the sibling round-number <button> with aria-expanded; this cell is a mouse/touch-only enlarged click target.
          <div
            key={player.id}
            onClick={onToggle}
            role="presentation"
            className={[
              "scoreboard-cell scoreboard-cell--anchor-top cursor-pointer",
              lastColClass(idx),
              lastRowClass,
              score && !entry.counted ? "opacity-45" : "",
            ].join(" ")}
          >
            {score && (
              <>
                {!entry.counted && <span className="sr-only">Retained entry, not counted. </span>}
                <PlayerResultCell
                  score={score}
                  phaseNumber={phaseNumber}
                  isDealer={dealerId === player.id}
                  isRoundWinner={round.roundWinnerId === player.id}
                  variant="completed"
                  extras={
                    <div
                      className={`scoreboard-extras ${isExpanded ? "scoreboard-extras--open" : ""}`}
                    >
                      <div>
                        <span className="text-[14px] leading-none text-text-secondary tabular-nums">
                          {formatTiebreakerValue(entry.sourceTiebreakerValue, tiebreaker)}
                        </span>
                        <span
                          aria-hidden
                          className="my-0.5 h-px w-3/4 shrink-0 bg-text-secondary/70"
                        />
                        <span className="text-[12px] leading-none text-text-secondary/70 tabular-nums">
                          {formatTiebreakerValue(entry.runningTiebreakerTotal, tiebreaker)}
                        </span>
                      </div>
                    </div>
                  }
                />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
