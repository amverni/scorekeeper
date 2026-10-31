import type { PhaseSelectionAvailability, PhaseStatus, PlayerProgress, RoundScore } from "../types";

export function getInitialPlayerProgress(selectableTotalPhases?: number): PlayerProgress {
  return {
    currentPhase: 1,
    isFinished: false,
    standingValue: selectableTotalPhases === undefined ? 1 : 0,
    ...(selectableTotalPhases === undefined
      ? {}
      : { selectable: { resolvedPhases: [], totalPhases: selectableTotalPhases } }),
  };
}

export function phaseStatusAdvances(phaseStatus: PhaseStatus): boolean {
  return phaseStatus === "completed" || phaseStatus === "skipped";
}

export function getSelectedPhaseError({
  selectedPhase,
  result,
  totalPhases,
  availability,
  counted = true,
}: {
  selectedPhase: number | undefined;
  result: PhaseStatus | null;
  totalPhases: number;
  availability: PhaseSelectionAvailability;
  counted?: boolean;
}): string | null {
  if (
    selectedPhase === undefined ||
    !Number.isSafeInteger(selectedPhase) ||
    selectedPhase < 1 ||
    selectedPhase > totalPhases
  ) {
    return "Choose a valid Phase Number.";
  }
  if (
    counted &&
    result !== null &&
    phaseStatusAdvances(result) &&
    availability.resolvedElsewhere.includes(selectedPhase)
  ) {
    return `Phase ${selectedPhase} is already resolved in another Round. Choose a Remaining Phase.`;
  }
  if (
    selectedPhase !== availability.recordedPhase &&
    availability.resolvedBeforeRound.includes(selectedPhase)
  ) {
    return `Phase ${selectedPhase} was resolved before this Round. Choose a Remaining Phase.`;
  }
  return null;
}

export function getNextCurrentPhase(
  previousScore: Pick<RoundScore, "currentPhase" | "phaseStatus"> | undefined,
  totalPhases: number,
): number {
  if (!previousScore) return 1;

  const nextPhase = phaseStatusAdvances(previousScore.phaseStatus)
    ? previousScore.currentPhase + 1
    : previousScore.currentPhase;
  return Math.min(Math.max(nextPhase, 1), totalPhases);
}

export function getProgressAfterScore(
  score: RoundScore,
  previousProgress: PlayerProgress,
  totalPhases: number,
): PlayerProgress {
  if (previousProgress.isFinished) return previousProgress;

  const advances = phaseStatusAdvances(score.phaseStatus);
  if (previousProgress.selectable) {
    const resolvedPhases = [...previousProgress.selectable.resolvedPhases];
    if (advances && !resolvedPhases.includes(score.currentPhase)) {
      resolvedPhases.push(score.currentPhase);
      resolvedPhases.sort((a, b) => a - b);
    }
    let currentPhase = 1;
    while (currentPhase < totalPhases && resolvedPhases.includes(currentPhase)) currentPhase++;
    return {
      currentPhase,
      isFinished: resolvedPhases.length === totalPhases,
      standingValue: resolvedPhases.length,
      selectable: { resolvedPhases, totalPhases },
    };
  }
  const attemptedPhase = Math.max(score.currentPhase, previousProgress.currentPhase);
  const nextPhase = advances ? attemptedPhase + 1 : attemptedPhase;
  const currentPhase = Math.min(Math.max(nextPhase, 1), totalPhases);
  const isFinished = nextPhase > totalPhases;

  return {
    currentPhase,
    isFinished,
    standingValue: isFinished ? totalPhases + 1 : currentPhase,
  };
}
