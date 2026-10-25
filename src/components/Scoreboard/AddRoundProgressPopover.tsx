import { Check, Minus, Redo, Trophy, X } from "lucide-react";
import type { GameTiebreaker, PlayerId, PlayerIdentity } from "../../types";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import { Popover, PopoverButton, PopoverPanel } from "../ui/Popover/Popover";
import { type AddRoundDraft, getDraftProgress, getScoreEntryCompletion } from "./addRoundDraft";

interface AddRoundProgressPopoverProps {
  players: PlayerIdentity[];
  draft: AddRoundDraft;
  tiebreaker: GameTiebreaker;
  countedPlayerIds?: readonly PlayerId[];
}

export function AddRoundProgressPopover({
  players,
  draft,
  tiebreaker,
  countedPlayerIds,
}: AddRoundProgressPopoverProps) {
  const progress = getDraftProgress(draft, tiebreaker, countedPlayerIds);
  const { completed, total, winnerComplete, winnerRequirement, ready } = progress;
  const { players: playerDrafts, roundWinnerId } = draft;
  const fraction = total === 0 ? 0 : completed / total;

  return (
    <Popover as="div" className="relative flex flex-1 items-center">
      <PopoverButton
        as="button"
        aria-label={`Round progress: ${completed} of ${total} required entries complete`}
        className="glass relative h-6 w-full overflow-hidden rounded-full cursor-pointer"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-pt-green-500 transition-[width] duration-300 ease-out"
          style={{ width: `${fraction * 100}%` }}
        />
      </PopoverButton>
      <PopoverPanel portal anchor={{ to: "top", gap: 8 }} className="z-50 p-3 max-w-[18rem] w-max">
        <p className="text-sm font-semibold text-text-primary">
          {completed} of {total}
        </p>

        {players.length > 0 && (
          <ul className="mt-2 flex min-w-44 flex-col gap-1.5">
            {winnerRequirement === "required" && (
              <li className="grid grid-cols-[auto_1fr_1rem] items-center gap-2 text-sm">
                <Trophy className="size-3.5 text-pt-yellow-500" aria-hidden />
                <span className="min-w-0">
                  <span className="block">Round Winner</span>
                  {!winnerComplete && (
                    <span className="block text-xs text-text-secondary">
                      Mark a Round Winner to save.
                    </span>
                  )}
                </span>
                <span className="sr-only">{winnerComplete ? " selected" : " needed"}</span>
                {winnerComplete && <Check className="size-4 text-pt-green-500" aria-hidden />}
              </li>
            )}
            {players.map((p) => {
              const playerDraft = playerDrafts.find((ps) => ps.playerId === p.id);
              const result = playerDraft?.result;
              const completion = playerDraft
                ? getScoreEntryCompletion({ player: playerDraft, tiebreaker, roundWinnerId })
                : { complete: false, reason: "Select a Round Result." };
              return (
                <li
                  key={p.id}
                  data-progress-player-row
                  className="grid grid-cols-[auto_1fr_1rem] items-center gap-2 text-sm"
                >
                  <span data-player-avatar>
                    <PlayerAvatar player={p} size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    {!completion.complete && completion.reason && (
                      <span className="block truncate text-xs text-text-secondary">
                        {completion.reason}
                      </span>
                    )}
                  </span>
                  <span className="sr-only">
                    {completion.complete ? " score entered" : " score needed"}
                  </span>
                  <span className="inline-flex justify-end">
                    {completion.complete && result === "completed" && (
                      <Check
                        data-progress-player-check
                        className="size-4 text-pt-green-500"
                        aria-hidden
                      />
                    )}
                    {completion.complete && result === "failed" && (
                      <X
                        data-progress-player-check
                        className="size-4 text-pt-red-500"
                        aria-hidden
                      />
                    )}
                    {completion.complete && result === "skipped" && (
                      <Redo
                        data-progress-player-check
                        className="size-4 text-pt-yellow-500"
                        aria-hidden
                      />
                    )}
                    {completion.complete && result === "satOut" && (
                      <Minus
                        data-progress-player-check
                        className="size-4 text-pt-blue-500 rotate-180"
                        aria-hidden
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {ready && <p className="mt-2 text-sm text-text-secondary">Ready to save.</p>}
      </PopoverPanel>
    </Popover>
  );
}
