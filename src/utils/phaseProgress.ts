import type {
  GamePhaseOccurrenceId,
  PhaseSelectionAvailability,
  PhaseStatus,
  PlayerProgress,
  RoundScore,
} from "../types";

export function getInitialPlayerProgress(
  selectableTotalPhases?: number,
  requiredPhases?: readonly number[],
): PlayerProgress {
  const firstPhase = requiredPhases?.[0] ?? 1;
  return {
    currentPhase: firstPhase,
    isFinished: false,
    standingValue: selectableTotalPhases === undefined ? firstPhase : 0,
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
  selectedPhaseOccurrenceId,
  result,
  totalPhases,
  availability,
  counted = true,
}: {
  selectedPhase: number | undefined;
  selectedPhaseOccurrenceId?: GamePhaseOccurrenceId;
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
    selectedPhaseOccurrenceId !== undefined &&
    availability.phaseOccurrenceIds?.[selectedPhase - 1] !== selectedPhaseOccurrenceId
  ) {
    return "The selected occurrence is a Removed Phase or has moved. Choose a Remaining Phase.";
  }
  if (
    selectedPhase !== availability.recordedPhase &&
    availability.removedPhases?.includes(selectedPhase)
  ) {
    return `Phase ${selectedPhase} is a Removed Phase. Choose a Remaining Phase.`;
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
  requiredPhases?: readonly number[],
): PlayerProgress {
  if (previousProgress.isFinished) return previousProgress;

  const advances = phaseStatusAdvances(score.phaseStatus);
  if (previousProgress.selectable) {
    const resolvedPhases = [...previousProgress.selectable.resolvedPhases];
    if (advances && !resolvedPhases.includes(score.currentPhase)) {
      resolvedPhases.push(score.currentPhase);
      resolvedPhases.sort((a, b) => a - b);
    }
    let currentPhase = requiredPhases?.[0] ?? 1;
    if (requiredPhases) {
      currentPhase =
        requiredPhases.find((phase) => !resolvedPhases.includes(phase)) ??
        requiredPhases.at(-1) ??
        currentPhase;
    } else {
      while (currentPhase < totalPhases && resolvedPhases.includes(currentPhase)) currentPhase++;
    }
    const requiredCount = requiredPhases?.length ?? totalPhases;
    return {
      currentPhase,
      isFinished: resolvedPhases.length === requiredCount,
      standingValue: resolvedPhases.length,
      selectable: { resolvedPhases, totalPhases: requiredCount },
    };
  }
  const attemptedPhase = Math.max(score.currentPhase, previousProgress.currentPhase);
  const nextPhase = requiredPhases
    ? (requiredPhases.find((phase) =>
        advances ? phase > attemptedPhase : phase >= attemptedPhase,
      ) ?? totalPhases + 1)
    : advances
      ? attemptedPhase + 1
      : attemptedPhase;
  const lastPhase = requiredPhases?.at(-1) ?? totalPhases;
  const currentPhase = Math.min(Math.max(nextPhase, 1), lastPhase);
  const isFinished = nextPhase > lastPhase;

  return {
    currentPhase,
    isFinished,
    standingValue: isFinished ? totalPhases + 1 : currentPhase,
  };
}
