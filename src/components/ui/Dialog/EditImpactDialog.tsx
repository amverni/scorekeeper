import { Description, DialogTitle } from "@headlessui/react";
import { useEffect, useRef } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "./Dialog";

interface EditImpactDialogProps {
  open: boolean;
  title: "Edit round" | "Edit game";
  isPending: boolean;
  onEdit: () => void;
  onSave: () => void;
}

export function EditImpactDialog({
  open,
  title,
  isPending,
  onEdit,
  onSave,
}: EditImpactDialogProps) {
  const editRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || isPending) return;
    // Headless UI skips initial focus on touch; keep the safe action explicit.
    const frame = requestAnimationFrame(() => editRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, isPending]);

  return (
    <Dialog
      open={open}
      onClose={onEdit}
      dismissible={!isPending}
      showCloseButton={false}
      draggable={false}
      readyToOpen={!isPending}
      header={<DialogTitle className="text-lg font-semibold">{title}</DialogTitle>}
      actions={
        <div className="flex justify-end gap-3">
          <Button
            ref={editRef}
            type="button"
            autoFocus
            disabled={isPending}
            onClick={onEdit}
            className="min-h-11 px-5"
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="ready"
            disabled={isPending}
            onClick={onSave}
            className="min-h-11 px-5"
          >
            Save
          </Button>
        </div>
      }
    >
      <Description className="text-center text-text-secondary">
        This edit will change game results.
      </Description>
    </Dialog>
  );
}
