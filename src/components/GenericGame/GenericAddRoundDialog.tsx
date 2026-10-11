import { Tab, TabGroup, TabPanel } from "@headlessui/react";
import { useForm } from "@tanstack/react-form";
import { useEffect, useRef, useState } from "react";
import type { GameId, PlayerId, PlayerIdentity } from "../../types";
import { parseGenericPoints } from "../../utils/genericPoints";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import { SwipeableTabPanels, TabList, tabClasses } from "../ui";
import {
  GenericRoundDialog,
  GenericRoundDialogActions,
  useGenericRoundDialog,
} from "./GenericRoundDialog";
import { PointsEntry } from "./PointsEntry";
import { WinnerEntry } from "./WinnerEntry";

interface GenericAddRoundDialogProps {
  open: boolean;
  onClose: (open: boolean) => void;
  gameId: GameId;
  players: PlayerIdentity[];
  mode: "points" | "singleRoundWinner";
  tiebreakerEnabled: boolean;
}

function pointsError(
  value: string,
  metric: "Points" | "Tiebreaker" = "Points",
): string | undefined {
  try {
    parseGenericPoints(value, metric);
    return undefined;
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
}

function entryError(
  score: { points: string; tiebreaker: string },
  tiebreakerEnabled: boolean,
): string | undefined {
  return (
    pointsError(score.points) ||
    (tiebreakerEnabled ? pointsError(score.tiebreaker, "Tiebreaker") : undefined)
  );
}

export function GenericAddRoundDialog({
  open,
  onClose,
  gameId,
  players,
  mode,
  tiebreakerEnabled,
}: GenericAddRoundDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tabListRef = useRef<HTMLDivElement>(null);
  const roundDialog = useGenericRoundDialog(onClose);
  const form = useForm({
    defaultValues: {
      scores: players.map((player) => ({ playerId: player.id, points: "0", tiebreaker: "0" })),
      winnerId: null as PlayerId | null,
    },
    onSubmit: async ({ value }) => {
      await roundDialog.saveRound(
        mode === "points"
          ? {
              gameId,
              mode: "points",
              scores: value.scores.map(({ playerId, points, tiebreaker }) => ({
                playerId,
                points,
                ...(tiebreakerEnabled ? { tiebreaker } : {}),
              })),
            }
          : {
              gameId,
              mode,
              scores: players.map((player) => ({
                playerId: player.id,
                won: player.id === value.winnerId,
              })),
            },
        () => {
          form.reset();
          setSelectedIndex(0);
        },
      );
    },
  });

  useEffect(() => {
    if (!open) return;
    tabListRef.current
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      [selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, selectedIndex]);

  return (
    <GenericRoundDialog
      open={open}
      onClose={onClose}
      isPending={roundDialog.isPending}
      onSubmit={() => roundDialog.handleSubmit(form.handleSubmit)}
      submitError={mode === "points" ? null : roundDialog.submitError}
      minBodyHeight={mode === "points" ? 240 : undefined}
      actions={(formId) => (
        <form.Subscribe
          selector={(state) => ({
            canSave:
              mode === "points"
                ? state.values.scores.every((score) => !entryError(score, tiebreakerEnabled))
                : state.values.winnerId !== null,
            submitting: state.isSubmitting,
          })}
        >
          {({ canSave, submitting }) => (
            <GenericRoundDialogActions formId={formId} submitting={submitting} canSave={canSave}>
              {mode === "singleRoundWinner" && (
                <output aria-live="polite" className="text-sm text-text-secondary">
                  {Number(canSave)}/1 winner selected
                </output>
              )}
            </GenericRoundDialogActions>
          )}
        </form.Subscribe>
      )}
    >
      {mode === "singleRoundWinner" ? (
        <form.Field name="winnerId">
          {(field) => (
            <WinnerEntry
              players={players}
              value={field.state.value}
              disabled={roundDialog.isPending}
              onChange={(value) => {
                roundDialog.clearSubmitError();
                field.handleChange(value);
              }}
            />
          )}
        </form.Field>
      ) : (
        <TabGroup
          selectedIndex={selectedIndex}
          onChange={(index) => {
            if (!roundDialog.isPending) setSelectedIndex(index);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div ref={tabListRef} className="-mx-2 shrink-0 overflow-x-auto px-2 py-1">
            <TabList className="w-max! min-w-full max-w-none!">
              {players.map((player) => (
                <Tab
                  key={player.id}
                  aria-label={player.name}
                  title={player.name}
                  disabled={roundDialog.isPending}
                  className={[
                    tabClasses,
                    "inline-flex min-h-10 min-w-24 items-center justify-center gap-2 px-3 data-focus:outline-text-secondary!",
                  ].join(" ")}
                >
                  <PlayerAvatar player={player} size={14} />
                  <span className="max-w-40 truncate">{player.name}</span>
                </Tab>
              ))}
            </TabList>
          </div>
          <SwipeableTabPanels
            selectedIndex={selectedIndex}
            onChange={(index) => {
              if (!roundDialog.isPending) setSelectedIndex(index);
            }}
            className="dialog-scroll -mx-2 min-h-0 flex-1"
          >
            {players.map((player, index) => (
              <TabPanel key={player.id} className="h-full px-2">
                <form.Field
                  name={`scores[${index}]`}
                  validators={{
                    onChange: ({ value }) => entryError(value, tiebreakerEnabled),
                  }}
                >
                  {(field) => (
                    <PointsEntry
                      name={player.name}
                      points={{
                        value: field.state.value.points,
                        error: pointsError(field.state.value.points),
                        onChange: (points) => {
                          roundDialog.clearSubmitError();
                          field.handleChange({ ...field.state.value, points });
                        },
                      }}
                      tiebreaker={
                        tiebreakerEnabled
                          ? {
                              value: field.state.value.tiebreaker,
                              error: pointsError(field.state.value.tiebreaker, "Tiebreaker"),
                              onChange: (tiebreaker) => {
                                roundDialog.clearSubmitError();
                                field.handleChange({ ...field.state.value, tiebreaker });
                              },
                            }
                          : undefined
                      }
                      disabled={roundDialog.isPending}
                      submitError={index === selectedIndex ? roundDialog.submitError : null}
                    />
                  )}
                </form.Field>
              </TabPanel>
            ))}
          </SwipeableTabPanels>
        </TabGroup>
      )}
    </GenericRoundDialog>
  );
}
