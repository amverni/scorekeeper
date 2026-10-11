import { Button as HeadlessButton } from "@headlessui/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Star } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { phaseSetListOptions } from "../../../data/hooks/usePhaseSets";
import { phaseListOptions } from "../../../data/hooks/usePhases";
import type { MeldType, PhaseSetId } from "../../../types";
import { formatPhaseDisplayName } from "../../../utils";
import {
  Button,
  Dialog,
  DialogScrollArea,
  FilterListbox,
  InlineError,
  List,
  ListboxOption,
  SearchBar,
} from "../../ui";
import { useAddPhase, useGamePhases } from "../CreateGameContext";
import "./PhaseSelectionDialog.css";

export interface AddPhasesDialogProps {
  open: boolean;
  onClose: () => void;
}

const MELD_TYPE_OPTIONS: { label: string; value: MeldType }[] = [
  { label: "Set", value: "set" },
  { label: "Run", value: "run" },
  { label: "Color Group", value: "colorGroup" },
];

const ALL_MELD_TYPE_VALUES: MeldType[] = MELD_TYPE_OPTIONS.map((m) => m.value);

export function AddPhasesDialog({ open, onClose }: AddPhasesDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [meldType, setMeldType] = useState<MeldType[]>(ALL_MELD_TYPE_VALUES);
  const [phaseSetId, setPhaseSetId] = useState<PhaseSetId | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const deferredSearch = useDeferredValue(searchTerm);
  const addPhase = useAddPhase();
  const gamePhases = useGamePhases();
  const gamePhaseIds = new Set(gamePhases.map((p) => p.id));

  useEffect(() => {
    if (!open) return;
    setFavoritesOnly(false);
  }, [open]);

  const setMeldTypes = (types: MeldType[]) => {
    setMeldType(types.length === 0 ? ALL_MELD_TYPE_VALUES : types);
  };

  const isAllTypes = meldType.length === ALL_MELD_TYPE_VALUES.length;

  const filters = {
    ...(deferredSearch ? { search: deferredSearch } : {}),
    ...(!isAllTypes ? { meldTypes: meldType } : {}),
    ...(phaseSetId ? { phaseSetId } : {}),
    ...(favoritesOnly ? { isFavorite: 1 as const } : {}),
  };

  const {
    data: phases = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    ...phaseListOptions(Object.keys(filters).length > 0 ? filters : undefined),
    placeholderData: keepPreviousData,
  });

  const { data: allPhaseSets = [] } = useQuery({
    ...phaseSetListOptions(),
    placeholderData: keepPreviousData,
  });

  const emptyMessage = deferredSearch ? `No phases matching "${deferredSearch}"` : "No phases yet";
  const meldTypeLabel = isAllTypes
    ? "All"
    : MELD_TYPE_OPTIONS.filter((m) => meldType.includes(m.value))
        .map((m) => m.label)
        .join(", ");
  const phaseSetLabel = allPhaseSets.find((ps) => ps.id === phaseSetId)?.name ?? "All";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-label="Add phases"
      presentation="floating"
      bodyScroll="custom"
      className="phase-selection-dialog"
    >
      <div className="flex min-h-0 flex-col pb-4">
        <SearchBar
          value={searchTerm}
          onValueChange={setSearchTerm}
          placeholder="Search phases…"
          className="pt-3"
        />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 py-2">
          <Button
            className={[
              "gap-1.5 px-3 py-2 text-sm font-medium",
              favoritesOnly ? "text-amber-400" : "text-text-primary",
            ].join(" ")}
            onClick={() => setFavoritesOnly((current) => !current)}
            aria-pressed={favoritesOnly}
          >
            <Star
              className={favoritesOnly ? "h-4 w-4 shrink-0 fill-current" : "h-4 w-4 shrink-0"}
            />
            Favorites
          </Button>

          <FilterListbox
            value={meldType}
            onChange={setMeldTypes}
            multiple
            label="Type"
            displayValue={meldTypeLabel}
          >
            {MELD_TYPE_OPTIONS.map(({ label, value }) => (
              <ListboxOption key={value} value={value} selected={meldType.includes(value)}>
                {label}
              </ListboxOption>
            ))}
          </FilterListbox>

          {allPhaseSets.length > 0 && (
            <FilterListbox
              value={phaseSetId}
              onChange={setPhaseSetId}
              label="Phase Set"
              displayValue={phaseSetLabel}
            >
              <ListboxOption value={null}>All</ListboxOption>
              {allPhaseSets.map((ps) => (
                <ListboxOption key={ps.id} value={ps.id}>
                  {ps.name}
                </ListboxOption>
              ))}
            </FilterListbox>
          )}
        </div>

        {/* Phase list */}
        <DialogScrollArea aria-label="Phase search results">
          {isError ? (
            <InlineError message="Unable to load phases." onRetry={() => refetch()} />
          ) : (
            <List isLoading={isLoading} shimmerRows={4} emptyMessage={emptyMessage}>
              {phases.map((phase) => (
                <HeadlessButton
                  key={phase.id}
                  className="-mx-3 flex h-full w-[calc(100%+1.5rem)] cursor-pointer items-center justify-between px-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => addPhase(phase)}
                  disabled={gamePhaseIds.has(phase.id)}
                >
                  <span className="truncate">{formatPhaseDisplayName(phase)}</span>
                  <Plus className="h-5 w-5 shrink-0 text-text-secondary" />
                </HeadlessButton>
              ))}
            </List>
          )}
        </DialogScrollArea>
      </div>
    </Dialog>
  );
}
