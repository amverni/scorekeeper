import { Description, DialogTitle } from "@headlessui/react";
import { useEffect, useRef } from "react";
import type { PhaseGameEditEffect, PhaseGameEditPreview } from "../../types";
import { Button, Dialog } from "../ui";

function describeEffect(effect: PhaseGameEditEffect) {
  const names = effect.players.map(({ name }) => name).join(", ");
  const round = "afterRoundNumber" in effect ? effect.afterRoundNumber + 1 : null;
  switch (effect.type) {
    case "join":
      return `${names} will join from Round ${round} with zero totals and no phase progress. Earlier Rounds will not be backfilled.`;
    case "withdrawal":
      return `${names} will become unranked and ineligible to win, and will not play or deal from Round ${round}. Saved history stays intact.`;
    case "rejoin":
      return `${names} will rejoin from Round ${round}, resuming existing totals and phase progress. Missed Rounds add no scores or penalties.`;
    case "phaseRemoval": {
      const resolved = effect.resolvedPhaseNumbers;
      const attempted = effect.phaseNumbers.filter((number) => !resolved.includes(number));
      const history = [
        resolved.length > 0 && `Phases ${resolved.join(", ")} have recorded resolutions`,
        attempted.length > 0 &&
          `Phases ${attempted.join(", ")} have saved entries but no resolutions`,
      ]
        .filter(Boolean)
        .join("; ");
      return `${history}. Their entries will be excluded from phase progress and every Tiebreaker, including recorded Round wins. Saved Rounds and original values stay intact; no replacement winner is chosen.`;
    }
    case "finished":
      return `${names} will become Finished Players under the remaining required Phases. Finishing Places and counted totals will be recalculated.`;
  }
}

export function GameEditReviewDialog({
  preview,
  isPending,
  onEdit,
  onSave,
}: {
  preview: PhaseGameEditPreview;
  isPending: boolean;
  onEdit: () => void;
  onSave: (finishChoice?: "continue" | "finish") => void;
}) {
  const editRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isPending) return;
    // Headless UI skips initial focus on touch; explicitly focus the safe action.
    const frame = requestAnimationFrame(() => editRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isPending]);
  const { completion } = preview;

  return (
    <Dialog
      open
      onClose={onEdit}
      dismissible={!isPending}
      showCloseButton={false}
      draggable={false}
      className="dialog-panel-confirmation"
      header={<DialogTitle className="text-lg font-semibold">Review game changes</DialogTitle>}
      actions={
        <div className="flex flex-wrap justify-end gap-3" aria-busy={isPending}>
          <Button
            ref={editRef}
            type="button"
            autoFocus
            disabled={isPending}
            onClick={onEdit}
            className="min-h-11 px-5"
          >
            Keep editing
          </Button>
          {completion.type === "choice" ? (
            <>
              <Button
                type="button"
                disabled={isPending}
                onClick={() => onSave("continue")}
                className="min-h-11 px-5"
              >
                Keep playing
              </Button>
              <Button
                type="button"
                variant="ready"
                disabled={isPending}
                onClick={() => onSave("finish")}
                className="min-h-11 px-5"
              >
                Finish
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ready"
              disabled={isPending}
              onClick={() => onSave()}
              className="min-h-11 px-5"
            >
              {completion.type === "automatic" ? "Save and finish game" : "Save changes"}
            </Button>
          )}
        </div>
      }
    >
      <Description as="div" className="space-y-3 wrap-anywhere text-text-secondary">
        {preview.effects.map((effect) => (
          <p key={effect.type}>{describeEffect(effect)}</p>
        ))}
        {completion.type === "choice" && (
          <p>
            {completion.winner.name} wins. Save these changes and keep playing for further Finishing
            Places, or finish the Game at Round {completion.gameEndingRound}.
          </p>
        )}
        {completion.type === "automatic" && (
          <p>
            Saving will finish the Game at Round {completion.gameEndingRound}.{" "}
            {completion.winner.name} wins.
          </p>
        )}
      </Description>
    </Dialog>
  );
}
