import { useEffect, useRef, useState } from "react";
import type { GameReadModel } from "../../types";
import { FirstFinisherDialog } from "../Game/FirstFinisherDialog";
import { AddRoundDialog } from "./AddRoundDialog";
import { GhostRow } from "./GhostRow";
import { RoundRow } from "./RoundRow";
import { ScoreboardHeader } from "./ScoreboardHeader";
import { useAddRoundDraft } from "./useAddRoundDraft";
import "./scoreboard.css";

interface ScoreboardProps {
  view: GameReadModel;
  onGameCompleted?: () => void;
}

export function Scoreboard({ view, onGameCompleted }: ScoreboardProps) {
  const { game, rounds, players, playingPlayers } = view;
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [entryVisible, setEntryVisible] = useState(false);
  const [entryHistory, setEntryHistory] = useState({
    roundNumber: view.nextRoundNumber,
    version: view.version,
  });
  const [namesExpanded, setNamesExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside-click collapses any expanded row. Use mousedown so it fires
  // before potential click handlers, and ignore events inside the grid.
  useEffect(() => {
    if (expandedRound === null) return;
    const handler = (event: MouseEvent) => {
      const node = rootRef.current;
      if (!node) return;
      if (node.contains(event.target as Node)) return;
      setExpandedRound(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expandedRound]);

  const tiebreaker = game.settings.tiebreaker;
  const isActive = game.status === "active";

  const showGhost = isActive && !view.pendingFinishChoice && !view.automaticCompletion;
  const draft = useAddRoundDraft(game.id, playingPlayers, game.settings);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <section
        ref={rootRef}
        aria-label="Scoreboard"
        className="scoreboard-scroller glass relative min-h-0 max-h-full overflow-auto rounded-2xl"
      >
        <div
          className="scoreboard"
          style={
            {
              "--player-count": players.length,
              "--name-column-cap": players.length === 1 ? "calc(100cqw - 36px)" : "50cqw",
            } as React.CSSProperties
          }
        >
          <ScoreboardHeader
            players={players}
            namesExpanded={namesExpanded}
            onToggleNames={() => setNamesExpanded((previous) => !previous)}
            upcomingDealerId={view.upcomingDealerId}
            completed={!isActive}
          />

          {rounds.map((round, idx) => {
            const isLastRow = idx === rounds.length - 1;
            return (
              <RoundRow
                key={round.source.roundNumber}
                round={round}
                players={players}
                tiebreaker={tiebreaker}
                isExpanded={expandedRound === round.source.roundNumber}
                isLastRow={isLastRow}
                onToggle={() =>
                  setExpandedRound((prev) =>
                    prev === round.source.roundNumber ? null : round.source.roundNumber,
                  )
                }
              />
            );
          })}

          {showGhost && (
            <GhostRow
              nextRoundNumber={view.nextRoundNumber}
              dealerId={view.upcomingDealerId}
              players={players}
              onOpenAddRound={() => {
                setEntryHistory({ roundNumber: view.nextRoundNumber, version: view.version });
                setEntryVisible(true);
                setDialogOpen(true);
              }}
            />
          )}
        </div>
      </section>

      <AddRoundDialog
        open={dialogOpen}
        onClose={setDialogOpen}
        game={game}
        players={playingPlayers}
        draft={draft}
        nextRoundNumber={entryHistory.roundNumber}
        expectedVersion={entryHistory.version}
        onGameCompleted={onGameCompleted}
        afterLeave={() => setEntryVisible(false)}
      />
      <FirstFinisherDialog view={view} ready={!entryVisible} onGameCompleted={onGameCompleted} />
    </div>
  );
}
