import { useForm } from "@tanstack/react-form";
import type { GameId, PlayerIdentity } from "../../types";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import { Button, DialogScrollArea } from "../ui";
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
}

export function GenericPassFailRoundDialog({
  open,
  onClose,
  gameId,
  players,
}: GenericPassFailRoundDialogProps) {
  const roundDialog = useGenericRoundDialog(onClose);
  const form = useForm({
    defaultValues: { scores: players.map((player) => ({ playerId: player.id, passed: false })) },
    onSubmit: async ({ value }) => {
      await roundDialog.saveRound({ gameId, mode: "passFail", scores: value.scores }, () => {
        form.reset();
      });
    },
  });

  return (
    <GenericRoundDialog
      open={open}
      onClose={onClose}
      isPending={roundDialog.isPending}
      onSubmit={() => roundDialog.handleSubmit(form.handleSubmit)}
      submitError={roundDialog.submitError}
      actions={(formId) => (
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <GenericRoundDialogActions formId={formId} submitting={submitting} canSave />
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
  );
}
