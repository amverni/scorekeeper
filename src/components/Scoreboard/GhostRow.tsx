import type { GamePlayerView, PlayerId } from "../../types";
import { PlayerResultCell } from "./PlayerResultCell";

interface GhostRowProps {
  nextRoundNumber: number;
  dealerId: PlayerId | null;
  players: GamePlayerView[];
  onOpenAddRound: () => void;
}

export function GhostRow({ nextRoundNumber, dealerId, players, onOpenAddRound }: GhostRowProps) {
  return (
    <>
      <button
        type="button"
        onClick={onOpenAddRound}
        aria-label={`Add round ${nextRoundNumber}`}
        className="scoreboard-cell scoreboard-cell--sticky-left scoreboard-cell--dashed scoreboard-cell--last-row cursor-pointer text-left"
      >
        <span
          className="inline-flex size-5 items-center justify-center rounded-full border-[1.5px] border-text-secondary/60 text-text-secondary"
          aria-hidden
        >
          <span className="-mt-px text-sm leading-none">+</span>
        </span>
      </button>

      {players.map((player, idx) => {
        const isLast = idx === players.length - 1;
        return (
          <div
            key={player.id}
            className={`scoreboard-cell scoreboard-cell--dashed scoreboard-cell--last-row ${
              isLast ? "scoreboard-cell--last-col" : ""
            }`}
          >
            <PlayerResultCell
              phaseNumber={player.progress.currentPhase}
              isDealer={dealerId === player.id}
              isRoundWinner={false}
              variant="ghost"
            />
          </div>
        );
      })}
    </>
  );
}
