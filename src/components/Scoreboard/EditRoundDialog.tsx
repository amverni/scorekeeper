import { DialogTitle } from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { phaseRoundEditorOptions } from "../../data/hooks/useRounds";
import type { GameId, PhaseRoundEditor, PlayerId } from "../../types";
import { Dialog, InlineError } from "../ui";
import { AddRoundDialog } from "./AddRoundDialog";
import { createEditRoundDraft } from "./addRoundDraft";
import { useAddRoundDraft } from "./useAddRoundDraft";

interface EditRoundDialogProps {
  gameId: GameId;
  roundNumber: number;
  focusPlayerId?: PlayerId;
  open: boolean;
  onClose: (open: boolean) => void;
  afterLeave: () => void;
  onGameCompleted?: () => void;
}

export function EditRoundDialog(props: EditRoundDialogProps) {
  const query = useQuery(phaseRoundEditorOptions(props.gameId, props.roundNumber));
  if (!query.data) {
    return (
      <Dialog
        open={props.open}
        onClose={props.onClose}
        afterLeave={props.afterLeave}
        header={<DialogTitle>Edit Round</DialogTitle>}
      >
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
  return <LoadedEditor {...props} initialEditor={query.data} />;
}

function LoadedEditor({
  initialEditor,
  ...props
}: EditRoundDialogProps & { initialEditor: PhaseRoundEditor }) {
  // The saved history version must stay paired with this editable snapshot.
  const [editor] = useState(initialEditor);
  const draft = useAddRoundDraft(
    editor.game.id,
    editor.players,
    editor.game.settings,
    createEditRoundDraft(editor),
    props.focusPlayerId,
  );
  return (
    <AddRoundDialog
      {...props}
      game={editor.game}
      nextRoundNumber={editor.round.roundNumber}
      expectedVersion={editor.version}
      players={editor.players}
      draft={draft}
      editor={editor}
    />
  );
}
