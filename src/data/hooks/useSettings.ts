import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GameTiebreaker, PhaseSetId } from "../../types";
import { settingsApi } from "../api/settings";

export const settingsKeys = {
  all: ["settings"] as const,
  detail: () => [...settingsKeys.all, "detail"] as const,
};

export function appSettingsOptions() {
  return queryOptions({
    queryKey: settingsKeys.detail(),
    queryFn: () => settingsApi.get(),
  });
}

export function useSetDefaultTiebreaker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: settingsKeys.all,
    mutationFn: (tiebreaker: GameTiebreaker) => settingsApi.setDefaultTiebreaker(tiebreaker),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

export function useSetDefaultInOrderPhases() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: settingsKeys.all,
    mutationFn: (inOrderPhases: boolean) => settingsApi.setDefaultInOrderPhases(inOrderPhases),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

export function useSetDefaultPhaseSetId() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: settingsKeys.all,
    mutationFn: (phaseSetId: PhaseSetId) => settingsApi.setDefaultPhaseSetId(phaseSetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

export function useSetDefaultRoundSkipPenalty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: settingsKeys.all,
    mutationFn: (value: number) => settingsApi.setDefaultRoundSkipPenalty(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

export function useSetDefaultSitOutPenalty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: settingsKeys.all,
    mutationFn: (value: number) => settingsApi.setDefaultSitOutPenalty(value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

export function useResetSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: settingsKeys.all,
    mutationFn: () => settingsApi.reset(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}
