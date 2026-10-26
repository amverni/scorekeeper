import { TabPanel } from "@headlessui/react";
import { useForm } from "@tanstack/react-form";
import { type ReactNode, useRef, useState } from "react";
import type {
  EditGenericGameInput,
  GenericGameEditor,
  PhaseGameEditor,
  PlayerId,
  ScorekeeperExperience,
} from "../../types";
import { GameSetupTabs } from "../Create/GameSetupTabs";
import { PlayerSelectionProvider } from "../Create/PlayerSelectionContext";
import { AddPlayerButton } from "../Create/Players/AddPlayerButton";
import { FavoritePlayers } from "../Create/Players/FavoritePlayers";
import { EditImpactDialog, InlineError, List, ScrollFade } from "../ui";
import { GameMembershipPlayers } from "./GameMembershipPlayers";
import { StagedGameEditor } from "./StagedGameEditor";

export function GameMembershipEditor({
  editor,
  experience,
  phases,
  settings,
  isPending,
  preview,
  save,
}: {
  editor: GenericGameEditor | PhaseGameEditor;
  experience: ScorekeeperExperience;
  phases?: ReactNode;
  settings: ReactNode;
  isPending: boolean;
  preview: (input: EditGenericGameInput) => Promise<{ requiresConfirmation: boolean }>;
  save: (input: EditGenericGameInput) => Promise<void>;
}) {
  const { game } = editor;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<EditGenericGameInput | null>(null);
  const submitting = useRef(false);
  const savedIds = new Set(game.players);
  const savedWithdrawn = "withdrawnPlayers" in editor ? editor.withdrawnPlayers : [];
  const form = useForm({
    defaultValues: { players: editor.players, withdrawnPlayers: savedWithdrawn },
    onSubmit: async ({ value }) => {
      const input = {
        gameId: game.id,
        version: editor.version,
        players: value.players.map(({ id }) => id),
        ...(experience === "scorekeeper" ? { withdrawnPlayers: value.withdrawnPlayers } : {}),
      };
      const impact = await preview(input);
      if (impact.requiresConfirmation) {
        setConfirmation(input);
      } else {
        await save(input);
      }
    },
  });

  function rejoin(playerId: PlayerId) {
    if (submitting.current) return;
    setSubmitError(null);
    form.setFieldValue("withdrawnPlayers", (ids) => ids.filter((id) => id !== playerId));
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
        withdrawnPlayers: state.values.withdrawnPlayers,
        isSubmitting: state.isSubmitting,
      })}
    >
      {({ players, withdrawnPlayers, isSubmitting }) => {
        const changed =
          players.length > game.players.length ||
          withdrawnPlayers.length !== savedWithdrawn.length ||
          withdrawnPlayers.some((id) => !savedWithdrawn.includes(id));
        const invalid =
          withdrawnPlayers.some((id) => !savedWithdrawn.includes(id)) &&
          players.length - withdrawnPlayers.length < 2;
        return (
          <StagedGameEditor
            experience={experience}
            gameId={game.id}
            save={
              isPending || isSubmitting
                ? { status: "pending" }
                : invalid
                  ? { status: "invalid" }
                  : changed
                    ? { status: "ready", onSave: () => submit(form.handleSubmit) }
                    : { status: "unchanged" }
            }
          >
            <GameSetupTabs
              experience={experience}
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
                            if (submitting.current) return;
                            setSubmitError(null);
                            if (savedIds.has(id)) {
                              if (experience === "scorekeeper") {
                                form.setFieldValue("withdrawnPlayers", (ids) =>
                                  ids.includes(id) ? ids : [...ids, id],
                                );
                              }
                              return;
                            }
                            field.handleChange((selected) =>
                              selected.filter((player) => player.id !== id),
                            );
                          },
                          reorderPlayers: (players) => {
                            if (submitting.current) return;
                            setSubmitError(null);
                            field.handleChange(players);
                          },
                        }}
                      >
                        <div className="flex flex-col gap-6 py-4" inert={isPending || isSubmitting}>
                          <GameMembershipPlayers
                            lockedPlayerIds={game.players}
                            withdrawnPlayers={withdrawnPlayers}
                            onRejoin={experience === "scorekeeper" ? rejoin : undefined}
                          />
                          {invalid && (
                            <output className="text-sm text-text-secondary">
                              Withdrawal must leave at least two eligible Players.
                            </output>
                          )}
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
              {phases && (
                <TabPanel className="h-full px-4">
                  <ScrollFade className="h-full -mx-6 px-6 pb-4">{phases}</ScrollFade>
                </TabPanel>
              )}
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
        );
      }}
    </form.Subscribe>
  );
}
