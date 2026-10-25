import { useForm, useStore } from "@tanstack/react-form";
import type { GameSettings, PhaseStatus, PlayerId, PlayerIdentity } from "../../types";
import * as draftHelpers from "./addRoundDraft";

export interface UseAddRoundDraft {
  draft: draftHelpers.AddRoundDraft;
  setResult: (playerId: PlayerId, result: PhaseStatus) => void;
  setScore: (playerId: PlayerId, score: number) => void;
  incrementQuick: (playerId: PlayerId, button: draftHelpers.PointsQuickButtonId) => void;
  decrementQuick: (playerId: PlayerId, button: draftHelpers.PointsQuickButtonId) => void;
  resetQuick: (playerId: PlayerId) => void;
  setExpandedSecondary: (playerId: PlayerId, expanded: boolean) => void;
  setRoundWinner: (playerId: PlayerId) => void;
  clearRoundWinner: () => void;
  reset: () => void;
}

const POINTS_MAX = 250;

export function useAddRoundDraft(
  players: PlayerIdentity[],
  settings: GameSettings,
  initialDraft?: draftHelpers.AddRoundDraft,
): UseAddRoundDraft {
  const form = useForm({
    defaultValues: { draft: initialDraft ?? draftHelpers.createInitialDraft(players) },
  });
  const stored = useStore(form.store, (state) => state.values.draft);
  const currentDraft = (): draftHelpers.AddRoundDraft => {
    const saved = form.state.values.draft;
    return {
      players: [
        ...saved.players,
        ...draftHelpers
          .createInitialDraft(players)
          .players.filter(
            (player) => !saved.players.some((entry) => entry.playerId === player.playerId),
          ),
      ],
      roundWinnerId: saved.roundWinnerId,
    };
  };

  const setNextDraft = (nextDraft: draftHelpers.AddRoundDraft) => {
    form.setFieldValue("draft", nextDraft);
  };

  return {
    draft: {
      players: draftHelpers
        .createInitialDraft(players)
        .players.map(
          (player) => stored.players.find((entry) => entry.playerId === player.playerId) ?? player,
        ),
      roundWinnerId: stored.roundWinnerId,
    },
    setResult: (playerId, result) => {
      setNextDraft(draftHelpers.applyResult(currentDraft(), playerId, result, settings));
    },
    setScore: (playerId, score) => {
      setNextDraft(draftHelpers.applyScore(currentDraft(), playerId, score, settings));
    },
    incrementQuick: (playerId, button) => {
      setNextDraft(draftHelpers.applyQuickIncrement(currentDraft(), playerId, button, POINTS_MAX));
    },
    decrementQuick: (playerId, button) => {
      setNextDraft(draftHelpers.applyQuickDecrement(currentDraft(), playerId, button));
    },
    resetQuick: (playerId) => {
      setNextDraft(draftHelpers.applyQuickReset(currentDraft(), playerId));
    },
    setExpandedSecondary: (playerId, expanded) => {
      setNextDraft(draftHelpers.applyExpandedSecondary(currentDraft(), playerId, expanded));
    },
    setRoundWinner: (playerId) => {
      setNextDraft(draftHelpers.applyRoundWinner(currentDraft(), playerId, settings));
    },
    clearRoundWinner: () => {
      setNextDraft(draftHelpers.applyClearRoundWinner(currentDraft(), settings));
    },
    reset: () => {
      form.reset({ draft: draftHelpers.createInitialDraft(players) });
    },
  };
}
