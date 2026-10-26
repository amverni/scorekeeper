import { DialogTitle } from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { genericRoundEditorOptions, useDeleteGenericRound } from "../../data/hooks/useGenericGames";
import { phaseRoundEditorOptions, useDeletePhaseRound } from "../../data/hooks/useRounds";
import type { GameId, GenericRoundId, PhaseRoundEditor } from "../../types";
import { DeleteRoundDialog, Dialog, InlineError } from "../ui";

export function GenericScorecardRoundDeletion({
  gameId,
  roundId,
  onClose,
}: {
  gameId: GameId;
  roundId: GenericRoundId;
  onClose: () => void;
}) {
  const query = useQuery(genericRoundEditorOptions(gameId, roundId));
  const deletion = useDeleteGenericRound();
  const editor = query.data;
  return editor ? (
    <LoadedDeletion
      roundNumber={editor.round.roundNumber}
      onClose={onClose}
      remove={() =>
        deletion.mutateAsync({ gameId, roundId: editor.round.id, version: editor.version })
      }
    />
  ) : (
    <DeletionLoading {...{ query, onClose }} />
  );
}

export function PhaseScorecardRoundDeletion({
  gameId,
  roundNumber,
  expectedVersion,
  onClose,
  onGameCompleted,
}: {
  gameId: GameId;
  roundNumber: number;
  expectedVersion: string;
  onClose: () => void;
  onGameCompleted?: () => void;
}) {
  const query = useQuery(phaseRoundEditorOptions(gameId, roundNumber));
  const editor = query.data;
  return editor ? (
    <LoadedPhaseDeletion
      {...{ initialEditor: editor, expectedVersion, onClose, onGameCompleted }}
    />
  ) : (
    <DeletionLoading {...{ query, onClose }} />
  );
}

function LoadedPhaseDeletion({
  initialEditor,
  expectedVersion,
  onClose,
  onGameCompleted,
}: {
  initialEditor: PhaseRoundEditor;
  expectedVersion: string;
  onClose: () => void;
  onGameCompleted?: () => void;
}) {
  const [editor] = useState(initialEditor);
  const deletion = useDeletePhaseRound();
  if (editor.version !== expectedVersion) {
    return (
      <Dialog open onClose={onClose} header={<DialogTitle>Delete round</DialogTitle>}>
        <InlineError message="Game history changed. Close and reload the Game before deleting a Round." />
      </Dialog>
    );
  }
  return (
    <LoadedDeletion
      roundNumber={editor.round.roundNumber}
      onClose={onClose}
      remove={async () => {
        const result = await deletion.mutateAsync({
          gameId: editor.game.id,
          roundId: editor.round.id,
          version: editor.version,
        });
        if (result.outcome === "gameCompleted") onGameCompleted?.();
      }}
    />
  );
}

function DeletionLoading({
  query,
  onClose,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} header={<DialogTitle>Delete round</DialogTitle>}>
      {query.isPending ? (
        <output>Loading Round...</output>
      ) : (
        <InlineError
          message={query.error?.message ?? "Unable to load Round."}
          onRetry={() => query.refetch()}
        />
      )}
    </Dialog>
  );
}

function LoadedDeletion({
  roundNumber,
  remove,
  onClose,
}: {
  roundNumber: number;
  remove: () => Promise<unknown>;
  onClose: () => void;
}) {
  // Keep the command's identity and version paired with the original confirmation.
  const [deleteSnapshot] = useState(() => remove);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  return (
    <DeleteRoundDialog
      open
      roundNumber={roundNumber}
      isPending={isPending}
      error={error}
      onCancel={() => {
        if (!submitting.current) onClose();
      }}
      onDelete={async () => {
        if (submitting.current) return;
        submitting.current = true;
        setIsPending(true);
        setError(null);
        try {
          await deleteSnapshot();
          onClose();
        } catch (error) {
          setError(error instanceof Error ? error.message : "Unable to delete Round.");
        } finally {
          submitting.current = false;
          setIsPending(false);
        }
      }}
    />
  );
}
