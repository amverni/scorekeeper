import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AddGenericRoundInput,
  CreateGenericGameInput,
  DeleteGenericRoundInput,
  EditGenericRoundInput,
  GameId,
  GenericRoundId,
} from "../../types";
import { genericGamesApi } from "../api/genericGames";
import { genericRoundsApi } from "../api/genericRounds";
import { playerKeys } from "./usePlayers";

export const genericGameKeys = {
  all: ["games", "generic"] as const,
  lists: () => [...genericGameKeys.all, "list"] as const,
  active: () => [...genericGameKeys.lists(), "active"] as const,
  list: (activeOnly: boolean) => [...genericGameKeys.lists(), "rows", { activeOnly }] as const,
  details: () => [...genericGameKeys.all, "detail"] as const,
  detail: (id: GameId) => [...genericGameKeys.details(), id] as const,
  scoreboard: (id: GameId) => [...genericGameKeys.detail(id), "scoreboard"] as const,
  editor: (id: GameId) => [...genericGameKeys.detail(id), "editor"] as const,
  roundEditor: (id: GameId, roundId: GenericRoundId) =>
    [...genericGameKeys.detail(id), "round-editor", roundId] as const,
};

export function genericGameEditorOptions(id: GameId) {
  return queryOptions({
    queryKey: genericGameKeys.editor(id),
    queryFn: () => genericGamesApi.getEditor(id),
    // Editors reread on entry so an unmounted editor cannot retain stale saved configuration.
    staleTime: 0,
    gcTime: 0,
  });
}

export function genericRoundEditorOptions(gameId: GameId, roundId: GenericRoundId) {
  return queryOptions({
    queryKey: genericGameKeys.roundEditor(gameId, roundId),
    queryFn: () => genericRoundsApi.getEditor(gameId, roundId),
    staleTime: 0,
    gcTime: 0,
  });
}

export function usePreviewGenericRoundEdit() {
  return useMutation({
    mutationFn: (input: EditGenericRoundInput) => genericRoundsApi.previewEdit(input),
  });
}

export function useEditGenericRound() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EditGenericRoundInput) => genericRoundsApi.edit(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: genericGameKeys.all }),
  });
}

export function useDeleteGenericRound() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteGenericRoundInput) => genericRoundsApi.delete(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: genericGameKeys.all }),
  });
}

export function genericGameScoreboardOptions(id: GameId) {
  return queryOptions({
    queryKey: genericGameKeys.scoreboard(id),
    queryFn: () => genericGamesApi.getScoreboard(id),
    enabled: !!id,
  });
}

export function useAddGenericRound() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddGenericRoundInput) => genericRoundsApi.add(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: genericGameKeys.all }),
  });
}

export function genericGameDetailOptions(id: GameId) {
  return queryOptions({
    queryKey: genericGameKeys.detail(id),
    queryFn: () => genericGamesApi.getDetail(id),
    enabled: !!id,
  });
}

export function activeGenericGamesOptions() {
  return queryOptions({
    queryKey: genericGameKeys.active(),
    queryFn: () => genericGamesApi.getActiveViews(),
  });
}

export function genericGameListOptions(activeOnly = false) {
  return queryOptions({
    queryKey: genericGameKeys.list(activeOnly),
    queryFn: () => genericGamesApi.getList({ activeOnly }),
  });
}

export function useCreateGenericGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGenericGameInput) => genericGamesApi.create(input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: genericGameKeys.all }),
        queryClient.invalidateQueries({ queryKey: playerKeys.all }),
      ]),
  });
}

export function useDeleteGenericGame() {
  return useGenericGameDeletion((id) => genericGamesApi.delete(id));
}

export function useDeleteEmptyGenericGame() {
  return useGenericGameDeletion((id) => genericGamesApi.deleteEmpty(id), true);
}

function useGenericGameDeletion(remove: (id: GameId) => Promise<void>, refreshAfterError = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: remove,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: genericGameKeys.all }),
        queryClient.invalidateQueries({ queryKey: playerKeys.all }),
      ]),
    onError: refreshAfterError
      ? () => queryClient.invalidateQueries({ queryKey: genericGameKeys.all })
      : undefined,
  });
}

export function useFinishGenericGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: GameId) => genericGamesApi.finish(id),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: genericGameKeys.all }),
        queryClient.invalidateQueries({ queryKey: playerKeys.all }),
      ]),
  });
}
