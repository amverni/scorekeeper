import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateGameInput, EditGamePlayersInput, Game, GameId } from "../../types";
import { gamesApi } from "../api/games";
import { phaseSetKeys } from "./usePhaseSets";
import { phaseKeys } from "./usePhases";
import { roundKeys } from "./useRounds";

export const gameKeys = {
  all: ["games"] as const,
  lists: () => [...gameKeys.all, "phase10", "list"] as const,
  active: () => [...gameKeys.lists(), "active"] as const,
  list: (activeOnly: boolean) => [...gameKeys.lists(), "rows", { activeOnly }] as const,
  details: () => [...gameKeys.all, "phase10", "detail"] as const,
  detail: (id: GameId) => [...gameKeys.details(), id] as const,
  view: (id: GameId) => [...gameKeys.detail(id), "view"] as const,
  editor: (id: GameId) => [...gameKeys.detail(id), "editor"] as const,
  phasePlayers: (id: GameId) => [...gameKeys.detail(id), "phasePlayers"] as const,
};

export function gameEditorOptions(id: GameId) {
  return queryOptions({
    queryKey: gameKeys.editor(id),
    queryFn: () => gamesApi.getEditor(id),
    // Editors reread on entry so an unmounted editor cannot retain stale saved configuration.
    staleTime: 0,
    gcTime: 0,
  });
}

export function gameDetailOptions(id: GameId) {
  return queryOptions({
    queryKey: gameKeys.detail(id),
    queryFn: async () => (await gamesApi.getById(id)) ?? null,
    enabled: !!id,
  });
}

export function gameViewOptions(id: GameId) {
  return queryOptions({
    queryKey: gameKeys.view(id),
    queryFn: () => gamesApi.getView(id),
    enabled: !!id,
  });
}

export function gamePhasePlayersOptions(id: GameId) {
  return queryOptions({
    queryKey: gameKeys.phasePlayers(id),
    queryFn: () => gamesApi.getPhasePlayers(id),
    enabled: !!id,
  });
}

export function activeGamesOptions() {
  return queryOptions({
    queryKey: gameKeys.active(),
    queryFn: () => gamesApi.getActive(),
  });
}

export function gameListOptions(activeOnly = false) {
  return queryOptions({
    queryKey: gameKeys.list(activeOnly),
    queryFn: () => gamesApi.getList({ activeOnly }),
  });
}

export function useCreateGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGameInput) => gamesApi.create(data),
    onSuccess: (game) => {
      queryClient.invalidateQueries({ queryKey: gameKeys.lists() });
      queryClient.setQueryData(gameKeys.detail(game.id), game);
    },
  });
}

export function usePreviewGameEdit() {
  return useMutation({
    mutationFn: (input: EditGamePlayersInput) => gamesApi.previewEdit(input),
  });
}

export function useEditGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EditGamePlayersInput) => gamesApi.edit(input),
    onSuccess: (game) => refreshGameCache(queryClient, game),
    onError: () => queryClient.invalidateQueries({ queryKey: gameKeys.all, refetchType: "none" }),
  });
}

export function useDeleteGame() {
  return useGameDeletion((id) => gamesApi.delete(id));
}

export function useDeleteEmptyGame() {
  return useGameDeletion((id) => gamesApi.deleteEmpty(id), true);
}

function useGameDeletion(remove: (id: GameId) => Promise<void>, refreshAfterError = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: remove,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: gameKeys.all }),
        queryClient.invalidateQueries({ queryKey: roundKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: phaseKeys.all }),
        queryClient.invalidateQueries({ queryKey: phaseSetKeys.all }),
      ]),
    onError: refreshAfterError
      ? () =>
          Promise.all([
            queryClient.invalidateQueries({ queryKey: gameKeys.all }),
            queryClient.invalidateQueries({ queryKey: roundKeys.lists() }),
          ])
      : undefined,
  });
}

export function useFinishGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: GameId) => gamesApi.finish(id),
    onSuccess: (game) => refreshGameCache(queryClient, game),
  });
}

export function useFinishChoice(id: GameId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ choice, token }: { choice: "continue" | "finish"; token: string }) =>
      gamesApi.resolveFinishChoice(id, choice, token),
    onSuccess: (game) => refreshGameCache(queryClient, game),
    onError: () => queryClient.invalidateQueries({ queryKey: gameKeys.all }),
  });
}

async function refreshGameCache(queryClient: QueryClient, game: Game) {
  queryClient.setQueryData(gameKeys.detail(game.id), game);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: gameKeys.all }),
    queryClient.invalidateQueries({ queryKey: roundKeys.all }),
    queryClient.invalidateQueries({ queryKey: phaseKeys.all }),
    queryClient.invalidateQueries({ queryKey: phaseSetKeys.all }),
  ]);
}
