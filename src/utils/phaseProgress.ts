import type { PhaseStatus, PlayerProgress, RoundScore } from "../types";

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
