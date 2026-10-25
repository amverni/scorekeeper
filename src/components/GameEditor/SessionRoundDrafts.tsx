import { createContext, type ReactNode, useContext, useState } from "react";
import type { GameId, PlayerId } from "../../types";
import type { AddRoundDraft } from "../Scoreboard/addRoundDraft";

export interface GenericEntryValues {
  scores: Array<{ playerId: PlayerId; points: string; tiebreaker: string }>;
  winnerId: PlayerId | null;
}

export interface PassFailEntryValues {
  scores: Array<{ playerId: PlayerId; passed: boolean }>;
}

interface SessionRoundDrafts {
  phase: Map<GameId, { draft: AddRoundDraft; selectedPlayerId: PlayerId | null }>;
  generic: Map<GameId, { values: GenericEntryValues; selectedPlayerId: PlayerId | null }>;
  passFail: Map<GameId, PassFailEntryValues>;
}

const RoundDraftsContext = createContext<SessionRoundDrafts | null>(null);

export function SessionRoundDraftsProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState<SessionRoundDrafts>(() => ({
    phase: new Map(),
    generic: new Map(),
    passFail: new Map(),
  }));
  return <RoundDraftsContext.Provider value={drafts}>{children}</RoundDraftsContext.Provider>;
}

export function useSessionRoundDrafts() {
  const drafts = useContext(RoundDraftsContext);
  if (!drafts) throw new Error("Round drafts require SessionRoundDraftsProvider.");
  return drafts;
}
