import { Pencil } from "lucide-react";
import type { GameRoundView, GameTiebreaker, PlayerId, PlayerIdentity } from "../../types";
import { formatTiebreakerValue } from "../../utils";
import { Button } from "../ui";
import { PlayerResultCell } from "./PlayerResultCell";

interface RoundRowProps {
  round: GameRoundView;
  players: PlayerIdentity[];
  tiebreaker: GameTiebreaker;
  isExpanded: boolean;
  isLastRow: boolean;
  onToggle: () => void;
  onEdit?: (playerId?: PlayerId) => void;
}

export function RoundRow({
  round: view,
  players,
  tiebreaker,
  isExpanded,
  isLastRow,
  onToggle,
  onEdit,
}: RoundRowProps) {
  const { source: round, dealerId } = view;

  const lastColClass = (idx: number) =>
    idx === players.length - 1 ? "scoreboard-cell--last-col" : "";
  const lastRowClass = isLastRow ? "scoreboard-cell--last-row" : "";

  return (
    <>
      <div
        className={[
          "scoreboard-cell scoreboard-cell--sticky-left scoreboard-cell--anchor-top",
          lastRowClass,
        ].join(" ")}
      >
        <button
          type="button"
          data-hold-round={onEdit ? round.roundNumber : undefined}
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={`Round ${round.roundNumber}${!view.counted ? ", not counted" : ""}${isExpanded ? ", expanded" : ""}`}
          className={[
            "-mx-0.5 -mt-3.5 -mb-[calc(0.625rem+1px)] flex min-h-11 self-stretch cursor-pointer items-start justify-center pt-3.5 pb-2.5",
            !view.counted ? "opacity-45" : "",
          ].join(" ")}
        >
          <span className="text-base font-medium leading-none tabular-nums text-text-secondary">
            {round.roundNumber}
          </span>
        </button>
        {isExpanded && onEdit && (
          <Button
            type="button"
            aria-label={`Edit Round ${round.roundNumber}`}
            className="mt-2 min-h-11 w-8"
            onClick={() => onEdit()}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      {players.map((player, idx) => {
        const entry = view.scores[idx];
        const score = entry.source;
        const phaseNumber = entry.phaseNumber ?? 0;

        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: keyboard users toggle via the sibling round-number <button> with aria-expanded; this cell is a mouse/touch-only enlarged click target.
          <div
            key={player.id}
            data-hold-round={onEdit && score ? round.roundNumber : undefined}
            data-hold-player={player.id}
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
                        {isExpanded && onEdit && (
                          <Button
                            type="button"
                            aria-label={`Edit Round ${round.roundNumber} for ${player.name}`}
                            className="mt-1 min-h-11 min-w-11"
                            onClick={(event) => {
                              event.stopPropagation();
                              onEdit(player.id);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                        )}
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
