import { Check, Plus, X } from "lucide-react";
import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  GenericRoundId,
  GenericScoreboardView,
  GenericScoreTotal,
  PlayerId,
} from "../../types";
import { ScoreboardPlayerName } from "../Scoreboard/ScoreboardPlayerName";
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
  const [editTarget, setEditTarget] = useState<{
    roundId: GenericRoundId;
    playerId: PlayerId;
  } | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const resultsId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reconnect the observer when saved Round DOM nodes change.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const columns = Array.from({ length: view.players.length }, (_, index) => {
      const entries = Array.from(
        root.querySelectorAll<HTMLElement>(`[data-scoreboard-column="${index}"]`),
      );
      const contents = entries.flatMap((entry) =>
        Array.from(entry.querySelector(".scoreboard-entry__value")?.children ?? []),
      );
      return { entries, contents };
    });
    const alignEntries = () => {
      // Measure glyphs, not their reserved slots, so setting widths cannot feed
      // back into the observer. Read every column before writing any styles.
      const widths = columns.map(({ contents }) =>
        Math.max(0, ...contents.map((element) => element.getBoundingClientRect().width)),
      );
      for (const [index, { entries }] of columns.entries()) {
        for (const entry of entries) {
          entry.style.setProperty("--entry-value-width", `${widths[index]}px`);
        }
      }
    };
    const observer = new ResizeObserver(alignEntries);
    for (const { contents } of columns) {
      for (const element of contents) observer.observe(element);
    }
    alignEntries();
    return () => observer.disconnect();
  }, [view.players.length, view.rounds]);

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
      >
        <table
          className="scoreboard generic-scoreboard w-full text-center"
          style={
            {
              "--player-count": view.players.length,
              "--name-column-cap": view.players.length === 1 ? "calc(100cqw - 36px)" : "50cqw",
            } as CSSProperties
          }
        >
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
                  ].join(" ")}
                >
                  {view.upcomingDealerId === player.id && (
                    <span className="sr-only">Upcoming Round Dealer</span>
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <ScoreboardPlayerName
                      player={player}
                      expanded={namesExpanded}
                      onToggle={() => setNamesExpanded((previous) => !previous)}
                    />
                    <span className="whitespace-nowrap text-2xl font-medium leading-none text-text-primary tabular-nums">
                      <span className="sr-only">Total {metric}: </span>
                      {primaryTotal(player)}
                    </span>
                    {"totalTiebreaker" in player && player.totalTiebreaker !== undefined && (
                      <span className="whitespace-nowrap text-sm font-normal leading-none text-text-secondary tabular-nums">
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
              <tr key={round.roundNumber}>
                <th
                  scope="row"
                  className={[
                    "scoreboard-cell scoreboard-cell--sticky-left scoreboard-cell--anchor-top",
                    roundIndex === view.rounds.length - 1 ? "scoreboard-cell--last-row" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
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
                {round.scores.map((score, index) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: The round control is the keyboard equivalent of this enlarged pointer target.
                  <td
                    key={score.playerId}
                    onClick={() => toggleRound(round.roundNumber)}
                    aria-label={`${view.players[index].name}, Round ${round.roundNumber}: ${"points" in score ? `${score.points} Points${score.tiebreaker !== undefined ? `, ${score.tiebreaker} Tiebreaker` : ""}` : "passed" in score ? (score.passed ? "Passed" : "Failed") : score.won ? "Won" : "Lost"}${round.dealerId === score.playerId ? ", Dealer" : ""}`}
                    aria-describedby={
                      expandedRound === round.roundNumber
                        ? `${resultsId}-${round.roundNumber}-${index}`
                        : undefined
                    }
                    className={[
                      "scoreboard-cell scoreboard-cell--anchor-top cursor-pointer whitespace-nowrap tabular-nums",
                      index === view.players.length - 1 ? "scoreboard-cell--last-col" : "",
                      roundIndex === view.rounds.length - 1 ? "scoreboard-cell--last-row" : "",
                    ].join(" ")}
                  >
                    <div className={entryClasses} data-scoreboard-column={index}>
                      {round.dealerId === score.playerId && (
                        <DealerMarker className="scoreboard-entry__dealer" />
                      )}
                      <div className="scoreboard-entry__value flex flex-col items-center gap-1 text-base font-medium leading-none [&>svg]:size-4">
                        {"passed" in score ? (
                          <PassFailOutcome passed={score.passed} />
                        ) : "points" in score ? (
                          <>
                            <span>{score.points}</span>
                            {score.tiebreaker !== undefined && (
                              <span className="text-sm font-normal leading-none text-text-secondary">
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
                    {expandedRound === round.roundNumber && (
                      <div
                        id={`${resultsId}-${round.roundNumber}-${index}`}
                        className="scoreboard-extras scoreboard-extras--open"
                      >
                        <div className="text-xs leading-none text-text-secondary/70">
                          <span
                            aria-hidden
                            className="my-0.5 h-px w-3/4 shrink-0 bg-text-secondary/70"
                          />
                          <span>
                            <span className="sr-only">Accumulated {metric}: </span>
                            {primaryTotal(score)}
                          </span>
                          {"totalTiebreaker" in score && score.totalTiebreaker !== undefined && (
                            <span>
                              <span className="sr-only">Accumulated Tiebreaker: </span>
                              {score.totalTiebreaker}
                            </span>
                          )}
                          {view.game.status === "active" && round.id && (
                            <Button
                              type="button"
                              aria-label={`Edit Round ${round.roundNumber} for ${view.players[index].name}`}
                              className="mt-2 min-h-11 px-3 text-xs"
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
                        </div>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
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
                    <div className={entryClasses} data-scoreboard-column={index}>
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
      </section>
      {view.game.status === "active" &&
        (view.game.settings.mode === "passFail" ? (
          <GenericPassFailRoundDialog
            open={addOpen}
            onClose={setAddOpen}
            gameId={view.game.id}
            players={view.players}
          />
        ) : (
          <GenericAddRoundDialog
            open={addOpen}
            onClose={setAddOpen}
            gameId={view.game.id}
            players={view.players}
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
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  );
}
