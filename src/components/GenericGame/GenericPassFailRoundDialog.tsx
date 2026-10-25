import { useForm } from "@tanstack/react-form";
import type { GameId, GenericPassFailRoundEditor, PlayerId, PlayerIdentity } from "../../types";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import { Button, DeleteRoundDialog, DialogScrollArea, EditImpactDialog } from "../ui";
import {
  GenericRoundDialog,
  GenericRoundDialogActions,
  useGenericRoundDialog,
} from "./GenericRoundDialog";
import { PassFailOutcome } from "./PassFailOutcome";

interface GenericPassFailRoundDialogProps {
  open: boolean;
  onClose: (open: boolean) => void;
  gameId: GameId;
  players: PlayerIdentity[];
  editor?: GenericPassFailRoundEditor;
  focusPlayerId?: PlayerId;
}

export function GenericPassFailRoundDialog({
  open,
  onClose,
  gameId,
  players,
  editor,
  focusPlayerId,
}: GenericPassFailRoundDialogProps) {
  const roundDialog = useGenericRoundDialog(onClose, editor);
  const form = useForm({
    defaultValues: {
      scores: editor
        ? editor.round.scores.map(({ playerId, passed }) => ({ playerId, passed }))
        : players.map((player) => ({ playerId: player.id, passed: false })),
    },
    onSubmit: async ({ value }) => {
      await roundDialog.saveRound({ gameId, mode: "passFail", scores: value.scores }, () => {
        form.reset();
      });
    },
  });

  return (
    <>
      <GenericRoundDialog
        open={open}
        onClose={roundDialog.closeEditor}
        title={editor ? "Edit Round" : "Add Round"}
        dismissible={!editor || !roundDialog.isPending}
        isPending={roundDialog.isPending}
        onSubmit={() => roundDialog.handleSubmit(form.handleSubmit)}
        submitError={roundDialog.submitError}
        actions={(formId) => (
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(submitting) => (
              <GenericRoundDialogActions
                formId={formId}
                submitting={submitting || roundDialog.isPending}
                canSave
                onDelete={editor ? roundDialog.requestDelete : undefined}
              />
            )}
          </form.Subscribe>
        )}
      >
        <DialogScrollArea aria-label="Pass/Fail entries" className="px-6! pt-4! pb-6!">
          <fieldset aria-label="Players who passed" className="flex min-w-0 flex-col gap-4">
            {players.map((player, index) => (
              <form.Field key={player.id} name={`scores[${index}].passed`}>
                {(field) => (
                  <Button
                    type="button"
                    aria-label={player.name}
                    aria-pressed={field.state.value}
                    data-autofocus={editor && player.id === focusPlayerId ? true : undefined}
                    disabled={roundDialog.isPending}
                    onBlur={field.handleBlur}
                    onClick={() => {
                      roundDialog.clearSubmitError();
                      field.handleChange(!field.state.value);
                    }}
                    className={[
                      "min-h-14 w-full gap-3 rounded-full px-4 py-3 text-left data-focus:outline-text-secondary!",
                      field.state.value ? "ring-2 ring-pt-green-500" : "",
                    ].join(" ")}
                  >
                    <PlayerAvatar player={player} size={20} />
                    <span className="min-w-0 flex-1 truncate font-medium" title={player.name}>
                      {player.name}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm">
                      <PassFailOutcome passed={field.state.value} />
                      {field.state.value ? "Passed" : "Failed"}
                    </span>
                  </Button>
                )}
              </form.Field>
            ))}
          </fieldset>
        </DialogScrollArea>
      </GenericRoundDialog>
      <EditImpactDialog
        open={roundDialog.confirmationOpen}
        title="Edit round"
        isPending={roundDialog.isPending}
        onEdit={roundDialog.cancelConfirmation}
        onSave={roundDialog.confirmSave}
      />
      {editor && (
        <DeleteRoundDialog
          open={roundDialog.deleteConfirmationOpen}
          roundNumber={editor.round.roundNumber}
          isPending={roundDialog.isPending}
          onCancel={roundDialog.cancelDelete}
          onDelete={roundDialog.confirmDelete}
        />
      )}
    </>
  );
}
