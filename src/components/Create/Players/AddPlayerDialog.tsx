import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { PlayerEditor } from "../../Players/PlayerEditor";
import { PlayersSearch } from "../../Players/PlayersSearch";
import { Button, Dialog, DialogScrollArea } from "../../ui";
import { useAddPlayer, useGamePlayers } from "../PlayerSelectionContext";
import { AddPlayerRow } from "./AddPlayerRow";
import "./AddPlayerDialog.css";

type View = "search" | "create";

export interface AddPlayerDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Dialog for searching and creating players. */
export function AddPlayerDialog({ open, onClose }: AddPlayerDialogProps) {
  const [view, setView] = useState<View>("search");
  const inputRef = useRef<HTMLInputElement>(null);
  const addPlayer = useAddPlayer();
  const gamePlayers = useGamePlayers();
  const gamePlayerIds = new Set(gamePlayers.map((p) => p.id));

  function handleBack() {
    setView("search");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <PlayerEditor
      onBack={handleBack}
      onCreated={addPlayer}
      render={({ content, actions, isPending, startCreate }) => (
        <Dialog
          open={open}
          onClose={onClose}
          afterLeave={() => {
            startCreate("");
            setView("search");
          }}
          initialFocus={inputRef}
          aria-label={view === "create" ? "Create player" : "Add player"}
          presentation="floating"
          sizing="workspace"
          bodyScroll="custom"
          dismissible={!isPending}
          onBack={view === "create" ? handleBack : undefined}
          backLabel="Back to search"
          header={
            view === "create" ? (
              <h2 className="text-base font-medium text-text-secondary">New Player</h2>
            ) : undefined
          }
          actions={view === "create" ? actions : undefined}
        >
          <div className="add-player-viewport min-h-0 flex-1 -mx-4 overflow-clip">
            <div className="add-player-slider h-full" data-view={view}>
              <div
                className="add-player-page h-full w-full shrink-0 px-4"
                inert={view !== "search" ? true : undefined}
                aria-hidden={view !== "search"}
              >
                <PlayersSearch
                  inDialog
                  inputRef={inputRef}
                  renderRow={(player) => (
                    <AddPlayerRow
                      player={player}
                      onSelect={addPlayer}
                      disabled={gamePlayerIds.has(player.id)}
                    />
                  )}
                  actions={(searchTerm) => (
                    <Button
                      onClick={() => {
                        startCreate(searchTerm);
                        setView("create");
                      }}
                      className="h-9 w-9 shrink-0 p-0"
                      aria-label="Create new player"
                    >
                      <Plus aria-hidden="true" className="h-5 w-5" />
                    </Button>
                  )}
                />
              </div>
              <div
                className="add-player-page flex h-full w-full shrink-0 flex-col px-4"
                inert={view !== "create" ? true : undefined}
                aria-hidden={view !== "create"}
              >
                {view === "create" && (
                  <DialogScrollArea aria-label="Create player form">{content}</DialogScrollArea>
                )}
              </div>
            </div>
          </div>
        </Dialog>
      )}
    />
  );
}
