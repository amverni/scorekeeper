import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ArrayAtLeastOne, GameId, PlayerId, Round, RoundScore } from "../../types";
import { roundsApi } from "../api/rounds";
import { gameKeys } from "./useGames";
import { phaseSetKeys } from "./usePhaseSets";
import { phaseKeys } from "./usePhases";

type AddRoundScoreInput = Omit<RoundScore, "currentPhase">;

export const roundKeys = {
  all: ["rounds"] as const,
  lists: () => [...roundKeys.all, "phase10", "list"] as const,
  list: (gameId: GameId) => [...roundKeys.lists(), gameId] as const,
};

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
      scores: ArrayAtLeastOne<AddRoundScoreInput>;
      roundWinnerId: PlayerId | null;
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
  });
}
