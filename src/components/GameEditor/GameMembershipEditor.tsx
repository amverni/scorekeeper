import { TabPanel } from "@headlessui/react";
import { useForm } from "@tanstack/react-form";
import { type ReactNode, useRef, useState } from "react";
import type {
  EditGamePlayersInput,
  GenericGameEditor,
  PhaseGameEditor,
  PhaseGameEditPreview,
  PlayerId,
  ScorekeeperExperience,
} from "../../types";
import { GameSetupTabs } from "../Create/GameSetupTabs";
import { PlayerSelectionProvider } from "../Create/PlayerSelectionContext";
import { Players } from "../Create/Players";
import { EditImpactDialog, InlineError, ScrollFade } from "../ui";
import { GameEditReviewDialog } from "./GameEditReviewDialog";
import { GamePhasesEditor } from "./GamePhasesEditor";
import { StagedGameEditor } from "./StagedGameEditor";

type EditConfirmation =
  | { type: "phase10"; input: EditGamePlayersInput; preview: PhaseGameEditPreview }
  | { type: "generic"; input: EditGamePlayersInput };

export function GameMembershipEditor({
  editor,
  experience,
  settings,
  isPending,
  preview,
  save,
}: {
  editor: GenericGameEditor | PhaseGameEditor;
  experience: ScorekeeperExperience;
  settings: ReactNode;
  isPending: boolean;
  preview: (
    input: EditGamePlayersInput,
  ) => Promise<PhaseGameEditPreview | { requiresConfirmation: boolean }>;
  save: (input: EditGamePlayersInput) => Promise<void>;
}) {
  const { game } = editor;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<EditConfirmation | null>(null);
  const submitting = useRef(false);
  const savedIds = new Set(game.players);
  const savedWithdrawn = editor.withdrawnPlayers;
  const form = useForm({
    defaultValues: {
      players: editor.players,
      withdrawnPlayers: savedWithdrawn,
      phases: "phases" in editor ? editor.phases : [],
    },
    onSubmit: async ({ value }) => {
      const input = {
        gameId: game.id,
        version: editor.version,
        players: value.players.map(({ id }) => id),
        withdrawnPlayers: value.withdrawnPlayers,
        ...(game.scorekeeper === "phase10"
          ? {
              phaseOccurrences: value.phases.map((phase) => ({
                id: phase.occurrenceId,
                phaseId: phase.id,
              })),
            }
          : {}),
      };
      const impact = await preview(input);
      if (impact.requiresConfirmation) {
        setConfirmation(
          "token" in impact
            ? { type: "phase10", input, preview: impact }
            : { type: "generic", input },
        );
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
        phases: state.values.phases,
        isSubmitting: state.isSubmitting,
      })}
    >
      {({ players, withdrawnPlayers, phases, isSubmitting }) => {
        const phasesChanged =
          game.scorekeeper === "phase10" &&
          (phases.length !== game.phaseOccurrences.length ||
            phases.some(
              (phase, index) =>
                phase.occurrenceId !== game.phaseOccurrences[index]?.id ||
                phase.id !== game.phaseOccurrences[index]?.phaseId,
            ));
        const changed =
          phasesChanged ||
          players.length > game.players.length ||
          withdrawnPlayers.length !== savedWithdrawn.length ||
          withdrawnPlayers.some((id) => !savedWithdrawn.includes(id));
        const membershipInvalid =
          withdrawnPlayers.some((id) => !savedWithdrawn.includes(id)) &&
          players.length - withdrawnPlayers.length < 2;
        const invalid =
          membershipInvalid || (game.scorekeeper === "phase10" && phases.length === 0);
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
                              form.setFieldValue("withdrawnPlayers", (ids) =>
                                ids.includes(id) ? ids : [...ids, id],
                              );
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
                        <Players
                          isPending={isPending || isSubmitting}
                          membership={{
                            lockedPlayerIds: game.players,
                            withdrawnPlayers,
                            finishedPlayers:
                              "finishedPlayers" in editor ? editor.finishedPlayers : [],
                            onRejoin: rejoin,
                          }}
                          error={
                            membershipInvalid && (
                              <output className="text-sm text-text-secondary">
                                Withdrawal must leave at least two eligible Players.
                              </output>
                            )
                          }
                        />
                      </PlayerSelectionProvider>
                    )}
                  </form.Field>
                </ScrollFade>
              </TabPanel>
              {"phases" in editor && (
                <TabPanel className="h-full px-4">
                  <ScrollFade className="h-full -mx-6 px-6 pb-4">
                    <form.Field name="phases">
                      {(field) => (
                        <GamePhasesEditor
                          phases={field.state.value}
                          editable={editor.canEditPhases}
                          isPending={isPending || isSubmitting}
                          onChange={(phases) => {
                            if (submitting.current) return;
                            setSubmitError(null);
                            field.handleChange(phases);
                          }}
                        />
                      )}
                    </form.Field>
                  </ScrollFade>
                </TabPanel>
              )}
              <TabPanel className="h-full px-4">
                <ScrollFade className="h-full -mx-6 px-6 pb-4">{settings}</ScrollFade>
              </TabPanel>
            </GameSetupTabs>
            {confirmation?.type === "phase10" && (
              <GameEditReviewDialog
                preview={confirmation.preview}
                isPending={isPending}
                onEdit={() => {
                  if (!submitting.current) setConfirmation(null);
                }}
                onSave={(finishChoice) =>
                  submit(() =>
                    save({
                      ...confirmation.input,
                      approval: { token: confirmation.preview.token, finishChoice },
                    }),
                  )
                }
              />
            )}
            <EditImpactDialog
              open={confirmation?.type === "generic"}
              title="Edit game"
              isPending={isPending}
              onEdit={() => {
                if (!submitting.current) setConfirmation(null);
              }}
              onSave={() => {
                if (confirmation?.type === "generic") {
                  submit(() => save({ ...confirmation.input, confirmImpact: true }));
                }
              }}
            />
          </StagedGameEditor>
        );
      }}
    </form.Subscribe>
  );
}
