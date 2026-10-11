import type { VisiblePhase } from "../../types";
import { formatPhaseDisplayName } from "../../utils";
import { Dialog } from "../ui";

export interface ManagePhaseDialogProps {
  phase?: VisiblePhase;
  open: boolean;
  onClose: () => void;
  afterLeave?: () => void;
}

export function ManagePhaseDialog({ phase, open, onClose, afterLeave }: ManagePhaseDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      afterLeave={afterLeave}
      aria-label={phase ? formatPhaseDisplayName(phase) : "Phase"}
      header={
        <h2 className="truncate text-lg font-semibold">
          {phase ? formatPhaseDisplayName(phase) : "Phase"}
        </h2>
      }
    >
      {phase && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-secondary">Type</p>
          <p className="text-sm capitalize">{phase.type}</p>
        </div>
      )}
    </Dialog>
  );
}
