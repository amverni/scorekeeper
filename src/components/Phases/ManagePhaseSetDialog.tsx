import { useQuery } from "@tanstack/react-query";
import { phaseSetDetailOptions } from "../../data/hooks/usePhaseSets";
import { phasesByIdsOptions } from "../../data/hooks/usePhases";
import { formatPhaseDisplayName } from "../../utils";
import { Dialog, InlineError, List } from "../ui";

export interface ManagePhaseSetDialogProps {
  phaseSetId?: string;
  open: boolean;
  onClose: () => void;
  afterLeave?: () => void;
}

export function ManagePhaseSetDialog({
  phaseSetId,
  open,
  onClose,
  afterLeave,
}: ManagePhaseSetDialogProps) {
  const {
    data: phaseSet,
    isLoading: phaseSetLoading,
    error: phaseSetError,
    refetch: refetchPhaseSet,
  } = useQuery({
    ...phaseSetDetailOptions(phaseSetId ?? ""),
    enabled: !!phaseSetId,
  });

  const {
    data: phases,
    isLoading: phasesLoading,
    error: phasesError,
    refetch: refetchPhases,
  } = useQuery({
    ...phasesByIdsOptions(phaseSet?.phases ?? []),
    enabled: !!phaseSet && phaseSet.phases.length > 0,
  });

  return (
    <Dialog
      open={open}
      readyToOpen={!phaseSetLoading && !phasesLoading}
      onClose={onClose}
      afterLeave={afterLeave}
      aria-label={phaseSet?.name ?? "Phase set"}
      header={<h2 className="truncate text-lg font-semibold">{phaseSet?.name ?? "Phase Set"}</h2>}
    >
      {phaseSetError && (
        <InlineError message={phaseSetError.message} onRetry={() => void refetchPhaseSet()} />
      )}
      {phaseSetLoading && <output>Loading Phase Set...</output>}
      {!phaseSet && !phaseSetError && !phaseSetLoading && (
        <InlineError message="Phase Set not found." />
      )}
      {phasesError && (
        <InlineError message={phasesError.message} onRetry={() => void refetchPhases()} />
      )}
      {phaseSet && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-secondary">Type</p>
          <p className="text-sm capitalize">{phaseSet.type}</p>

          <p className="mt-2 text-sm text-text-secondary">Phases ({phaseSet.phases.length})</p>
          <List isLoading={phasesLoading} emptyMessage="No phases in this set">
            {phases?.map((phase, index) => (
              <div key={phase.id} className="flex items-center gap-2 text-sm">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-black/10 bg-black/5 text-xs font-semibold text-text-secondary tabular-nums dark:border-white/20 dark:bg-white/10">
                  {index + 1}
                </span>
                <span className="flex-1 truncate">{formatPhaseDisplayName(phase)}</span>
              </div>
            ))}
          </List>
        </div>
      )}
    </Dialog>
  );
}
