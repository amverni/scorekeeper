import { TabPanel } from "@headlessui/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Play, X } from "lucide-react";
import { useState } from "react";
import { useCreateGame } from "../../data/hooks/useGames";
import type { ArrayAtLeastOne, PhaseId, TemporaryPhaseSet } from "../../types";
import { CardBackground } from "../CardBackground/CardBackground";
import { HeaderLogo } from "../Logo/HeaderLogo";
import { Button, ScrollFade } from "../ui";
import { useGamePhases, useGameSettings } from "./CreateGameContext";
import { GameSetupTabs } from "./GameSetupTabs";
import { Phases } from "./Phases";
import { useGamePlayers } from "./PlayerSelectionContext";
import { Players } from "./Players";
import { Settings } from "./Settings";

export function CreateGame() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const createGame = useCreateGame();
  const navigate = useNavigate();
  const players = useGamePlayers();
  const phases = useGamePhases();
  const settings = useGameSettings();
  const canStartGame = players.length >= 2 && phases.length >= 1 && !createGame.isPending;

  async function handleStartGame() {
    if (!canStartGame) return;

    setStartError(null);
    const phaseIds = phases.map((phase) => phase.id) as ArrayAtLeastOne<PhaseId>;
    const phaseSet: TemporaryPhaseSet = {
      id: crypto.randomUUID(),
      name: "Game Phases",
      type: "temporary",
      phases: phaseIds,
    };

    try {
      const game = await createGame.mutateAsync({
        players: players.map((player) => player.id),
        phaseSet,
        settings,
      });
      await navigate({ to: "/phaseCompan10n/game/$gameId", params: { gameId: game.id } });
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Unable to start game");
    }
  }

  return (
    <CardBackground
      headerContent={
        <div className="relative flex h-full items-center">
          <HeaderLogo />
        </div>
      }
      mainContent={
        <GameSetupTabs
          experience="phaseCompan10n"
          selectedIndex={selectedIndex}
          onChange={setSelectedIndex}
          error={
            startError && (
              <p
                className="content-container mb-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {startError}
              </p>
            )
          }
        >
          <TabPanel className="h-full px-4">
            <ScrollFade className="h-full -mx-6 px-6 pb-(--slant)">
              <Players />
            </ScrollFade>
          </TabPanel>

          <TabPanel className="h-full px-4">
            <ScrollFade className="h-full -mx-6 px-6 pb-(--slant)">
              <Phases />
            </ScrollFade>
          </TabPanel>

          <TabPanel className="h-full px-4">
            <ScrollFade className="h-full -mx-6 px-6 pb-(--slant)">
              <Settings />
            </ScrollFade>
          </TabPanel>
        </GameSetupTabs>
      }
      footerContent={
        <div className="content-container flex h-full justify-between">
          {/* Cancel — back to home */}
          <Button as={Link} to="/phaseCompan10n" aria-label="Cancel" className="page-shell-button">
            <X className="size-8 relative z-10" />
          </Button>

          {/* Start game */}
          <Button
            variant="ready"
            aria-label="Start"
            className="page-shell-button"
            disabled={!canStartGame}
            onClick={handleStartGame}
          >
            <Play className="size-8 relative z-10" />
          </Button>
        </div>
      }
    />
  );
}
