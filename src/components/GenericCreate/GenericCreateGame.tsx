import { Field, Label, TabPanel } from "@headlessui/react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { Play, X } from "lucide-react";
import { useState } from "react";
import { useCreateGenericGame } from "../../data/hooks/useGenericGames";
import type { GenericGameSettings, GenericPointsSettings, Player } from "../../types";
import { GameSetupTabs } from "../Create/GameSetupTabs";
import { PlayerSelectionProvider } from "../Create/PlayerSelectionContext";
import { Players } from "../Create/Players";
import { ScorekeeperShell } from "../ScorekeeperShell/ScorekeeperShell";
import {
  Button,
  InlineError,
  Input,
  List,
  Listbox,
  ListboxButton,
  ListboxLabel,
  ListboxOption,
  ListboxOptions,
  ScrollFade,
  SettingListRow,
  Switch,
} from "../ui";
import { ScoreDirectionSetting } from "./ScoreDirectionSetting";

const modes = [
  { value: "points", label: "Points" },
  { value: "singleRoundWinner", label: "Single Round Winner" },
  { value: "passFail", label: "Pass/Fail" },
] as const;

export function GenericCreateGame() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createGame = useCreateGenericGame();
  const navigate = useNavigate();
  const defaultValues: {
    name: string;
    players: Player[];
    mode: GenericGameSettings["mode"];
    pointsDirection: GenericPointsSettings["pointsDirection"];
    tiebreakerEnabled: boolean;
    tiebreakerDirection: GenericPointsSettings["pointsDirection"];
    dealer: boolean;
  } = {
    name: "",
    players: [],
    mode: "points",
    pointsDirection: "high",
    tiebreakerEnabled: false,
    tiebreakerDirection: "high",
    dealer: false,
  };
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const game = await createGame.mutateAsync({
        name: value.name,
        players: value.players.map((player) => player.id),
        settings:
          value.mode === "points"
            ? {
                mode: "points",
                pointsDirection: value.pointsDirection,
                tiebreaker: value.tiebreakerEnabled
                  ? { direction: value.tiebreakerDirection }
                  : null,
                dealer: value.dealer,
              }
            : { mode: value.mode, tiebreaker: null, dealer: value.dealer },
      });
      await navigate({ to: "/scorekeeper/game/$gameId", params: { gameId: game.id } });
    },
  });

  return (
    <form
      className="h-full"
      aria-label="Create Game"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setSubmitError(null);
        form.handleSubmit().catch((error: unknown) => {
          setSubmitError(error instanceof Error ? error.message : "Unable to start Game.");
        });
      }}
    >
      <ScorekeeperShell
        mainContent={
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
                        addPlayer: (player) =>
                          field.handleChange((players) =>
                            players.some((selected) => selected.id === player.id)
                              ? players
                              : [...players, player],
                          ),
                        removePlayer: (id) =>
                          field.handleChange((players) =>
                            players.filter((player) => player.id !== id),
                          ),
                        reorderPlayers: field.handleChange,
                      }}
                    >
                      <Players />
                    </PlayerSelectionProvider>
                  )}
                </form.Field>
              </ScrollFade>
            </TabPanel>
            <TabPanel className="h-full px-4">
              <ScrollFade className="h-full -mx-6 px-6 py-4">
                <form.Subscribe
                  selector={(state) => ({
                    mode: state.values.mode,
                    tiebreakerEnabled: state.values.tiebreakerEnabled,
                  })}
                >
                  {({ mode, tiebreakerEnabled }) => (
                    <List rowVariant="content">
                      <form.Field key="name" name="name">
                        {(field) => (
                          <Field className="flex w-full min-w-0 flex-col gap-2">
                            <Label className="font-medium">Game name</Label>
                            <Input
                              type="text"
                              value={field.state.value}
                              onChange={(event) => field.handleChange(event.target.value)}
                              onBlur={field.handleBlur}
                              placeholder="Optional"
                              className="glass min-w-0 rounded-xl px-3 py-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-text-secondary"
                            />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field key="mode" name="mode">
                        {(field) => (
                          <Listbox
                            value={field.state.value}
                            onChange={field.handleChange}
                            className="w-full min-w-0"
                          >
                            <SettingListRow label={<ListboxLabel>Scoring Mode</ListboxLabel>}>
                              <ListboxButton
                                variant="plain"
                                className="shrink-0 data-focus:outline-2 data-focus:outline-solid data-focus:outline-text-secondary!"
                              >
                                {modes.find(({ value }) => value === field.state.value)?.label}
                              </ListboxButton>
                              <ListboxOptions
                                align="right"
                                anchor={{ to: "bottom end", gap: "0.25rem", padding: "1rem" }}
                                transformOrigin="top-right"
                              >
                                {modes.map(({ value, label }) => (
                                  <ListboxOption key={value} value={value}>
                                    {label}
                                  </ListboxOption>
                                ))}
                              </ListboxOptions>
                            </SettingListRow>
                          </Listbox>
                        )}
                      </form.Field>
                      {mode === "points" && (
                        <form.Subscribe key="direction" selector={(state) => state.values.mode}>
                          {(currentMode) =>
                            // List retains exiting rows; stop exposing inactive controls immediately.
                            currentMode === "points" && (
                              <form.Field name="pointsDirection">
                                {(field) => (
                                  <ScoreDirectionSetting
                                    label="Points Direction"
                                    value={field.state.value}
                                    onChange={field.handleChange}
                                    onBlur={field.handleBlur}
                                  />
                                )}
                              </form.Field>
                            )
                          }
                        </form.Subscribe>
                      )}
                      {mode === "points" && (
                        <form.Subscribe key="tiebreaker" selector={(state) => state.values.mode}>
                          {(currentMode) =>
                            currentMode === "points" && (
                              <form.Field name="tiebreakerEnabled">
                                {(field) => (
                                  <Field className="w-full">
                                    <SettingListRow label={<Label>Enable Tiebreaker</Label>}>
                                      <Switch
                                        checked={field.state.value}
                                        onChange={field.handleChange}
                                        onBlur={field.handleBlur}
                                        className="data-focus:outline-text-secondary!"
                                      />
                                    </SettingListRow>
                                  </Field>
                                )}
                              </form.Field>
                            )
                          }
                        </form.Subscribe>
                      )}
                      {mode === "points" && tiebreakerEnabled && (
                        <form.Subscribe
                          key="tiebreakerDirection"
                          selector={(state) =>
                            state.values.mode === "points" && state.values.tiebreakerEnabled
                          }
                        >
                          {(enabled) =>
                            enabled && (
                              <form.Field name="tiebreakerDirection">
                                {(field) => (
                                  <ScoreDirectionSetting
                                    label="Tiebreaker Direction"
                                    value={field.state.value}
                                    onChange={field.handleChange}
                                    onBlur={field.handleBlur}
                                  />
                                )}
                              </form.Field>
                            )
                          }
                        </form.Subscribe>
                      )}
                      <form.Field key="dealer" name="dealer">
                        {(field) => (
                          <Field className="w-full">
                            <SettingListRow label={<Label>Dealer</Label>}>
                              <Switch
                                checked={field.state.value}
                                onChange={field.handleChange}
                                onBlur={field.handleBlur}
                                className="data-focus:outline-text-secondary!"
                              />
                            </SettingListRow>
                          </Field>
                        )}
                      </form.Field>
                    </List>
                  )}
                </form.Subscribe>
              </ScrollFade>
            </TabPanel>
          </GameSetupTabs>
        }
        footerContent={
          <div className="content-container flex h-full justify-between">
            <Button
              as={Link}
              to="/scorekeeper"
              aria-label="Cancel"
              className="page-shell-button p-0"
            >
              <X className="size-8" aria-hidden />
            </Button>
            <form.Subscribe
              selector={(state) => [
                state.values.players.length > 0 && state.canSubmit,
                state.isSubmitting,
              ]}
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  variant="ready"
                  aria-label="Start"
                  className="page-shell-button p-0"
                  disabled={!canSubmit || isSubmitting}
                >
                  <Play className="size-8" aria-hidden />
                </Button>
              )}
            </form.Subscribe>
          </div>
        }
      />
    </form>
  );
}
