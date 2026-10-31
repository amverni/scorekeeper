import type { AppGameDefaults, AppSettings, GameTiebreaker, PhaseSetId } from "../../types";
import { APP_SETTINGS_ID, DEFAULT_APP_SETTINGS } from "../constants/appSettings";
import {
  DEFAULT_GAME_SETTINGS,
  normalizeGamePenalty,
  normalizeGameSettings,
} from "../constants/gameSettings";
import { getDB } from "../db";
import { phaseSetsApi } from "./phaseSets";

export const settingsApi = {
  async get(): Promise<AppSettings> {
    const db = await getDB();
    return withSettingsDefaults(await db.get("settings", APP_SETTINGS_ID));
  },

  async updateGameDefaults(updates: Partial<AppGameDefaults>): Promise<AppSettings> {
    const db = await getDB();
    const nextUpdates = await withValidGameDefaultUpdates(updates);
    const tx = db.transaction("settings", "readwrite");
    const current = await tx.store.get(APP_SETTINGS_ID);
    const updated: AppSettings = {
      id: APP_SETTINGS_ID,
      gameDefaults: {
        ...resolveGameDefaults(current),
        ...nextUpdates,
      },
    };

    await Promise.all([tx.store.put(updated), tx.done]);
    return updated;
  },

  setDefaultTiebreaker(tiebreaker: GameTiebreaker): Promise<AppSettings> {
    return this.updateGameDefaults({ tiebreaker });
  },

  setDefaultInOrderPhases(inOrderPhases: boolean): Promise<AppSettings> {
    return this.updateGameDefaults({ inOrderPhases });
  },

  setDefaultPhaseSetId(phaseSetId: PhaseSetId): Promise<AppSettings> {
    return this.updateGameDefaults({ phaseSetId });
  },

  setDefaultRoundSkipPenalty(value: number): Promise<AppSettings> {
    return this.updateGameDefaults({ roundSkipPenalty: value });
  },

  setDefaultSitOutPenalty(value: number): Promise<AppSettings> {
    return this.updateGameDefaults({ sitOutPenalty: value });
  },

  async reset(): Promise<AppSettings> {
    const db = await getDB();
    const defaults = await withSettingsDefaults(DEFAULT_APP_SETTINGS);
    await db.put("settings", defaults);
    return defaults;
  },
};

async function withSettingsDefaults(settings?: AppSettings): Promise<AppSettings> {
  const gameDefaults = resolveGameDefaults(settings);
  const phaseSet = await phaseSetsApi.getById(gameDefaults.phaseSetId);

  return {
    id: APP_SETTINGS_ID,
    gameDefaults: {
      ...gameDefaults,
      phaseSetId: phaseSet?.id ?? DEFAULT_APP_SETTINGS.gameDefaults.phaseSetId,
    },
  };
}

function resolveGameDefaults(settings?: AppSettings): AppGameDefaults {
  const normalizedGameSettings = normalizeGameSettings(settings?.gameDefaults);
  return {
    ...DEFAULT_APP_SETTINGS.gameDefaults,
    ...normalizedGameSettings,
    phaseSetId: settings?.gameDefaults?.phaseSetId ?? DEFAULT_APP_SETTINGS.gameDefaults.phaseSetId,
  };
}

async function withValidGameDefaultUpdates(
  updates: Partial<AppGameDefaults>,
): Promise<Partial<AppGameDefaults>> {
  if (updates.inOrderPhases !== undefined && typeof updates.inOrderPhases !== "boolean") {
    throw new Error("In-order phases must be On or Off.");
  }

  const nextUpdates: Partial<AppGameDefaults> = {
    ...updates,
  };

  if (updates.roundSkipPenalty !== undefined) {
    nextUpdates.roundSkipPenalty = normalizeGamePenalty(
      updates.roundSkipPenalty,
      DEFAULT_GAME_SETTINGS.roundSkipPenalty,
    );
  }

  if (updates.sitOutPenalty !== undefined) {
    nextUpdates.sitOutPenalty = normalizeGamePenalty(
      updates.sitOutPenalty,
      DEFAULT_GAME_SETTINGS.sitOutPenalty,
    );
  }

  if (updates.phaseSetId === undefined) return nextUpdates;

  const phaseSet = await phaseSetsApi.getById(updates.phaseSetId);
  if (!phaseSet) throw new Error("Phase set not found");

  return {
    ...nextUpdates,
    phaseSetId: phaseSet.id,
  };
}
