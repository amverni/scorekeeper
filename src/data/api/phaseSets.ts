import type {
  BuiltInT,
  Phase,
  PhaseId,
  PhaseSet,
  PhaseSetId,
  PhasesCardPhase,
  SavedPhaseSet,
  SavedT,
  VisiblePhaseSet,
} from "../../types";
import { arePhaseListsEqual } from "../../utils";
import { builtInPhaseSets } from "../constants/phaseSets";
import { builtInPhases } from "../constants/phases";
import { getDB } from "../db";
import { favoritesApi } from "./favorites";
import { phasesApi } from "./phases";
import { nameMatchScore } from "./utils";

export interface PhaseSetPhasesResult {
  phases: Phase[];
  missingPhaseRecords: boolean;
}

export const phaseSetsApi = {
  /**
   * Get all phase sets, optionally filtered by type, name, and favorite status.
   *
   * Only returns the `id`, `name`, and `type` of each phase set.
   * Temporary phase sets are never returned by this method.
   *
   * @param filters - Optional filters to narrow results.
   * @param filters.type - Filter by phase set type: `"built-in"` or `"saved"`.
   * @param filters.name - Filter by name substring match.
   * @param filters.isFavorite - Filter to only favorited phase sets when `1`.
   * @returns The matching phase set summaries, sorted by name relevance when a name filter is provided.
   */
  async getAll(filters?: {
    type?: BuiltInT | SavedT;
    name?: string;
    isFavorite?: 0 | 1;
  }): Promise<Pick<VisiblePhaseSet, "id" | "name" | "type">[]> {
    let phaseSets: VisiblePhaseSet[] = [];

    if (filters?.type !== "saved") {
      phaseSets.push(...builtInPhaseSets);
    }
    if (filters?.type !== "built-in") {
      const db = await getDB();
      const all = await db.getAll("customPhaseSets");
      const saved = all.filter((ps): ps is SavedPhaseSet => ps.type === "saved");
      phaseSets.push(...saved);
    }

    // Filter by favorite status
    if (filters?.isFavorite === 1) {
      const favoriteIds = await favoritesApi.getAll("phaseSet");
      const favoriteSet = new Set(favoriteIds);
      phaseSets = phaseSets.filter((ps) => favoriteSet.has(ps.id));
    }

    if (filters?.name) {
      const search = filters.name.toLowerCase();
      phaseSets = phaseSets
        .filter((ps) => ps.name.toLowerCase().includes(search))
        .sort((a, b) => nameMatchScore(b.name, search) - nameMatchScore(a.name, search));
    }

    return phaseSets.map(({ id, name, type }) => ({ id, name, type }));
  },

  /**
   * Get a single phase set by its unique ID.
   *
   * Looks up the phase set in built-in constants first, then checks the
   * database for custom phase sets. Returns any phase set type, including
   * temporary.
   *
   * @param id - The unique identifier of the phase set to retrieve.
   * @returns The phase set if found, or `undefined` if no phase set exists with the given ID.
   */
  async getById(id: PhaseSetId): Promise<PhaseSet | undefined> {
    const builtIn = builtInPhaseSets.find((ps) => ps.id === id);
    if (builtIn) return builtIn;

    const db = await getDB();
    return db.get("customPhaseSets", id);
  },

  /**
   * Get the phases included in a phase set.
   *
   * Looks up the phase set first, then resolves the phases in phase-set order.
   *
   * @param id - The unique identifier of the phase set whose phases should be retrieved.
   * @returns The phases in the phase set, or an empty array if no phase set exists with the given ID.
   */
  async getPhases(id: PhaseSetId): Promise<Phase[]> {
    const phaseSet = await this.getById(id);
    if (!phaseSet) return [];
    return phasesApi.getByIds([...phaseSet.phases]);
  },

  async getPhasesWithStatus(id: PhaseSetId): Promise<PhaseSetPhasesResult> {
    const phaseSet = await this.getById(id);
    if (!phaseSet) return { phases: [], missingPhaseRecords: false };

    const phases = await phasesApi.getByIds([...phaseSet.phases]);
    return {
      phases,
      missingPhaseRecords: phases.length !== phaseSet.phases.length,
    };
  },

  /**
   * Find the built-in phase set whose ordered phase requirements match the
   * provided phases.
   *
   * Used by Phases Card sharing to shorten game-snapshot links only when the
   * game phases exactly match a built-in Phase Set.
   */
  getMatchingBuiltInId(phases: PhasesCardPhase[]): PhaseSetId | undefined {
    if (phases.some((phase) => phase.removed)) return undefined;
    const builtInPhaseById = new Map<PhaseId, Phase>(
      builtInPhases.map((phase) => [phase.id, phase]),
    );

    return builtInPhaseSets.find((phaseSet) => {
      const phasesForSet = phaseSet.phases
        .map((phaseId) => builtInPhaseById.get(phaseId))
        .filter((phase): phase is Phase => phase !== undefined);

      return (
        phasesForSet.length === phaseSet.phases.length && arePhaseListsEqual(phases, phasesForSet)
      );
    })?.id;
  },

  /**
   * Create a new phase set.
   *
   * Automatically generates a unique ID (UUID v4).
   *
   * @param data - The phase set data, excluding `id` which is generated automatically.
   * @returns The newly created phase set, including the generated `id`.
   */
  async create(data: Omit<SavedPhaseSet, "id">): Promise<SavedPhaseSet> {
    const db = await getDB();
    const id: PhaseSetId = crypto.randomUUID();
    const newPhaseSet: SavedPhaseSet = { ...data, id };
    await db.add("customPhaseSets", newPhaseSet);
    return newPhaseSet;
  },

  /**
   * Delete a phase set by ID.
   *
   * Removes the phase set record from the database. No error is thrown if the
   * phase set does not exist. Only custom phase sets (saved) can be deleted;
   * built-in phase sets cannot be removed and will cause an error.
   *
   * @param id - The unique identifier of the phase set to delete.
   * @throws {Error} If the ID belongs to a built-in phase set.
   */
  async delete(id: PhaseSetId): Promise<void> {
    if (builtInPhaseSets.some((ps) => ps.id === id)) {
      throw new Error(`Cannot delete built-in phase set: ${id}`);
    }

    const db = await getDB();
    await db.delete("customPhaseSets", id);
  },
};
