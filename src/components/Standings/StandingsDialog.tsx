import { Tab, TabGroup, TabPanel } from "@headlessui/react";
import { useEffect, useState } from "react";
import { deriveStandings } from "../../data/api/standings";
import type { Game, PlayerIdentity, Round } from "../../types";
import { Dialog, DialogScrollArea, SwipeableTabPanels, TabList, tabClasses } from "../ui";
import { PhaseGraph } from "./PhaseGraph";
import { StandingsList } from "./StandingsList";
import { StandingsRow } from "./StandingsRow";
import {
  standingsDialogListClasses,
  standingsDialogTabPanelClasses,
  standingsDialogTabPanelHorizontalBleed,
  standingsDialogWorkspaceClasses,
} from "./standingsDialogLayout";
import { getStandingsDisplayRows } from "./standingsDialogView";
import { TiebreakerGraph } from "./TiebreakerGraph";

interface StandingsDialogProps {
  open: boolean;
  onClose: (open: boolean) => void;
  game: Game;
  players: PlayerIdentity[];
  rounds: Round[];
}

export function StandingsDialog({ open, onClose, game, players, rounds }: StandingsDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const standings = deriveStandings({ game, players, rounds });
  const displayRows = getStandingsDisplayRows(standings);

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      sizing="workspace"
      bodyScroll="custom"
      minBodyHeight={200}
      className="max-w-xl"
    >
      <div className={standingsDialogWorkspaceClasses}>
        <TabGroup
          selectedIndex={selectedIndex}
          onChange={setSelectedIndex}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <div className="flex shrink-0 justify-center">
            <TabList>
              <Tab className={tabClasses}>Standings</Tab>
              <Tab className={tabClasses}>Phases</Tab>
              <Tab className={tabClasses}>Tiebreaker</Tab>
            </TabList>
          </div>

          <SwipeableTabPanels
            selectedIndex={selectedIndex}
            onChange={setSelectedIndex}
            horizontalBleed={standingsDialogTabPanelHorizontalBleed}
            className="min-h-0 flex-1"
          >
            <TabPanel className={standingsDialogTabPanelClasses}>
              <DialogScrollArea aria-label="Standings">
                <StandingsList scorekeeper="phase10" className={standingsDialogListClasses}>
                  {displayRows.map((row) => (
                    <StandingsRow key={row.player.id} row={row} />
                  ))}
                </StandingsList>
              </DialogScrollArea>
            </TabPanel>

            <TabPanel className={standingsDialogTabPanelClasses}>
              <PhaseGraph
                series={standings.phaseGraphSeries}
                rows={standings.rows}
                totalPhases={game.phaseSet.phases.length}
              />
            </TabPanel>

            <TabPanel className={standingsDialogTabPanelClasses}>
              <TiebreakerGraph
                series={standings.tiebreakerGraphSeries}
                tiebreaker={game.settings.tiebreaker}
                rounds={rounds}
              />
            </TabPanel>
          </SwipeableTabPanels>
        </TabGroup>
      </div>
    </Dialog>
  );
}
