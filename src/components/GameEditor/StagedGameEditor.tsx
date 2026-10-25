import { Link } from "@tanstack/react-router";
import { Save, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { GameId, ScorekeeperExperience } from "../../types";
import { CardBackground } from "../CardBackground/CardBackground";
import { HeaderLogo } from "../Logo/HeaderLogo";
import { ScorekeeperShell } from "../ScorekeeperShell/ScorekeeperShell";
import { Button } from "../ui";

export type GameEditorSaveState =
  | { status: "unsupported" | "unchanged" | "invalid" | "pending" }
  | { status: "ready"; onSave: () => void };

interface StagedGameEditorProps {
  experience: ScorekeeperExperience;
  gameId: GameId;
  save: GameEditorSaveState;
  children: ReactNode;
}

export function StagedGameEditor({ experience, gameId, save, children }: StagedGameEditorProps) {
  const Shell = experience === "phaseCompan10n" ? CardBackground : ScorekeeperShell;
  return (
    <Shell
      headerContent={
        experience === "phaseCompan10n" ? (
          <div className="relative flex h-full items-center">
            <HeaderLogo />
          </div>
        ) : undefined
      }
      mainContent={
        <>
          <h1 className="sr-only">Edit game</h1>
          {children}
        </>
      }
      footerContent={
        <div className="content-container flex h-full justify-between">
          <Button as={Fragment} aria-label="Cancel">
            <Link
              to={
                experience === "phaseCompan10n"
                  ? "/phaseCompan10n/game/$gameId"
                  : "/scorekeeper/game/$gameId"
              }
              params={{ gameId }}
              className="page-shell-button p-0"
              aria-disabled={save.status === "pending" || undefined}
              onClick={(event) => {
                if (save.status === "pending") event.preventDefault();
              }}
            >
              <X className="size-8" aria-hidden />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ready"
            aria-label="Save"
            className="page-shell-button p-0"
            disabled={save.status !== "ready"}
            onClick={save.status === "ready" ? save.onSave : undefined}
          >
            <Save className="size-8" aria-hidden />
          </Button>
        </div>
      }
    />
  );
}
