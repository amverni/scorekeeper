import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { gamePhasePlayersOptions, gamePhasesCardOptions } from "../../data/hooks/useGames";
import { builtInPhaseSetMatchOptions } from "../../data/hooks/usePhaseSets";
import type { GameId } from "../../types";
import { Dialog, DialogScrollArea, InlineError, Toast, type ToastHandle } from "../ui";
import { PhasesCardList } from "./PhasesCardList";
import { PhasesCardShareButton } from "./PhasesCardShareButton";

interface PhasesCardDialogProps {
  gameId: GameId;
  open: boolean;
  onClose: (open: boolean) => void;
}

export function PhasesCardDialog({ gameId, open, onClose }: PhasesCardDialogProps) {
  const toastRef = useRef<ToastHandle>(null);
  const phasePlayersQuery = useQuery({
    ...gamePhasePlayersOptions(gameId),
    enabled: open,
  });
  const {
    data: card,
    isError,
    isLoading,
    error,
    refetch,
  } = useQuery({
    ...gamePhasesCardOptions(gameId),
    enabled: open,
  });
  const phases = card?.phases ?? [];
  const removedPhases = card?.hasRemovedPhases === true;
  const canMatchBuiltIn = open && !isLoading && !isError && !removedPhases && phases.length > 0;
  const { data: builtInPhaseSetId = null, isLoading: builtInMatchLoading } = useQuery({
    ...builtInPhaseSetMatchOptions(phases),
    enabled: canMatchBuiltIn,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-label="Phases Card"
      bodyScroll="custom"
      headerAction={
        <PhasesCardShareButton
          target={{ source: "game-snapshot", name: card?.name ?? "", phases, builtInPhaseSetId }}
          className="size-10!"
          disabled={
            isLoading || builtInMatchLoading || isError || removedPhases || phases.length === 0
          }
          onError={(message) => toastRef.current?.show(message)}
        />
      }
    >
      {removedPhases && (
        <p className="pb-3 text-sm text-text-secondary">
          Sharing is unavailable because this Game has Removed Phases. The current share format
          cannot preserve their numbers and removal state.
        </p>
      )}
      {isError || phasePlayersQuery.isError ? (
        <div className="pb-4">
          {isError ? (
            <InlineError
              message={error?.message ?? "Unable to load phases."}
              onRetry={() => refetch()}
            />
          ) : phasePlayersQuery.isError ? (
            <InlineError
              message="Unable to load Players' Current Phases."
              onRetry={() => phasePlayersQuery.refetch()}
            />
          ) : null}
        </div>
      ) : (
        <DialogScrollArea
          aria-label="Phases Card phase list"
          aria-busy={isLoading || phasePlayersQuery.isPending}
          className="overscroll-none pb-4"
        >
          <PhasesCardList
            phases={phases}
            playerGroups={phasePlayersQuery.data}
            isLoading={isLoading || phasePlayersQuery.isPending}
            scrollable={false}
          />
        </DialogScrollArea>
      )}
      <Toast ref={toastRef} />
    </Dialog>
  );
}
