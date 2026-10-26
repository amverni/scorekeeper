import { useEffect, useRef } from "react";
import { Button } from "../Button/Button";
import { InlineError } from "../InlineError/InlineError";
import { ConfirmationDialog } from "./ConfirmationDialog";

interface DeleteRoundDialogProps {
  open: boolean;
  roundNumber: number;
  isPending: boolean;
  onCancel: () => void;
  onDelete: () => void;
  error?: string | null;
}

export function DeleteRoundDialog({
  open,
  roundNumber,
  isPending,
  onCancel,
  onDelete,
  error,
}: DeleteRoundDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // Headless UI skips initial focus on touch; deletion must still start on Cancel.
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <ConfirmationDialog
      open={open}
      title="Delete round"
      message={`Delete Round ${roundNumber}? This cannot be undone.`}
      onClose={onCancel}
      dismissible={!isPending}
      actions={
        <div className="flex flex-col gap-3">
          {error && <InlineError message={error} />}
          <div className="flex justify-end gap-3">
            <Button
              ref={cancelRef}
              type="button"
              autoFocus
              disabled={isPending}
              onClick={onCancel}
              className="min-h-11 px-5"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={onDelete}
              className="min-h-11 px-5 text-pt-red-500"
            >
              Delete
            </Button>
          </div>
        </div>
      }
    />
  );
}
