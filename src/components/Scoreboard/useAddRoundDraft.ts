import { useRef, useState } from "react";
import type { GameId, GameSettings, PhaseStatus, PlayerId, PlayerIdentity } from "../../types";
import { useSessionRoundDrafts } from "../GameEditor/SessionRoundDrafts";
import * as draftHelpers from "./addRoundDraft";

export interface UseAddRoundDraft {
  draft: draftHelpers.AddRoundDraft;
  selectedPlayerId: PlayerId | null;
  selectPlayer: (playerId: PlayerId | null) => void;
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
  gameId: GameId,
  players: PlayerIdentity[],
  settings: GameSettings,
): UseAddRoundDraft {
  const drafts = useSessionRoundDrafts();
  const [draft, setDraft] = useState(
    () => drafts.phase.get(gameId)?.draft ?? draftHelpers.createInitialDraft(players),
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState<PlayerId | null>(
    () => drafts.phase.get(gameId)?.selectedPlayerId ?? players[0]?.id ?? null,
  );
  const draftRef = useRef(draft);
  const initial = draftHelpers.createInitialDraft(players);
  const retainedDraft = {
    ...draft,
    players: [
      ...draft.players,
      ...initial.players.filter(
        (player) => !draft.players.some((entry) => entry.playerId === player.playerId),
      ),
    ],
  };
  draftRef.current = retainedDraft;

  const setNextDraft = (nextDraft: draftHelpers.AddRoundDraft) => {
    draftRef.current = nextDraft;
    drafts.phase.set(gameId, { draft: nextDraft, selectedPlayerId });
    setDraft(nextDraft);
  };

  return {
    draft: {
      ...retainedDraft,
      players: players.flatMap((player) =>
        retainedDraft.players.filter((entry) => entry.playerId === player.id),
      ),
    },
    selectedPlayerId,
    selectPlayer: (playerId) => {
      setSelectedPlayerId(playerId);
      drafts.phase.set(gameId, { draft: draftRef.current, selectedPlayerId: playerId });
    },
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
      setSelectedPlayerId(players[0]?.id ?? null);
      drafts.phase.delete(gameId);
    },
  };
}
