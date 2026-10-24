import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChartNoAxesColumn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  gameDetailOptions,
  gameViewOptions,
  useDeleteEmptyGame,
  useFinishGame,
} from "../../data/hooks/useGames";
import type { GameId } from "../../types";
import { CardBackground } from "../CardBackground/CardBackground";
import { HomeMenu } from "../Home/HomeMenu";
import { HeaderLogo } from "../Logo/HeaderLogo";
import {
  PhasesCardDialog,
  PhasesCardEntryButtonContent,
  phasesCardEntryButtonClasses,
} from "../PhasesCard";
import { Scoreboard } from "../Scoreboard";
import { StandingsDialog } from "../Standings";
import { Button, InlineError } from "../ui";
import { FinishGameMenu } from "./FinishGameMenu";
import { shouldShowPhasesCardEntryButton } from "./gameView";
import { shouldAutoOpenStandings } from "./standingsAutoOpen";

interface GameProps {
  gameId: GameId;
}

export function Game({ gameId }: GameProps) {
  const [phasesCardOpen, setPhasesCardOpen] = useState(false);
  const [standingsOpen, setStandingsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const openFinalStandingsAfterFinish = useRef(false);
  const finishGame = useFinishGame();
  const deleteGame = useDeleteEmptyGame();
  const navigate = useNavigate();
  const checkedInitialStandingsGameId = useRef<GameId | null>(null);
  const gameQuery = useQuery(gameDetailOptions(gameId));
  const viewQuery = useQuery({ ...gameViewOptions(gameId), enabled: !!gameQuery.data });
  const { data: view } = viewQuery;
  const game = gameQuery.data === null ? null : (view?.game ?? gameQuery.data);
  const hasLoadError = gameQuery.isError || viewQuery.isError;
  const standingsReady = Boolean(view) && !hasLoadError;
  const actionReady =
    gameQuery.isSuccess &&
    !gameQuery.isFetching &&
    !gameQuery.isStale &&
    viewQuery.isSuccess &&
    !viewQuery.isFetching &&
    !viewQuery.isStale &&
    Boolean(view);
  const showPhasesCardEntryButton = game ? shouldShowPhasesCardEntryButton(game.status) : true;

  useEffect(() => {
    if (!game) return;
    if (checkedInitialStandingsGameId.current === game.id) return;
    checkedInitialStandingsGameId.current = game.id;
    if (shouldAutoOpenStandings(game.status, game.id, null)) {
      setStandingsOpen(true);
    }
  }, [game]);

  return (
    <>
      <CardBackground
        headerContent={
          <div className="relative flex h-full items-center">
            <HeaderLogo />
            <div className="content-container card-header-controls absolute inset-x-0 top-0 z-10 flex items-center">
              {showPhasesCardEntryButton && (
                <Button
                  type="button"
                  aria-label="Open Phases Card"
                  className={phasesCardEntryButtonClasses}
                  disabled={!game}
                  onClick={() => {
                    if (game) setPhasesCardOpen(true);
                  }}
                >
                  <PhasesCardEntryButtonContent />
                </Button>
              )}
              <div className="ml-auto">
                <HomeMenu experience="phaseCompan10n" />
              </div>
            </div>
          </div>
        }
        mainContent={
          <div className="content-container flex h-full min-h-0 flex-col py-4 pb-[calc(0.5rem+var(--slant))]">
            {hasLoadError && (
              <InlineError
                message="Unable to load this Game."
                onRetry={() => {
                  if (gameQuery.isError) gameQuery.refetch();
                  if (viewQuery.isError) viewQuery.refetch();
                }}
              />
            )}
            {game === null || view === null ? (
              <p className="text-text-secondary flex flex-1 items-center justify-center text-center">
                This Game is no longer available.
              </p>
            ) : view ? (
              <div className="min-h-0 flex-1" inert={hasLoadError}>
                <Scoreboard
                  key={view.game.id}
                  view={view}
                  onGameCompleted={() => setStandingsOpen(true)}
                />
              </div>
            ) : !hasLoadError ? (
              <p className="text-text-secondary flex flex-1 items-center justify-center text-center">
                Loading…
              </p>
            ) : null}
          </div>
        }
        footerContent={
          <div className="content-container flex h-full justify-between">
            <Button
              type="button"
              className="page-shell-button p-0"
              aria-label="Open Standings"
              disabled={!standingsReady}
              onClick={() => setStandingsOpen(true)}
            >
              <ChartNoAxesColumn className="size-8" aria-hidden />
            </Button>
            <FinishGameMenu
              open={finishOpen}
              active={game?.status === "active"}
              action={actionReady ? (view?.rounds.length === 0 ? "delete" : "finish") : null}
              onOpenChange={setFinishOpen}
              onPause={() => navigate({ to: "/phaseCompan10n" })}
              afterClose={() => {
                if (openFinalStandingsAfterFinish.current) {
                  openFinalStandingsAfterFinish.current = false;
                  setStandingsOpen(true);
                }
              }}
              onFinish={async () => {
                await finishGame.mutateAsync(gameId);
                openFinalStandingsAfterFinish.current = true;
                setFinishOpen(false);
              }}
              onDelete={async () => {
                await deleteGame.mutateAsync(gameId);
                await navigate({ to: "/phaseCompan10n" });
              }}
            />
          </div>
        }
      />
      {game && (
        <PhasesCardDialog
          gameId={game.id}
          open={game.status === "active" && phasesCardOpen}
          onClose={setPhasesCardOpen}
          phaseSet={game.phaseSet}
        />
      )}
      {view && <StandingsDialog open={standingsOpen} onClose={setStandingsOpen} view={view} />}
    </>
  );
}
