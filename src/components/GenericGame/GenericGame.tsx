import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChartNoAxesColumn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  genericGameScoreboardOptions,
  useDeleteEmptyGenericGame,
  useFinishGenericGame,
  useReopenGenericGame,
} from "../../data/hooks/useGenericGames";
import type { GameId } from "../../types";
import { FinishGameMenu } from "../Game/FinishGameMenu";
import { shouldAutoOpenStandings } from "../Game/standingsAutoOpen";
import { HomeMenu } from "../Home/HomeMenu";
import { ScorekeeperLogo } from "../Logo/ScorekeeperLogo";
import { ScorekeeperShell } from "../ScorekeeperShell/ScorekeeperShell";
import { Button, InlineError } from "../ui";
import { GenericScoreboard } from "./GenericScoreboard";
import { GenericStandingsDialog } from "./GenericStandingsDialog";
import "./genericGameHeader.css";

export function GenericGame({ gameId }: { gameId: GameId }) {
  const [standingsOpen, setStandingsOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const checkedInitialStandingsGameId = useRef<GameId | null>(null);
  const openFinalStandingsAfterFinish = useRef(false);
  const finishGame = useFinishGenericGame();
  const reopenGame = useReopenGenericGame();
  const deleteGame = useDeleteEmptyGenericGame();
  const navigate = useNavigate();
  const {
    data: view,
    isPending,
    isError,
    isFetching,
    isStale,
    refetch,
  } = useQuery(genericGameScoreboardOptions(gameId));

  useEffect(() => {
    if (!view || checkedInitialStandingsGameId.current === view.game.id) return;
    checkedInitialStandingsGameId.current = view.game.id;
    if (shouldAutoOpenStandings(view.game.status, view.game.id, null)) {
      setStandingsOpen(true);
    }
  }, [view]);

  return (
    <ScorekeeperShell
      headerContent={
        <div className="generic-game-header relative h-full">
          <div className="generic-game-header-logo absolute inset-0 flex items-center justify-center py-2">
            <ScorekeeperLogo height={64} />
          </div>
          <div className="content-container generic-game-header-controls absolute inset-y-0 z-10 flex items-center justify-end py-2">
            <HomeMenu
              experience="scorekeeper"
              editGameId={
                view?.game.status === "active" && !isError && !isFetching && !isStale
                  ? gameId
                  : undefined
              }
              onReopenGame={
                view?.game.status === "completed" && !isError && !isFetching && !isStale
                  ? async () => {
                      await reopenGame.mutateAsync({
                        id: gameId,
                        version: JSON.stringify(view.game),
                      });
                    }
                  : undefined
              }
            />
          </div>
        </div>
      }
      mainContent={
        <div className="content-container flex h-full min-h-0 flex-col py-4">
          {isError && <InlineError message="Unable to load this Game." onRetry={() => refetch()} />}
          {isPending ? (
            <output>Loading Game...</output>
          ) : !view ? (
            !isError && <output>Game not found in Scorekeeper.</output>
          ) : (
            <div className="contents" inert={isError}>
              {view.game.name && (
                <h1 className="shrink-0 truncate pb-4 text-center text-sm text-text-secondary">
                  {view.game.name}
                </h1>
              )}
              <GenericScoreboard key={`scoreboard-${view.game.id}`} view={view} />
              <GenericStandingsDialog
                key={`standings-${view.game.id}`}
                open={standingsOpen && !isError}
                onClose={setStandingsOpen}
                view={view}
              />
            </div>
          )}
        </div>
      }
      footerContent={
        <div className="content-container flex h-full justify-between">
          {view && (
            <Button
              type="button"
              aria-label="Open Standings"
              disabled={isError}
              onClick={() => setStandingsOpen(true)}
              className="page-shell-button p-0 data-focus:outline-solid data-focus:outline-text-secondary!"
            >
              <ChartNoAxesColumn className="size-8" aria-hidden />
            </Button>
          )}
          <FinishGameMenu
            open={finishOpen}
            active={view?.game.status === "active"}
            action={
              view && !isPending && !isError && !isFetching && !isStale
                ? view.rounds.length === 0
                  ? "delete"
                  : "finish"
                : null
            }
            onOpenChange={setFinishOpen}
            onPause={() => navigate({ to: "/scorekeeper" })}
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
              await navigate({ to: "/scorekeeper" });
            }}
          />
        </div>
      }
    />
  );
}
