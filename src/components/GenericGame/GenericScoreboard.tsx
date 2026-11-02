import { Check, Plus, X } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import type {
  GenericRoundId,
  GenericScoreboardView,
  GenericScoreTotal,
  PlayerId,
} from "../../types";
import { ScoreboardPlayerName } from "../Scoreboard/ScoreboardPlayerName";
import { GenericScorecardRoundDeletion } from "../Scoreboard/ScorecardRoundDeletion";
import { ScorecardRow } from "../Scoreboard/ScorecardRow";
import { ScorecardRowActions } from "../Scoreboard/ScorecardRowActions";
import { useScorecardHold } from "../Scoreboard/useScorecardHold";
import { useScorecardRowMotion } from "../Scoreboard/useScorecardRowMotion";
import { Button, DealerMarker } from "../ui";
import { GenericAddRoundDialog } from "./GenericAddRoundDialog";
import { GenericEditRoundDialog } from "./GenericEditRoundDialog";
import { GenericPassFailRoundDialog } from "./GenericPassFailRoundDialog";
import { PassFailOutcome } from "./PassFailOutcome";
import "../Scoreboard/scoreboard.css";
import "./genericScoreboard.css";

function primaryTotal(score: GenericScoreTotal) {
  return "totalPoints" in score
    ? score.totalPoints
    : "totalWins" in score
      ? score.totalWins
      : score.totalPasses;
}

