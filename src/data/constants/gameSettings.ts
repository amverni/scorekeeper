import type { GameSettings, GameTiebreaker } from "../../types";

export const TIEBREAKER_VALUES = [
  "lowestPoints",
  "highestPoints",
  "fewestSkips",
  "mostSkipped",
  "fewestWilds",
  "roundsWon",
] as const satisfies ReadonlyArray<GameTiebreaker>;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  inOrderPhases: true,
  tiebreaker: "lowestPoints",
  roundSkipPenalty: 100,
  sitOutPenalty: 0,
};

export const GAME_PENALTY_RANGE = {
  min: 0,
  max: 250,
  step: 5,
} as const;

export const TIEBREAKER_LABELS = {
  lowestPoints: "Lowest Points",
  highestPoints: "Highest Points",
  fewestSkips: "Fewest Skips",
  mostSkipped: "Most Skipped",
  fewestWilds: "Fewest Wilds",
  roundsWon: "Rounds Won",
} satisfies Record<GameTiebreaker, string>;

export const TIEBREAKER_OPTIONS: ReadonlyArray<{ value: GameTiebreaker; label: string }> =
  TIEBREAKER_VALUES.map((value) => ({ value, label: TIEBREAKER_LABELS[value] }));

function isGameTiebreaker(value: string | undefined): value is GameTiebreaker {
  return typeof value && TIEBREAKER_VALUES.includes(value as GameTiebreaker);
}

export function normalizeGameSettings(settings?: Partial<GameSettings>): GameSettings {
  return {
    inOrderPhases: settings?.inOrderPhases !== false,
    tiebreaker: isGameTiebreaker(settings?.tiebreaker)
      ? settings.tiebreaker
      : DEFAULT_GAME_SETTINGS.tiebreaker,
    roundSkipPenalty: normalizeGamePenalty(
      settings?.roundSkipPenalty,
      DEFAULT_GAME_SETTINGS.roundSkipPenalty,
    ),
    sitOutPenalty: normalizeGamePenalty(
      settings?.sitOutPenalty,
      DEFAULT_GAME_SETTINGS.sitOutPenalty,
    ),
  };
}

export function normalizeGamePenalty(value: unknown, defaultValue: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < GAME_PENALTY_RANGE.min) {
    return defaultValue;
  }

  const clampedValue = Math.min(GAME_PENALTY_RANGE.max, value);
  const roundedValue = Math.round(clampedValue / GAME_PENALTY_RANGE.step) * GAME_PENALTY_RANGE.step;
  return Math.min(GAME_PENALTY_RANGE.max, Math.max(GAME_PENALTY_RANGE.min, roundedValue));
}
