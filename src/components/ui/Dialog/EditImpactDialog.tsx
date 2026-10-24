import { Description, DialogTitle } from "@headlessui/react";
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
