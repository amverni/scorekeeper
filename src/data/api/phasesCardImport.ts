import type {
  ArrayAtLeastOne,
  Phase,
  PhaseId,
  PhaseSet,
  PhasesCardPhase,
  SavedPhase,
  SavedPhaseSet,
} from "../../types";
import { arePhaseListsEqual, arePhaseRequirementsEqual } from "../../utils";
import { builtInPhases } from "../constants/phases";
import { getDB } from "../db";

export interface ImportedPhasesCardInput {
  name: string;
  phases: PhasesCardPhase[];
}

export const phasesCardImportApi = {
  async findSavedMatch(input: ImportedPhasesCardInput): Promise<SavedPhaseSet | undefined> {
    const requiredInput = normalizeInput(input);
    const db = await getDB();
    const customPhaseSets = await db.getAll("customPhaseSets");
    const candidates = getSavedPhaseSetCandidates(requiredInput.name, customPhaseSets);
    if (candidates.length === 0) return undefined;

    const candidatePhaseIds = [...new Set(candidates.flatMap((phaseSet) => phaseSet.phases))];
    const savedPhases = await Promise.all(
      candidatePhaseIds.map((phaseId) => db.get("customPhases", phaseId)),
    );
    return findSavedMatchInCandidates(
      requiredInput,
      candidates,
      savedPhases.filter((phase): phase is Phase => phase !== undefined).filter(isSavedPhase),
    );
  },

  async saveImported(input: ImportedPhasesCardInput): Promise<SavedPhaseSet> {
    const { name, phases } = normalizeInput(input);

    const db = await getDB();
    const tx = db.transaction(["customPhases", "customPhaseSets"], "readwrite");
    const phaseStore = tx.objectStore("customPhases");
    const phaseSetStore = tx.objectStore("customPhaseSets");
    const [customPhaseSets, customPhases] = await Promise.all([
      phaseSetStore.getAll(),
      phaseStore.index("by-type").getAll("saved"),
    ]);
    const savedPhases = customPhases.filter(isSavedPhase);
    const existing = findSavedMatchInRecords({ name, phases }, customPhaseSets, savedPhases);
    if (existing) {
      await tx.done;
      return existing;
    }

    const phaseIds: PhaseId[] = [];
    const usedPhaseIds = new Set<PhaseId>();
    for (const importedPhase of phases) {
      const existingPhase = savedPhases.find(
        (phase) => !usedPhaseIds.has(phase.id) && arePhaseRequirementsEqual(phase, importedPhase),
      );
      if (existingPhase) {
        phaseIds.push(existingPhase.id);
        usedPhaseIds.add(existingPhase.id);
        continue;
      }

      const phase: SavedPhase = {
        id: crypto.randomUUID(),
        type: "saved",
        requirements: importedPhase.requirements as SavedPhase["requirements"],
      };
      await phaseStore.add(phase);
      savedPhases.push(phase);
      phaseIds.push(phase.id);
      usedPhaseIds.add(phase.id);
    }

    const phaseSet: SavedPhaseSet = {
      id: crypto.randomUUID(),
      type: "saved",
      name,
      phases: phaseIds as ArrayAtLeastOne<PhaseId>,
    };
    await phaseSetStore.add(phaseSet);
    await tx.done;
    return phaseSet;
  },
};

function normalizeInput(input: ImportedPhasesCardInput): ImportedPhasesCardInput {
  const name = normalizeName(input.name);
  const phases = input.phases.filter((phase) => !phase.removed);
  if (phases.length === 0) throw new Error("At least one required Phase must remain.");
  return { name, phases };
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Phase Set name is required");
  return trimmed;
}

function findSavedMatchInRecords(
  input: ImportedPhasesCardInput,
  customPhaseSets: PhaseSet[],
  savedPhases: SavedPhase[],
): SavedPhaseSet | undefined {
  const name = normalizeName(input.name);
  const candidates = getSavedPhaseSetCandidates(name, customPhaseSets);
  return findSavedMatchInCandidates(input, candidates, savedPhases);
}

function getSavedPhaseSetCandidates(name: string, phaseSets: PhaseSet[]): SavedPhaseSet[] {
  return phaseSets.filter(isSavedPhaseSet).filter((phaseSet) => phaseSet.name.trim() === name);
}

function findSavedMatchInCandidates(
  input: ImportedPhasesCardInput,
  candidates: SavedPhaseSet[],
  savedPhases: SavedPhase[],
): SavedPhaseSet | undefined {
  return getSavedPhaseSetsWithResolvedPhasesFromRecords(candidates, savedPhases).find(
    ({ phases }) => arePhaseListsEqual(phases, input.phases),
  )?.phaseSet;
}

function getSavedPhaseSetsWithResolvedPhasesFromRecords(
  phaseSets: SavedPhaseSet[],
  savedPhases: SavedPhase[],
): Array<{ phaseSet: SavedPhaseSet; phases: Phase[] }> {
  const phaseById = new Map<PhaseId, Phase>([
    ...builtInPhases.map((phase) => [phase.id, phase] as const),
    ...savedPhases.map((phase) => [phase.id, phase] as const),
  ]);

  return phaseSets
    .map((phaseSet) => ({
      phaseSet,
      phases: phaseSet.phases
        .map((phaseId) => phaseById.get(phaseId))
        .filter((phase): phase is Phase => phase !== undefined),
    }))
    .filter(({ phaseSet, phases }) => phases.length === phaseSet.phases.length);
}

function isSavedPhase(phase: Phase): phase is SavedPhase {
  return phase.type === "saved";
}

function isSavedPhaseSet(phaseSet: PhaseSet): phaseSet is SavedPhaseSet {
  return phaseSet.type === "saved";
}
