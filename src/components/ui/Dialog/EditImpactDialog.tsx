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