export function GenericScoreboard({ view }: { view: GenericScoreboardView }) {
  const [addOpen, setAddOpen] = useState(false);
  const [namesExpanded, setNamesExpanded] = useState(false);
  const [expandedRound, setExpandedRound] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GenericRoundId | null>(null);
  const [editTarget, setEditTarget] = useState<{
    roundId: GenericRoundId;
    playerId?: PlayerId;
    metric?: "Tiebreaker";
  } | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  useScorecardRowMotion(rootRef);
  const resultsId = useId();
  useScorecardHold(rootRef, (cell, origin) => {
    if (view.game.status !== "active") return;
    const round = view.rounds.find((round) => String(round.roundNumber) === cell.dataset.holdRound);
    if (!round?.id) return;
    const player = view.players.find((player) => player.id === cell.dataset.holdPlayer);
    setEditTarget({
      roundId: round.id,
      playerId: player?.id,
      metric: origin.closest("[data-hold-tiebreaker]") ? "Tiebreaker" : undefined,
    });
  });

  useEffect(() => {
    if (expandedRound === null || addOpen || editTarget) return;
    const collapseOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setExpandedRound(null);
      }
    };
    document.addEventListener("pointerdown", collapseOutside);
    return () => document.removeEventListener("pointerdown", collapseOutside);
  }, [expandedRound, addOpen, editTarget]);

  function toggleRound(roundNumber: number) {
    setExpandedRound((previous) => (previous === roundNumber ? null : roundNumber));
  }

  const metric =
    view.game.settings.mode === "points"
      ? "Points"
      : view.game.settings.mode === "singleRoundWinner"
        ? "Wins"
        : "Passes";
  const entryClasses = [
    "scoreboard-entry generic-scoreboard-entry",
    view.game.settings.dealer ? "" : "generic-scoreboard-entry--without-dealer",
  ].join(" ");

  return (
    <>
      <section
        ref={rootRef}
        aria-label="Scoreboard"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Native scroll regions need focus for keyboard scrolling.
        tabIndex={0}
        className="scoreboard-scroller glass relative min-h-0 overflow-auto rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-secondary"
        style={{ "--player-count": view.players.length } as CSSProperties}
      >
        <table className="scoreboard generic-scoreboard w-full text-center">
          <caption className="sr-only">
            {metric === "Wins" ? "Rounds Won" : metric} scoreboard
          </caption>
          <thead>
            <tr>
              <th scope="col" className="scoreboard-cell scoreboard-cell--sticky-corner">
                <span className="sr-only">Round</span>
              </th>
              {view.players.map((player, index) => (
                <th
                  key={player.id}
                  scope="col"
                  className={[
                    "scoreboard-cell scoreboard-cell--sticky-top",
                    index === view.players.length - 1 ? "scoreboard-cell--last-col" : "",
                    view.upcomingDealerId === player.id ? "scoreboard-cell--upcoming-dealer" : "",
                    view.withdrawnPlayers.includes(player.id) ? "scoreboard-cell--withdrawn" : "",
                  ].join(" ")}
                >
                  {view.upcomingDealerId === player.id && (
                    <span className="sr-only">Upcoming Round Dealer</span>
                  )}
                  <div className="flex w-full min-w-0 flex-col items-center gap-1">
                    <ScoreboardPlayerName
                      player={player}
                      expanded={namesExpanded}
                      onToggle={() => setNamesExpanded((previous) => !previous)}
                    />
                    <span
                      className={[
                        "scoreboard-number text-2xl font-medium leading-none tabular-nums",
                        view.withdrawnPlayers.includes(player.id)
                          ? "text-text-secondary"
                          : "text-text-primary",
                      ].join(" ")}
                    >
                      <span className="sr-only">Total {metric}: </span>
                      {primaryTotal(player)}
                    </span>
                    {"totalTiebreaker" in player && player.totalTiebreaker !== undefined && (
                      <span className="scoreboard-number text-sm font-normal leading-none text-text-secondary tabular-nums">
                        <span className="sr-only">Total Tiebreaker: </span>
                        {player.totalTiebreaker}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rounds.map((round, roundIndex) => (
              <ScorecardRow
                as="tr"
                key={round.id ?? round.roundNumber}
                roundNumber={round.roundNumber}
              >
                <th
                  scope="row"
                  data-action-round={
                    view.game.status === "active" && round.id ? round.roundNumber : undefined
                  }
                  className={[
                    "scoreboard-cell scoreboard-cell--sticky-left scoreboard-cell--anchor-top",
                    roundIndex === view.rounds.length - 1 ? "scoreboard-cell--last-row" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    data-hold-round={
                      view.game.status === "active" && round.id ? round.roundNumber : undefined
                    }
                    aria-label={`${expandedRound === round.roundNumber ? "Collapse" : "Expand"} Round ${round.roundNumber}`}
                    aria-expanded={expandedRound === round.roundNumber}
                    onClick={() => toggleRound(round.roundNumber)}
                    className="generic-scoreboard-control"
                  >
                    <span className="text-base font-medium leading-none text-text-secondary tabular-nums">
                      {round.roundNumber}
                    </span>
                  </button>
                </th>
                {view.players.map((player, index) => {
                  const score = round.scores.find(({ playerId }) => playerId === player.id);
                  if (!score) {
                    return (
                      <td
                        key={player.id}
                        data-action-round={
                          view.game.status === "active" && round.id ? round.roundNumber : undefined
                        }
                        aria-label={`${player.name}, Round ${round.roundNumber}: Did not play`}
                        className={[
                          "scoreboard-cell scoreboard-cell--anchor-top",
                          index === view.players.length - 1 ? "scoreboard-cell--last-col" : "",
                          roundIndex === view.rounds.length - 1 ? "scoreboard-cell--last-row" : "",
                        ].join(" ")}
                      />
                    );
                  }
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: The round control is the keyboard equivalent of this enlarged pointer target.
                    <td
                      key={score.playerId}
                      data-action-round={
                        view.game.status === "active" && round.id ? round.roundNumber : undefined
                      }
                      data-hold-round={
                        view.game.status === "active" && round.id ? round.roundNumber : undefined
                      }
                      data-hold-player={score.playerId}
                      onClick={() => toggleRound(round.roundNumber)}
                      aria-label={`${view.players[index].name}, Round ${round.roundNumber}: ${"points" in score ? `${score.points} Points${score.tiebreaker !== undefined ? `, ${score.tiebreaker} Tiebreaker` : ""}` : "passed" in score ? (score.passed ? "Passed" : "Failed") : score.won ? "Won" : "Lost"}${round.dealerId === score.playerId ? ", Dealer" : ""}`}
                      aria-describedby={
                        expandedRound === round.roundNumber
                          ? `${resultsId}-${round.roundNumber}-${index}`
                          : undefined
                      }
                      className={[
                        "scoreboard-cell scoreboard-cell--anchor-top cursor-pointer tabular-nums",
                        index === view.players.length - 1 ? "scoreboard-cell--last-col" : "",
                        roundIndex === view.rounds.length - 1 ? "scoreboard-cell--last-row" : "",
                      ].join(" ")}
                    >
                      <div className={entryClasses}>
                        {round.dealerId === score.playerId && (
                          <DealerMarker className="scoreboard-entry__dealer" />
                        )}
                        <div className="scoreboard-entry__value flex flex-col items-center gap-1 text-base font-medium leading-none [&>svg]:size-4">
                          {"passed" in score ? (
                            <PassFailOutcome passed={score.passed} />
                          ) : "points" in score ? (
                            <>
                              <span className="scoreboard-number">{score.points}</span>
                              {score.tiebreaker !== undefined && (
                                <span
                                  data-hold-tiebreaker
                                  className="scoreboard-number text-sm font-normal leading-none text-text-secondary"
                                >
                                  {score.tiebreaker}
                                </span>
                              )}
                            </>
                          ) : score.won ? (
                            <Check className="mx-auto size-5 text-pt-green-500" aria-hidden />
                          ) : (
                            <X className="mx-auto size-5 text-pt-red-500" aria-hidden />
                          )}
                        </div>
                      </div>
                      <div
                        id={`${resultsId}-${round.roundNumber}-${index}`}
                        className={[
                          "scoreboard-extras",
                          expandedRound === round.roundNumber ? "scoreboard-extras--open" : "",
                        ].join(" ")}
                        aria-hidden={expandedRound !== round.roundNumber}
                        inert={expandedRound !== round.roundNumber}
                      >
                        <div className="text-xs leading-none text-text-secondary/70">
                          <span
                            aria-hidden
                            className="my-0.5 h-px w-3/4 shrink-0 bg-text-secondary/70"
                          />
                          <span className="scoreboard-number">
                            <span className="sr-only">Accumulated {metric}: </span>
                            {primaryTotal(score)}
                          </span>
                          {"totalTiebreaker" in score && score.totalTiebreaker !== undefined && (
                            <span className="scoreboard-number">
                              <span className="sr-only">Accumulated Tiebreaker: </span>
                              {score.totalTiebreaker}
                            </span>
                          )}
                        </div>
                      </div>
                      {expandedRound === round.roundNumber &&
                        view.game.status === "active" &&
                        round.id && (
                          <Button
                            type="button"
                            aria-label={`Edit Round ${round.roundNumber} for ${view.players[index].name}`}
                            className="scorecard-edit text-xs"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (round.id) {
                                setEditTarget({
                                  roundId: round.id,
                                  playerId: score.playerId,
                                });
                              }
                            }}
                          >
                            Edit
                          </Button>
                        )}
                    </td>
                  );
                })}
              </ScorecardRow>
            ))}
            {view.game.status === "active" && (
              <tr>
                <th
                  scope="row"
                  className="scoreboard-cell scoreboard-cell--sticky-left scoreboard-cell--dashed scoreboard-cell--last-row"
                >
                  <button
                    type="button"
                    aria-label="Add Round"
                    onClick={() => setAddOpen(true)}
                    className="generic-scoreboard-control"
                  >
                    <span className="inline-flex size-5 items-center justify-center rounded-full border-[1.5px] border-text-secondary/60 text-text-secondary">
                      <Plus className="size-3.5" aria-hidden />
                    </span>
                  </button>
                </th>
                {view.players.map((player, index) => (
                  <td
                    key={player.id}
                    aria-label={`${player.name}, upcoming Round${view.upcomingDealerId === player.id ? ": Dealer" : ""}`}
                    className={[
                      "scoreboard-cell scoreboard-cell--dashed scoreboard-cell--last-row",
                      index === view.players.length - 1 ? "scoreboard-cell--last-col" : "",
                    ].join(" ")}
                  >
                    <div className={entryClasses}>
                      {view.upcomingDealerId === player.id && (
                        <DealerMarker className="scoreboard-entry__dealer opacity-60" />
                      )}
                      <span aria-hidden className="scoreboard-entry__value" />
                    </div>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        <ScorecardRowActions
          rootRef={rootRef}
          enabled={view.game.status === "active" && !addOpen && !editTarget}
          confirming={deleteTarget !== null}
          onDelete={(roundNumber) => {
            const round = view.rounds.find((round) => round.roundNumber === roundNumber);
            if (round?.id) setDeleteTarget(round.id);
          }}
        />
      </section>
      {deleteTarget && (
        <GenericScorecardRoundDeletion
          gameId={view.game.id}
          roundId={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {view.game.status === "active" &&
        (view.game.settings.mode === "passFail" ? (
          <GenericPassFailRoundDialog
            open={addOpen}
            onClose={setAddOpen}
            gameId={view.game.id}
            players={view.eligiblePlayers}
          />
        ) : (
          <GenericAddRoundDialog
            open={addOpen}
            onClose={setAddOpen}
            gameId={view.game.id}
            players={view.eligiblePlayers}
            mode={view.game.settings.mode}
            tiebreakerEnabled={
              view.game.settings.mode === "points" && view.game.settings.tiebreaker !== null
            }
          />
        ))}
      {editTarget && view.game.status === "active" && (
        <GenericEditRoundDialog
          key={editTarget.roundId}
          gameId={view.game.id}
          roundId={editTarget.roundId}
          focusPlayerId={editTarget.playerId}
          focusMetric={editTarget.metric}
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  );
}
