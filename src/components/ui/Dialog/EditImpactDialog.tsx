import { useEffect, useRef } from "react";
import { Button } from "../Button/Button";
import { ConfirmationDialog } from "./ConfirmationDialog";

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
    <ConfirmationDialog
      open={open}
      onClose={onEdit}
      dismissible={!isPending}
      title={title}
      message="This edit will change game results."
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
    />
  );
}
