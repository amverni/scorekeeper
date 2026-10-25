import { useRef } from "react";
import { useFinishChoice } from "../../data/hooks/useGames";
import type { GameReadModel } from "../../types";
import { Button, ConfirmationDialog, InlineError } from "../ui";

interface FirstFinisherDialogProps {
  view: GameReadModel;
  ready: boolean;
  onGameCompleted?: () => void;
}

export function FirstFinisherDialog({ view, ready, onGameCompleted }: FirstFinisherDialogProps) {
  const mutation = useFinishChoice(view.game.id);
  const started = useRef(false);
  const finishing = useRef(false);
  const pending = view.pendingFinishChoice;
  const choose = (choice: "continue" | "finish") => {
    if (started.current || !pending) return;
    started.current = true;
    finishing.current = true;
    mutation.mutate(
      { choice, token: pending.token },
      {
        onError: () => {
          finishing.current = false;
        },
        onSettled: () => {
          started.current = false;
        },
      },
    );
  };
  return (
    <ConfirmationDialog
      open={ready && pending !== null}
      title="Finish Game"
      message={`${view.standings.gameWinner?.player.name ?? ""} wins. Do others want to keep playing?`}
      dismissible={false}
      onClose={() => {}}
      afterLeave={() => {
        if (finishing.current && view.game.status === "completed") {
          onGameCompleted?.();
        }
        finishing.current = false;
      }}
      actions={
        <div className="flex flex-wrap justify-end gap-3" aria-busy={mutation.isPending}>
          <Button
            type="button"
            autoFocus
            disabled={mutation.isPending}
            className="min-h-11 px-5"
            onClick={() => choose("continue")}
          >
            Keep playing
          </Button>
          <Button
            type="button"
            variant="ready"
            disabled={mutation.isPending}
            className="min-h-11 px-5"
            onClick={() => choose("finish")}
          >
            Finish
          </Button>
        </div>
      }
    >
      {mutation.error && (
        <InlineError message={`Couldn't save choice: ${mutation.error.message} Try again.`} />
      )}
    </ConfirmationDialog>
  );
}
