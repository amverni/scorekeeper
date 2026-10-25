import { useRef, useState } from "react";
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
): UseAddRoundDraft {
  const [draft, setDraft] = useState(() => draftHelpers.createInitialDraft(players));
  const draftRef = useRef(draft);
  if (
    players.length !== draft.players.length ||
    players.some((player, index) => player.id !== draft.players[index]?.playerId)
  ) {
    const initial = draftHelpers.createInitialDraft(players);
    const nextDraft = {
      players: initial.players.map(
        (player) => draft.players.find((entry) => entry.playerId === player.playerId) ?? player,
      ),
      roundWinnerId: players.some((player) => player.id === draft.roundWinnerId)
        ? draft.roundWinnerId
        : null,
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  const setNextDraft = (nextDraft: draftHelpers.AddRoundDraft) => {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  };

  return {
    draft,
    setResult: (playerId, result) => {
      setNextDraft(draftHelpers.applyResult(draftRef.current, playerId, result, settings));
    },
    setScore: (playerId, score) => {
      setNextDraft(draftHelpers.applyScore(draftRef.current, playerId, score, settings));
    },
    incrementQuick: (playerId, button) => {
      setNextDraft(
        draftHelpers.applyQuickIncrement(draftRef.current, playerId, button, POINTS_MAX),
      );
    },
    decrementQuick: (playerId, button) => {
      setNextDraft(draftHelpers.applyQuickDecrement(draftRef.current, playerId, button));
    },
    resetQuick: (playerId) => {
      setNextDraft(draftHelpers.applyQuickReset(draftRef.current, playerId));
    },
    setExpandedSecondary: (playerId, expanded) => {
      setNextDraft(draftHelpers.applyExpandedSecondary(draftRef.current, playerId, expanded));
    },
    setRoundWinner: (playerId) => {
      setNextDraft(draftHelpers.applyRoundWinner(draftRef.current, playerId, settings));
    },
    clearRoundWinner: () => {
      setNextDraft(draftHelpers.applyClearRoundWinner(draftRef.current, settings));
    },
    reset: () => {
      setNextDraft(draftHelpers.createInitialDraft(players));
    },
  };
}
