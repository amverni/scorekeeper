import { TabPanel } from "@headlessui/react";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Minus } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useEditGenericGame, usePreviewGenericGameEdit } from "../../data/hooks/useGenericGames";
import type { EditGenericGameInput, GenericGameEditor } from "../../types";
import { GameSetupTabs } from "../Create/GameSetupTabs";
import { PlayerSelectionProvider } from "../Create/PlayerSelectionContext";
import { AddPlayerButton } from "../Create/Players/AddPlayerButton";
import { FavoritePlayers } from "../Create/Players/FavoritePlayers";
import { PlayerRow } from "../Create/Players/PlayerRow";
import { Button, EditImpactDialog, InlineError, List, ScrollFade } from "../ui";
import { StagedGameEditor } from "./StagedGameEditor";

export function GenericMembershipEditor({
  editor,
  settings,
}: {
  editor: GenericGameEditor;
  settings: ReactNode;
}) {
  const { game } = editor;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<EditGenericGameInput | null>(null);
  const submitting = useRef(false);
  const preview = usePreviewGenericGameEdit();
  const edit = useEditGenericGame();
  const navigate = useNavigate();
  const isPending = preview.isPending || edit.isPending;
  const savedIds = new Set(game.players);
  const form = useForm({
    defaultValues: { players: editor.players },
    onSubmit: async ({ value }) => {
      const input = {
        gameId: game.id,
        version: editor.version,
        players: value.players.map(({ id }) => id),
      };
      const impact = await preview.mutateAsync(input);
      if (impact.requiresConfirmation) {
        setConfirmation(input);
      } else {
        await save(input);
      }
    },
  });

  async function save(input: EditGenericGameInput) {
    await edit.mutateAsync(input);
    await navigate({ to: "/scorekeeper/game/$gameId", params: { gameId: game.id } });
  }

  function submit(action: () => Promise<void>) {
    if (submitting.current) return;
    submitting.current = true;
    setSubmitError(null);
    action()
      .catch((error: unknown) => {
        setConfirmation(null);
        setSubmitError(error instanceof Error ? error.message : "Unable to save Game.");
      })
      .finally(() => {
        submitting.current = false;
      });
  }

  return (
    <form.Subscribe
      selector={(state) => ({
        players: state.values.players,
        isSubmitting: state.isSubmitting,
      })}
    >
      {({ players, isSubmitting }) => (
        <StagedGameEditor
          experience="scorekeeper"
          gameId={game.id}
          save={
            isPending || isSubmitting
              ? { status: "pending" }
              : players.length > game.players.length
                ? { status: "ready", onSave: () => submit(form.handleSubmit) }
                : { status: "unchanged" }
          }
        >
          <GameSetupTabs
            experience="scorekeeper"
            selectedIndex={selectedIndex}
            onChange={setSelectedIndex}
            error={
              submitError && (
                <div className="content-container w-full pb-2">
                  <InlineError message={submitError} />
                </div>
              )
            }
          >
            <TabPanel className="h-full px-4">
              <ScrollFade className="h-full -mx-6 px-6 pb-4">
                <form.Field name="players">
                  {(field) => (
                    <PlayerSelectionProvider
                      value={{
                        players: field.state.value,
                        addPlayer: (player) => {
                          if (submitting.current) return;
                          setSubmitError(null);
                          field.handleChange((selected) =>
                            selected.some(({ id }) => id === player.id)
                              ? selected
                              : [...selected, player],
                          );
                        },
                        removePlayer: (id) => {
                          if (submitting.current || savedIds.has(id)) return;
                          setSubmitError(null);
                          field.handleChange((selected) =>
                            selected.filter((player) => player.id !== id),
                          );
                        },
                        reorderPlayers: field.handleChange,
                      }}
                    >
                      <div className="flex flex-col gap-6 py-4" inert={isPending || isSubmitting}>
                        <List role="list" rowVariant="compact-content">
                          {field.state.value.map((player) => (
                            <li key={player.id} className="flex w-full min-w-0 items-center">
                              <div className="min-w-0 flex-1 wrap-anywhere">
                                <PlayerRow player={player} />
                              </div>
                              {savedIds.has(player.id) ? (
                                <span className="size-11 shrink-0" aria-hidden />
                              ) : (
                                <Button
                                  type="button"
                                  aria-label={`Remove ${player.name}`}
                                  className="size-11 shrink-0"
                                  onClick={() => {
                                    if (submitting.current) return;
                                    setSubmitError(null);
                                    field.handleChange((selected) =>
                                      selected.filter(({ id }) => id !== player.id),
                                    );
                                  }}
                                >
                                  <Minus className="size-5" aria-hidden />
                                </Button>
                              )}
                              <span className="w-7 shrink-0" aria-hidden />
                            </li>
                          ))}
                        </List>
                        <List>
                          <AddPlayerButton key="add-player" />
                        </List>
                        <FavoritePlayers />
                      </div>
                    </PlayerSelectionProvider>
                  )}
                </form.Field>
              </ScrollFade>
            </TabPanel>
            <TabPanel className="h-full px-4">
              <ScrollFade className="h-full -mx-6 px-6 pb-4">{settings}</ScrollFade>
            </TabPanel>
          </GameSetupTabs>
          <EditImpactDialog
            open={confirmation !== null}
            title="Edit game"
            isPending={isPending}
            onEdit={() => {
              if (!submitting.current) setConfirmation(null);
            }}
            onSave={() => {
              if (confirmation) submit(() => save({ ...confirmation, confirmImpact: true }));
            }}
          />
        </StagedGameEditor>
      )}
    </form.Subscribe>
  );
}
