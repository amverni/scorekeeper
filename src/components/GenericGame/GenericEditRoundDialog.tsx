import { DialogTitle } from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { genericRoundEditorOptions } from "../../data/hooks/useGenericGames";
import type { GameId, GenericRoundEditor, GenericRoundId, PlayerId } from "../../types";
import { Dialog, InlineError } from "../ui";
import { GenericAddRoundDialog } from "./GenericAddRoundDialog";

interface GenericEditRoundDialogProps {
  gameId: GameId;
  roundId: GenericRoundId;
  focusPlayerId?: PlayerId;
  onClose: () => void;
}

export function GenericEditRoundDialog({
  gameId,
  roundId,
  focusPlayerId,
  onClose,
}: GenericEditRoundDialogProps) {
  const {
    data: editor,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(genericRoundEditorOptions(gameId, roundId));
  if (!editor || isError) {
    return (
      <Dialog open onClose={onClose} header={<DialogTitle>Edit Round</DialogTitle>}>
        {isPending ? (
          <output>Loading Round...</output>
        ) : (
          <InlineError
            message={error?.message ?? "Unable to load Round."}
            onRetry={() => refetch()}
          />
        )}
      </Dialog>
    );
  }
  return (
    <LoadedRoundEditor {...{ gameId, roundId, focusPlayerId, onClose }} initialEditor={editor} />
  );
}

function LoadedRoundEditor({
  gameId,
  focusPlayerId,
  onClose,
  initialEditor,
}: GenericEditRoundDialogProps & { initialEditor: GenericRoundEditor }) {
  // Keep the history version paired with the draft even if another query refreshes.
  const [editor] = useState(initialEditor);
  return (
    <GenericAddRoundDialog
      open
      onClose={onClose}
      gameId={gameId}
      players={editor.players}
      mode={editor.round.mode}
      tiebreakerEnabled={editor.tiebreakerEnabled}
      editor={editor}
      focusPlayerId={focusPlayerId}
    />
  );
}
