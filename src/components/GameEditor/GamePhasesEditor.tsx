import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { PhaseGameEditor, PhaseRemovalOption } from "../../types";
import { formatPhaseDisplayName } from "../../utils";
import { PhaseSelectionDialog } from "../Create/Phases/AddPhasesDialog";
import { PhaseRow } from "../Create/Phases/PhaseRow";
import { Button, List } from "../ui";

export function GamePhasesEditor({
  phases,
  editable,
  isPending,
  onChange,
  removalOptions,
  savedPhases,
}: {
  phases: PhaseGameEditor["phases"];
  editable: boolean;
  isPending: boolean;
  onChange: (phases: PhaseGameEditor["phases"]) => void;
  removalOptions?: PhaseRemovalOption[];
  savedPhases: PhaseGameEditor["phases"];
}) {
  const [selectionOpen, setSelectionOpen] = useState(false);
  const addPhaseButton = (
    <Button
      key="add-phase"
      type="button"
      variant="plain"
      className="-mx-3 h-full w-[calc(100%+1.5rem)] justify-start gap-2 rounded-none px-3 text-sm"
      disabled={isPending}
      onClick={() => setSelectionOpen(true)}
    >
      <Plus className="size-4" aria-hidden />
      Add Phase
    </Button>
  );
  const phaseSelection = (
    <PhaseSelectionDialog
      open={selectionOpen}
      onClose={() => setSelectionOpen(false)}
      onAddPhase={(phase) => {
        if (!isPending) {
          onChange([...phases, { ...phase, occurrenceId: crypto.randomUUID() }]);
        }
      }}
    />
  );
  if (!editable) {
    return (
      <section className="py-4">
        <p className="mb-3 text-sm text-text-secondary">
          Add, remove or restore Phases for all Players in this Game without deleting saved Rounds.
          Removed history stays visible and does not count. New Phases append after retained slots.
          Phases cannot be reordered after a Round has been saved.
        </p>
        {!phases.some((phase) => !phase.removed) && (
          <p role="alert" className="mb-3 text-sm text-text-secondary">
            At least one required Phase must remain.
          </p>
        )}
        <List role="list" aria-label="Game Phases" rowVariant="compact-content">
          {phases.map((phase, index) => {
            const option = removalOptions?.find(
              (option) => option.occurrenceId === phase.occurrenceId,
            );
            const savedRemoved = savedPhases.find(
              (saved) => saved.occurrenceId === phase.occurrenceId,
            )?.removed;
            return (
              <li key={phase.occurrenceId} className="w-full min-w-0 list-none">
                <div className="flex items-center gap-2">
                  <div
                    className={["min-w-0 flex-1", phase.removed && "text-text-secondary opacity-50"]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <PhaseRow phase={phase} index={index} />
                  </div>
                  {phase.removed ? (
                    <span className="text-sm text-text-secondary">Removed</span>
                  ) : savedRemoved ? (
                    <Button
                      type="button"
                      variant="plain"
                      disabled={isPending}
                      aria-label={`Undo restoration of Phase ${index + 1}`}
                      onClick={() =>
                        onChange(
                          phases.map((entry) =>
                            entry.occurrenceId === phase.occurrenceId
                              ? { ...entry, removed: true }
                              : entry,
                          ),
                        )
                      }
                      className="min-h-10 shrink-0 text-sm"
                    >
                      Undo
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="plain"
                      aria-label={`Remove Phase ${index + 1}: ${formatPhaseDisplayName(phase)}`}
                      disabled={isPending || Boolean(option?.reason)}
                      onClick={() =>
                        onChange(
                          option?.retainSlot
                            ? phases.map((entry) =>
                                entry.occurrenceId === phase.occurrenceId
                                  ? { ...entry, removed: true }
                                  : entry,
                              )
                            : phases.filter((entry) => entry.occurrenceId !== phase.occurrenceId),
                        )
                      }
                      className="size-10 shrink-0"
                    >
                      <Minus className="size-5" aria-hidden />
                    </Button>
                  )}
                  {phase.removed && (
                    <Button
                      type="button"
                      variant="plain"
                      disabled={isPending}
                      aria-label={
                        savedRemoved
                          ? `Restore Phase ${index + 1}`
                          : `Undo removal of Phase ${index + 1}`
                      }
                      onClick={() =>
                        onChange(
                          phases.map((entry) => {
                            if (entry.occurrenceId !== phase.occurrenceId) return entry;
                            const { removed: _, ...rest } = entry;
                            return rest;
                          }),
                        )
                      }
                      className="min-h-10 shrink-0 text-sm"
                    >
                      {savedRemoved ? "Restore" : "Undo"}
                    </Button>
                  )}
                </div>
                {!phase.removed && !savedRemoved && option?.reason && (
                  <p className="mt-1 text-xs text-text-secondary">{option.reason}</p>
                )}
              </li>
            );
          })}
          {addPhaseButton}
        </List>
        {phaseSelection}
      </section>
    );
  }
  return (
    <section className="py-4">
      <p className="mb-3 text-sm text-text-secondary">
        Add, remove or reorder Phases before the first saved Round. Changes apply only to this Game.
      </p>
      {phases.length === 0 && (
        <p role="alert" className="mb-3 text-sm text-text-secondary">
          At least one required Phase must remain.
        </p>
      )}
      <List
        role="list"
        aria-label="Game Phases"
        sortable={editable}
        removable={editable && !isPending}
        items={phases.map((phase, index) => ({
          id: phase.occurrenceId,
          label: `Phase ${index + 1}: ${formatPhaseDisplayName(phase)}`,
          reorderable: !isPending,
        }))}
        onReorder={(items) => {
          if (isPending) return;
          onChange(
            items.map(({ id }) => {
              const phase = phases.find((phase) => phase.occurrenceId === id);
              if (!phase) throw new Error("Game Phase is unavailable.");
              return phase;
            }),
          );
        }}
        onRemove={(id) => onChange(phases.filter((phase) => phase.occurrenceId !== id))}
      >
        {phases.map((phase, index) => (
          <li key={phase.occurrenceId} className="w-full min-w-0 list-none">
            <PhaseRow phase={phase} index={index} />
          </li>
        ))}
        {addPhaseButton}
      </List>
      {phaseSelection}
    </section>
  );
}
