import { useEffect, useRef, useState } from "react";
import type { GameReadModel, PlayerId } from "../../types";
import { FirstFinisherDialog } from "../Game/FirstFinisherDialog";
import { AddRoundDialog } from "./AddRoundDialog";
import { EditRoundDialog } from "./EditRoundDialog";
import { GhostRow } from "./GhostRow";
import { RoundRow } from "./RoundRow";
import { ScoreboardHeader } from "./ScoreboardHeader";
import { PhaseScorecardRoundDeletion } from "./ScorecardRoundDeletion";
import { ScorecardRowActions } from "./ScorecardRowActions";
import { useAddRoundDraft } from "./useAddRoundDraft";
import { useScorecardHold } from "./useScorecardHold";
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
  const [editing, setEditing] = useState<{ roundNumber: number; focusPlayerId?: PlayerId } | null>(
    null,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    roundNumber: number;
    version: string;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useScorecardHold(rootRef, (cell) => {
    if (game.status !== "active") return;
    const round = rounds.find(
      (round) => String(round.source.roundNumber) === cell.dataset.holdRound,
    );
    if (!round) return;
    const player = players.find((player) => player.id === cell.dataset.holdPlayer);
    setEditing({ roundNumber: round.source.roundNumber, focusPlayerId: player?.id });
    setEditOpen(true);
  });

  // Outside-click collapses any expanded row. Use mousedown so it fires
  // before potential click handlers, and ignore events inside the grid.
  useEffect(() => {
    if (expandedRound === null || editing) return;
    const handler = (event: MouseEvent) => {
      const node = rootRef.current;
      if (!node) return;
      if (node.contains(event.target as Node)) return;
      setExpandedRound(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expandedRound, editing]);

  const tiebreaker = game.settings.tiebreaker;
  const isActive = game.status === "active";

  const showGhost = isActive && view.gameEndingRound === null;
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
                key={round.source.id ?? round.source.roundNumber}
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
                onEdit={
                  isActive
                    ? (focusPlayerId) => {
                        setEditing({ roundNumber: round.source.roundNumber, focusPlayerId });
                        setEditOpen(true);
                      }
                    : undefined
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
        <ScorecardRowActions
          rootRef={rootRef}
          enabled={isActive && !entryVisible && !editing && deleteTarget === null}
          onDelete={(roundNumber) => setDeleteTarget({ roundNumber, version: view.version })}
        />
      </section>
      {deleteTarget !== null && (
        <PhaseScorecardRoundDeletion
          gameId={game.id}
          roundNumber={deleteTarget.roundNumber}
          expectedVersion={deleteTarget.version}
          onClose={() => setDeleteTarget(null)}
          onGameCompleted={onGameCompleted}
        />
      )}

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
      {editing && (
        <EditRoundDialog
          gameId={game.id}
          {...editing}
          open={editOpen}
          onClose={setEditOpen}
          afterLeave={() => setEditing(null)}
          onGameCompleted={onGameCompleted}
        />
      )}
      <FirstFinisherDialog
        view={view}
        ready={!entryVisible && editing === null && deleteTarget === null}
        onGameCompleted={onGameCompleted}
      />
    </div>
  );
}
