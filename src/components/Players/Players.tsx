import { Link } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { useDeletePlayer } from "../../data/hooks/usePlayers";
import type { Player, ScorekeeperExperience } from "../../types";
import { CardBackground } from "../CardBackground/CardBackground";
import { HeaderLogo } from "../Logo/HeaderLogo";
import { ScorekeeperShell } from "../ScorekeeperShell/ScorekeeperShell";
import { Button } from "../ui";
import { PlayerEditor } from "./PlayerEditor";
import { PlayerListRow } from "./PlayerListRow";
import { PlayersSearch } from "./PlayersSearch";

export function Players({ experience }: { experience: ScorekeeperExperience }) {
  const deletePlayer = useDeletePlayer();
  const isPhase = experience === "phaseCompan10n";
  const Shell = isPhase ? CardBackground : ScorekeeperShell;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultName, setDefaultName] = useState("");
  const [editingPlayer, setEditingPlayer] = useState<Player | undefined>();
  const [editorMounted, setEditorMounted] = useState(false);

  function handleClose() {
    setDialogOpen(false);
  }

  function handleAfterLeave() {
    setDefaultName("");
    setEditingPlayer(undefined);
    setEditorMounted(false);
  }

  function handleEdit(player: Player) {
    setEditingPlayer(player);
    setEditorMounted(true);
    setDialogOpen(true);
  }

  return (
    <Shell
      headerContent={
        isPhase ? (
          <div className="relative flex h-full items-center">
            <HeaderLogo />
          </div>
        ) : undefined
      }
      mainContent={
        <div className="content-container h-full">
          <PlayersSearch
            error={deletePlayer.error?.message}
            renderRow={(player) => (
              <PlayerListRow
                key={player.id}
                player={player}
                onEdit={handleEdit}
                onDelete={deletePlayer.mutate}
                isDeleting={deletePlayer.isPending}
              />
            )}
            actions={(searchTerm) => (
              <Button
                onClick={() => {
                  setDefaultName(searchTerm);
                  setEditorMounted(true);
                  setDialogOpen(true);
                }}
                className="h-9 w-9 shrink-0 p-0"
                aria-label="Create new player"
              >
                <Plus className="h-5 w-5" />
              </Button>
            )}
          />
          {editorMounted && (
            <PlayerEditor
              defaultName={defaultName}
              player={editingPlayer}
              onBack={handleClose}
              onDeleted={handleClose}
              dialog={{ open: dialogOpen, onClose: handleClose, afterLeave: handleAfterLeave }}
            />
          )}
        </div>
      }
      footerContent={
        <div className="content-container flex h-full">
          <Button
            as={Link}
            to={isPhase ? "/phaseCompan10n" : "/scorekeeper"}
            className="page-shell-button p-0"
            aria-label="Go home"
          >
            <ArrowLeft className="size-8" />
          </Button>
        </div>
      }
    />
  );
}
