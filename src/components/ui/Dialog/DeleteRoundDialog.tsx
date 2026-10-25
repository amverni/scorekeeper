import { Description, DialogTitle } from "@headlessui/react";
import { useEffect, useRef } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "./Dialog";

interface DeleteRoundDialogProps {
  open: boolean;
  roundNumber: number;
  isPending: boolean;
  onCancel: () => void;
  onDelete: () => void;
}

export function DeleteRoundDialog({
  open,
  roundNumber,
  isPending,
  onCancel,
  onDelete,
}: DeleteRoundDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // Headless UI skips initial focus on touch; deletion must still start on Cancel.
    const frame = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!isPending}
      showCloseButton={false}
      draggable={false}
      header={<DialogTitle className="text-lg font-semibold">Delete round</DialogTitle>}
      actions={
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
      }
    >
      <Description className="text-center text-text-secondary">
        Delete Round {roundNumber}? This cannot be undone.
      </Description>
    </Dialog>
  );
}
