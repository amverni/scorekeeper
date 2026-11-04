import { useId, useState } from "react";
import type { PhasesCardPhase, PhasesCardPlayerGroups, PlayerIdentity } from "../../types";
import { formatPhaseDisplayName } from "../../utils";
import { PlayerAvatarStack } from "../PlayerAvatarStack/PlayerAvatarStack";
import { Button, List, numberCircleClasses } from "../ui";

interface PhasesCardListProps {
  phases?: PhasesCardPhase[];
  playerGroups?: PhasesCardPlayerGroups;
  isLoading?: boolean;
  scrollable?: boolean;
  className?: string;
}

export function PhasesCardList({
  phases = [],
  playerGroups,
  isLoading = false,
  scrollable = true,
  className,
}: PhasesCardListProps) {
  const listClassName = [
    "rounded-2xl",
    scrollable &&
      "min-h-0 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <List
      aria-label={scrollable ? "Phases Card phase list" : undefined}
      role={scrollable ? "region" : undefined}
      tabIndex={scrollable ? 0 : undefined}
      scrollable={scrollable}
      rowVariant={playerGroups ? "compact-content" : "compact"}
      className={listClassName}
      isLoading={isLoading}
      shimmerRows={6}
      emptyMessage="No phases in this set"
    >
      {phases.map((phase, index) => (
        <PhasesCardRow
          key={`${index}-${formatPhaseDisplayName(phase)}`}
          phase={phase}
          number={index + 1}
          players={playerGroups?.[index + 1]}
        />
      ))}
    </List>
  );
}

function PhasesCardRow({
  phase,
  number,
  players,
}: {
  phase: PhasesCardPhase;
  number: number;
  players?: readonly PlayerIdentity[];
}) {
  const [expanded, setExpanded] = useState(false);
  const groupId = useId();
  const displayName = formatPhaseDisplayName(phase);
  const occupied = players && players.length > 0;

  return (
    <div
      className={[
        "relative flex w-full min-w-0 text-sm",
        phase.removed ? "text-text-secondary opacity-50" : "",
        occupied ? "items-start" : "items-center",
      ].join(" ")}
    >
      {occupied && (
        <Button
          variant="plain"
          type="button"
          aria-label={`Players on Phase ${number}`}
          aria-expanded={expanded}
          aria-controls={groupId}
          title={displayName}
          onClick={() => setExpanded((value) => !value)}
          className="absolute! -inset-x-3 -inset-y-2 z-10 rounded-lg! hover:brightness-100 active:scale-100 data-[focus]:-outline-offset-2!"
        />
      )}
      <span className={["mr-2", numberCircleClasses].join(" ")}>{number}</span>
      <div className="min-w-0 flex-1">
        <span
          className={["block w-full truncate", occupied && "leading-6"].filter(Boolean).join(" ")}
          title={displayName}
        >
          {displayName}
        </span>
        {phase.removed && <span className="block text-xs">Removed</span>}
        {occupied && (
          // biome-ignore lint/a11y/useSemanticElements: This groups identities, not form controls.
          <div id={groupId} role="group" aria-label={`Players on Phase ${number}`} className="mt-2">
            <div aria-hidden="true">
              <PlayerAvatarStack players={players} expanded={expanded} />
            </div>
            <ul className="sr-only">
              {players.map((player) => (
                <li key={player.id}>{player.name}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
