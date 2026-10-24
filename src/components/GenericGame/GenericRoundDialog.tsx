import { DialogTitle } from "@headlessui/react";
import { Check, Loader2 } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import {
  useAddGenericRound,
  useEditGenericRound,
  usePreviewGenericRoundEdit,
} from "../../data/hooks/useGenericGames";
import type {
  AddGenericRoundInput,
  EditGenericPointsRoundInput,
  GenericPointsRoundEditor,
} from "../../types";
import { Button, Dialog, DialogScrollArea, InlineError } from "../ui";

export function useGenericRoundDialog(
  onClose: (open: boolean) => void,
  editor?: GenericPointsRoundEditor,
) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    input: EditGenericPointsRoundInput;
    resetDraft: () => void;
  } | null>(null);
  const submitting = useRef(false);
  const addRound = useAddGenericRound();
  const previewEdit = usePreviewGenericRoundEdit();
  const editRound = useEditGenericRound();
  const isPending = addRound.isPending || previewEdit.isPending || editRound.isPending;

  async function saveRound(input: AddGenericRoundInput, resetDraft: () => void) {
    if (editor) {
      if (input.mode !== "points") throw new Error("Only Points Rounds can be edited.");
      const edit = { ...input, roundId: editor.round.id, version: editor.version };
      const impact = await previewEdit.mutateAsync(edit);
      if (impact.requiresConfirmation) {
        setConfirmation({ input: edit, resetDraft });
        return;
      }
      await editRound.mutateAsync(edit);
    } else {
      await addRound.mutateAsync(input);
    }
    resetDraft();
    onClose(false);
  }

  function clearSubmitError() {
    setSubmitError(null);
  }

  function handleSubmit(submit: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    clearSubmitError();
    submit()
      .catch((error: unknown) => {
        setConfirmation(null);
        setSubmitError(error instanceof Error ? error.message : "Unable to save Round.");
      })
      .finally(() => {
        submitting.current = false;
      });
  }

  return {
    isPending,
    confirmationOpen: confirmation !== null,
    cancelConfirmation: () => {
      if (!submitting.current) setConfirmation(null);
    },
    confirmSave: () =>
      handleSubmit(async () => {
        if (!confirmation) return;
        await editRound.mutateAsync({ ...confirmation.input, confirmImpact: true });
        setConfirmation(null);
        confirmation.resetDraft();
        onClose(false);
      }),
    closeEditor: (open: boolean) => {
      if (!editor || !submitting.current) onClose(open);
    },
    submitError,
    clearSubmitError,
    saveRound,
    handleSubmit,
  };
}

interface GenericRoundDialogProps {
  open: boolean;
  onClose: (open: boolean) => void;
  isPending: boolean;
  onSubmit: () => void;
  submitError: string | null;
  children: ReactNode;
  actions: (formId: string) => ReactNode;
  minBodyHeight?: number;
  title?: string;
  dismissible?: boolean;
}

export function GenericRoundDialog({
  open,
  onClose,
  isPending,
  onSubmit,
  submitError,
  children,
  actions,
  minBodyHeight,
  title = "Add Round",
  dismissible = true,
}: GenericRoundDialogProps) {
  const formId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={dismissible}
      sizing="workspace"
      bodyScroll="custom"
      minBodyHeight={minBodyHeight}
      header={<DialogTitle className="sr-only">{title}</DialogTitle>}
      actions={
        <>
          {submitError && (
            <div className="flex max-h-24 min-h-0 flex-col pb-3">
              <DialogScrollArea aria-label="Round save error" className="wrap-anywhere">
                <InlineError message={submitError} />
              </DialogScrollArea>
            </div>
          )}
          {actions(formId)}
        </>
      }
    >
      <form
        id={formId}
        aria-busy={isPending}
        className="round-entry-form flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isPending) onSubmit();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </form>
    </Dialog>
  );
}

interface GenericRoundDialogActionsProps {
  formId: string;
  submitting: boolean;
  canSave: boolean;
  children?: ReactNode;
}

const roundActionClasses = [
  "size-11 shrink-0",
  "data-focus:outline-solid data-focus:outline-text-secondary!",
].join(" ");

export function GenericRoundDialogActions({
  formId,
  submitting,
  canSave,
  children,
}: GenericRoundDialogActionsProps) {
  return (
    <div className="flex items-center justify-end gap-3 px-2 pt-1 pb-2">
      {children && <div className="min-w-0 flex-1 text-center">{children}</div>}
      <Button
        type="submit"
        form={formId}
        variant="ready"
        aria-label="Save"
        disabled={!canSave || submitting}
        className={roundActionClasses}
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Check className="size-4" aria-hidden />
        )}
      </Button>
    </div>
  );
}
