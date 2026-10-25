import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ArrayAtLeastOne,
  CompletedGame,
  DeletePhaseRoundInput,
  EditPhaseRoundInput,
  GameId,
  PlayerId,
  Round,
  RoundScore,
} from "../../types";
import { gamesApi } from "../api/games";
import { roundsApi } from "../api/rounds";
import { gameKeys } from "./useGames";
import { phaseSetKeys } from "./usePhaseSets";
import { phaseKeys } from "./usePhases";

type AddRoundScoreInput = Omit<RoundScore, "currentPhase">;

export const roundKeys = {
  all: ["rounds"] as const,
  lists: () => [...roundKeys.all, "phase10", "list"] as const,
  list: (gameId: GameId) => [...roundKeys.lists(), gameId] as const,
  editor: (gameId: GameId, roundNumber: number) =>
    [...roundKeys.list(gameId), "editor", roundNumber] as const,
};

export function phaseRoundEditorOptions(gameId: GameId, roundNumber: number) {
  return queryOptions({
    queryKey: roundKeys.editor(gameId, roundNumber),
    queryFn: () => gamesApi.getRoundEditor(gameId, roundNumber),
    staleTime: 0,
    gcTime: 0,
  });
}

export function usePreviewPhaseRoundEdit() {
  return useMutation({
    mutationFn: (input: EditPhaseRoundInput) => gamesApi.previewRoundEdit(input),
  });
}

export function useEditPhaseRound() {
  const callbacks = usePhaseRoundMutationCallbacks();
  return useMutation({
    mutationFn: (input: EditPhaseRoundInput) => gamesApi.editRound(input),
    ...callbacks,
  });
}

export function useDeletePhaseRound() {
  const callbacks = usePhaseRoundMutationCallbacks();
  return useMutation({
    mutationFn: (input: DeletePhaseRoundInput) => gamesApi.deleteRound(input),
    ...callbacks,
  });
}

function usePhaseRoundMutationCallbacks() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: roundKeys.all }),
      queryClient.invalidateQueries({ queryKey: gameKeys.all }),
    ]);
  return {
    onSuccess: async (
      result:
        | { outcome: "gameCompleted"; completedGame: CompletedGame }
        | { outcome: "roundEdited" | "roundDeleted" },
    ) => {
      if (result.outcome === "gameCompleted") {
        queryClient.setQueryData(gameKeys.detail(result.completedGame.id), result.completedGame);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: phaseKeys.all }),
          queryClient.invalidateQueries({ queryKey: phaseSetKeys.all }),
        ]);
      }
      await refresh();
    },
    onError: refresh,
  };
}

export function roundsListOptions(gameId: GameId) {
  return queryOptions({
    queryKey: roundKeys.list(gameId),
    queryFn: () => roundsApi.getByGameId(gameId),
    enabled: !!gameId,
  });
}

export function useAddRound(gameId: GameId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      expectedRoundNumber: number;
      scores: ArrayAtLeastOne<AddRoundScoreInput>;
      roundWinnerId: PlayerId | null;
      expectedVersion: string;
    }) => roundsApi.add({ gameId, ...data }),
    onSuccess: async (result) => {
      queryClient.setQueryData(roundKeys.list(gameId), (current: Round[] | undefined) => {
        if (!current) return current;
        return [
          ...current.filter((round) => round.roundNumber !== result.round.roundNumber),
          result.round,
        ].sort((a, b) => a.roundNumber - b.roundNumber);
      });
      if (result.outcome === "gameCompleted") {
        queryClient.setQueryData(gameKeys.detail(gameId), result.completedGame);
        queryClient.invalidateQueries({ queryKey: phaseKeys.all });
        queryClient.invalidateQueries({ queryKey: phaseSetKeys.all });
      }
      // Adding a round bumps the game's `lastActivityAt`, so re-sort the home list.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: roundKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: gameKeys.all }),
      ]);
    },
    onError: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: roundKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: gameKeys.all }),
      ]),
  });
}
