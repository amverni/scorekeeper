import { Plus } from "lucide-react";
import { useState } from "react";
import type { PhaseGameEditor } from "../../types";
import { formatPhaseDisplayName } from "../../utils";
import { PhaseSelectionDialog } from "../Create/Phases/AddPhasesDialog";
import { PhaseRow } from "../Create/Phases/PhaseRow";
import { Button, List } from "../ui";

export function GamePhasesEditor({
  phases,
  editable,
  isPending,
  onChange,
}: {
  phases: PhaseGameEditor["phases"];
  editable: boolean;
  isPending: boolean;
  onChange: (phases: PhaseGameEditor["phases"]) => void;
}) {
  const [selectionOpen, setSelectionOpen] = useState(false);
  return (
    <section className="py-4">
      <p className="mb-3 text-sm text-text-secondary">
        {editable
          ? "Add, remove or reorder Phases before the first saved Round. Changes apply only to this Game."
          : "Phases cannot be edited after a Round has been saved."}
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
        {editable && (
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
        )}
      </List>
      {editable && (
        <PhaseSelectionDialog
          open={selectionOpen}
          onClose={() => setSelectionOpen(false)}
          onAddPhase={(phase) => {
            if (!isPending) {
              onChange([...phases, { ...phase, occurrenceId: crypto.randomUUID() }]);
            }
          }}
        />
      )}
    </section>
  );
}
