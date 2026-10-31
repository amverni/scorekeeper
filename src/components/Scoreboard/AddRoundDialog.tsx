import { DialogTitle, Tab, TabGroup, TabPanel } from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Minus, Redo, Trash2, Trophy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { gamePhaseOptionsOptions } from "../../data/hooks/useGames";
import {
  useAddRound,
  useDeletePhaseRound,
  useEditPhaseRound,
  usePreviewPhaseRoundEdit,
} from "../../data/hooks/useRounds";
import type {
  EditPhaseRoundInput,
  Game,
  PhaseRoundEditor,
  PhaseSelectionAvailability,
  PlayerIdentity,
  PlayerProgress,
} from "../../types";
import { getSelectedPhaseError } from "../../utils";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import {
  Button,
  DeleteRoundDialog,
  Dialog,
  EditImpactDialog,
  InlineError,
  List,
  Listbox,
  ListboxButton,
  ListboxLabel,
  ListboxOption,
  ListboxOptions,
  SettingListRow,
  SwipeableTabPanels,
  TabList,
  Toast,
  type ToastHandle,
} from "../ui";
import { AddRoundProgressPopover } from "./AddRoundProgressPopover";
import { getDraftProgress, getScoreEntryCompletion, toRoundScores } from "./addRoundDraft";
import { RoundResultSection } from "./RoundResultSection";
import { TiebreakerEntrySection } from "./TiebreakerEntrySection";
import type { UseAddRoundDraft } from "./useAddRoundDraft";

interface AddRoundDialogProps {
  open: boolean;
  onClose: (open: boolean) => void;
  game: Game;
  nextRoundNumber: number;
  players: Array<
    PlayerIdentity & {
      progress?: PlayerProgress;
      phaseAvailability?: PhaseSelectionAvailability;
    }
  >;
  draft: UseAddRoundDraft;
  onGameCompleted?: () => void;
  afterLeave?: () => void;
  expectedVersion: string;
  editor?: PhaseRoundEditor;
}

const NO_WINNER_VALUE = "__none__";
type WinnerSelectValue = typeof NO_WINNER_VALUE | string;
const PLAYER_TAB_NAME_LIMIT = 30;

function getPlayerTabName(name: string) {
  return name.length > PLAYER_TAB_NAME_LIMIT ? `${name.slice(0, PLAYER_TAB_NAME_LIMIT)}…` : name;
}

export function AddRoundDialog({
  open,
  onClose,
  game,
  nextRoundNumber,
  players,
  draft,
  onGameCompleted,
  afterLeave,
  expectedVersion,
  editor,
}: AddRoundDialogProps) {
  const visibleIndex = Math.max(
    0,
    players.findIndex((player) => player.id === draft.selectedPlayerId),
  );
  const setSelectedIndex = (index: number) => draft.selectPlayer(players[index]?.id ?? null);
  const [confirmation, setConfirmation] = useState<EditPhaseRoundInput | null>(null);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const addRound = useAddRound(game.id);
  const previewEdit = usePreviewPhaseRoundEdit();
  const editRound = useEditPhaseRound();
  const deleteRound = useDeletePhaseRound();
  const toastRef = useRef<ToastHandle>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const completedAfterLeave = useRef(false);
  const isPending =
    addRound.isPending || previewEdit.isPending || editRound.isPending || deleteRound.isPending;
  const locked = isPending || confirmation !== null || deleteConfirmationOpen;

  useEffect(() => {
    if (!editor || !open) return;
    const frame = requestAnimationFrame(() =>
      tabListRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [editor, open]);

  // Keep the selected player visible in the horizontal tab strip.
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const tabs = list.querySelectorAll<HTMLElement>('[role="tab"]');
    const target = tabs[visibleIndex];
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [visibleIndex]);

  const progress = getDraftProgress(
    draft.draft,
    game.settings.tiebreaker,
    editor?.countedPlayerIds,
  );
  const winnerPlayer = players.find((player) => player.id === draft.draft.roundWinnerId);
  const unavailableWinner = draft.draft.roundWinnerId !== null && !winnerPlayer;
  const canSave = progress.ready && !unavailableWinner && !locked;
  const showTiebreakerEntry = game.settings.tiebreaker !== "roundsWon";
  const playerTabColumnCount = Math.max(players.length, 1);
  const selectable = game.settings.inOrderPhases === false;
  const phases = useQuery({
    ...gamePhaseOptionsOptions(game.id),
    enabled: open && selectable,
  });
  const phaseError = (player: (typeof players)[number], selectedPhase: number | undefined) => {
    const resolved = player.progress?.selectable?.resolvedPhases ?? [];
    return getSelectedPhaseError({
      selectedPhase,
      result: draft.draft.players.find((entry) => entry.playerId === player.id)?.result ?? null,
      totalPhases: game.phaseSet.phases.length,
      availability: player.phaseAvailability ?? {
        resolvedBeforeRound: resolved,
        resolvedElsewhere: resolved,
      },
      counted: editor === undefined || editor.countedPlayerIds.includes(player.id),
    });
  };
  const phaseErrors = selectable
    ? players.flatMap((player) => {
        const selected = draft.draft.players.find(
          (entry) => entry.playerId === player.id,
        )?.selectedPhase;
        const error = phaseError(player, selected);
        return error ? [`${player.name}: ${error}`] : [];
      })
    : [];
  const phasesReady = !selectable || phases.isSuccess;
  const selectionValid = phaseErrors.length === 0 && phasesReady;

  const runSave = async (operation: () => Promise<void>, action = "save") => {
    if (saving.current) return;
    saving.current = true;
    setSubmitError(null);
    try {
      await operation();
    } catch (error) {
      setConfirmation(null);
      setDeleteConfirmationOpen(false);
      const message = `Couldn't ${action} round: ${error instanceof Error ? error.message : `Unable to ${action} Round.`} Try again.`;
      if (editor) setSubmitError(message);
      else toastRef.current?.show(message);
    } finally {
      saving.current = false;
    }
  };

  const commitEdit = async (input: EditPhaseRoundInput) => {
    const result = await editRound.mutateAsync(input);
    completedAfterLeave.current = result.outcome === "gameCompleted";
    setConfirmation(null);
    onClose(false);
  };

  const handleSave = () => {
    if (!canSave || !selectionValid) return;
    return runSave(async () => {
      const scores = toRoundScores(draft.draft, game.settings.tiebreaker, editor?.countedPlayerIds);
      const roundWinnerId = draft.draft.roundWinnerId;
      if (editor) {
        const input: EditPhaseRoundInput = {
          gameId: game.id,
          roundNumber: editor.round.roundNumber,
          version: editor.version,
          scores,
          roundWinnerId,
        };
        const impact = await previewEdit.mutateAsync(input);
        if (impact.requiresConfirmation) {
          setConfirmation(input);
          return;
        }
        await commitEdit(input);
      } else {
        const result = await addRound.mutateAsync({
          scores,
          roundWinnerId,
          expectedRoundNumber: nextRoundNumber,
          expectedVersion,
        });
        draft.reset();
        completedAfterLeave.current = result.outcome === "gameCompleted";
        onClose(false);
      }
    });
  };

  const confirmSave = () => {
    if (!confirmation) return;
    return runSave(() => commitEdit({ ...confirmation, confirmImpact: true }));
  };

  const confirmDelete = () => {
    if (!editor || !deleteConfirmationOpen) return;
    return runSave(async () => {
      const result = await deleteRound.mutateAsync({
        gameId: game.id,
        roundId: editor.round.id,
        version: editor.version,
      });
      completedAfterLeave.current = result.outcome === "gameCompleted";
      setDeleteConfirmationOpen(false);
      onClose(false);
    }, "delete");
  };

  const handleWinnerSelect = (next: WinnerSelectValue) => {
    if (next === NO_WINNER_VALUE) {
      draft.clearRoundWinner();
      return;
    }
    draft.setRoundWinner(next);
  };

  const winnerValue: WinnerSelectValue = draft.draft.roundWinnerId ?? NO_WINNER_VALUE;

  return (
    <>
      <Dialog
        open={open}
        onClose={(next) => {
          if (!saving.current && !confirmation && !deleteConfirmationOpen) onClose(next);
        }}
        afterLeave={() => {
          afterLeave?.();
          if (completedAfterLeave.current) {
            completedAfterLeave.current = false;
            onGameCompleted?.();
          }
        }}
        dismissible={!locked}
        sizing="workspace"
        bodyScroll="custom"
        minBodyHeight={240}
        header={
          <DialogTitle className="sr-only">{editor ? "Edit Round" : "Add Round"}</DialogTitle>
        }
        headerAction={
          editor && (
            <Button
              type="button"
              aria-label="Delete Round"
              disabled={locked}
              onClick={() => {
                if (saving.current) return;
                setSubmitError(null);
                setDeleteConfirmationOpen(true);
              }}
              className="size-11 shrink-0 p-0 text-pt-red-500 data-focus:outline-solid data-focus:outline-text-primary!"
            >
              <Trash2 className="size-5" aria-hidden />
            </Button>
          )
        }
        actions={
          <>
            {submitError && <InlineError message={submitError} />}
            <div className="flex shrink-0 items-center gap-3 pt-1">
              <AddRoundProgressPopover
                players={players}
                draft={draft.draft}
                tiebreaker={game.settings.tiebreaker}
                countedPlayerIds={editor?.countedPlayerIds}
              />
              <Button
                type="button"
                variant="ready"
                aria-label="Save round"
                onClick={handleSave}
                disabled={!canSave || !selectionValid}
                className="glass relative inline-flex size-10 cursor-pointer items-center justify-center rounded-full hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
              </Button>
            </div>
          </>
        }
      >
        <div className="sticky top-0 z-50 h-0 shrink-0">
          <Toast ref={toastRef} />
        </div>
        <fieldset
          disabled={locked}
          inert={locked}
          aria-busy={isPending}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 pb-4 text-text-primary"
        >
          <TabGroup
            selectedIndex={visibleIndex}
            onChange={(index) => {
              if (!locked) setSelectedIndex(index);
            }}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            {/* Player tabs — horizontal scroll on overflow */}
            <div className="relative -mx-3 -my-2">
              <div ref={tabListRef} data-add-round-tab-scroll className="overflow-x-auto px-3 py-5">
                <TabList
                  setSelectedIndex={setSelectedIndex}
                  className={["grid!", "w-fit! min-w-[calc(100%-2px)] max-w-none"].join(" ")}
                  style={{
                    gridTemplateColumns: `repeat(${playerTabColumnCount}, minmax(max-content, 1fr))`,
                  }}
                >
                  {players.map((player) => {
                    const playerDraft = draft.draft.players.find((p) => p.playerId === player.id);
                    const playerTabName = getPlayerTabName(player.name);
                    const scoreEntryComplete = playerDraft
                      ? getScoreEntryCompletion({
                          player: playerDraft,
                          tiebreaker: game.settings.tiebreaker,
                          roundWinnerId: draft.draft.roundWinnerId,
                        }).complete
                      : false;
                    return (
                      <Tab
                        key={player.id}
                        aria-label={player.name}
                        disabled={locked}
                        data-autofocus={
                          editor && player.id === players[visibleIndex]?.id ? true : undefined
                        }
                        title={player.name}
                        className={[
                          "relative z-10 inline-flex w-full min-w-12 cursor-pointer items-center gap-2 overflow-hidden",
                          "rounded-full px-3 py-1.5 text-sm font-semibold outline-none",
                          "opacity-60 hover:brightness-110 data-focus:outline-2",
                          "data-focus:outline-white/60 data-selected:opacity-100",
                        ].join(" ")}
                      >
                        <PlayerAvatar player={player} size={12} />
                        <span className="min-w-0 flex-1 text-center whitespace-nowrap">
                          {playerTabName}
                        </span>
                        <span
                          aria-hidden
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                        >
                          {scoreEntryComplete && playerDraft?.result === "completed" ? (
                            <Check className="size-3.5 text-pt-green-500" aria-hidden />
                          ) : scoreEntryComplete && playerDraft?.result === "failed" ? (
                            <X className="size-3.5 text-pt-red-500" aria-hidden />
                          ) : scoreEntryComplete && playerDraft?.result === "skipped" ? (
                            <Redo className="size-3.5 text-pt-yellow-500" aria-hidden />
                          ) : scoreEntryComplete && playerDraft?.result === "satOut" ? (
                            <Minus className="size-3.5 text-pt-blue-500" aria-hidden />
                          ) : null}
                        </span>
                      </Tab>
                    );
                  })}
                </TabList>
              </div>
            </div>

            {/* Round Winner select (shared across all tabs) */}
            <List allowOverflow className="z-30">
              <Listbox
                key="round-winner"
                value={winnerValue}
                onChange={handleWinnerSelect}
                disabled={
                  locked || (progress.winnerRequirement === "disabled" && !unavailableWinner)
                }
                className="@container/round-winner w-full min-w-0"
              >
                <SettingListRow
                  label={
                    <ListboxLabel className="flex items-center gap-2 whitespace-nowrap">
                      <Trophy className="size-4 shrink-0 text-yellow-500" aria-hidden />
                      <span className="truncate">Round Winner</span>
                    </ListboxLabel>
                  }
                >
                  <ListboxButton variant="plain" className="min-h-10 min-w-15 flex-1">
                    {winnerPlayer ? (
                      <>
                        <PlayerAvatar player={winnerPlayer} size={14} />
                        <span className="min-w-0 truncate text-right @max-[18rem]/round-winner:sr-only">
                          {winnerPlayer.name}
                        </span>
                      </>
                    ) : (
                      <span className="min-w-0 truncate text-right text-text-secondary @max-[18rem]/round-winner:sr-only">
                        {progress.winnerRequirement === "disabled" ? "No winner" : "Choose winner"}
                      </span>
                    )}
                  </ListboxButton>
                  <ListboxOptions
                    align="right"
                    anchor={{ to: "bottom end", gap: "0.25rem", padding: "1rem" }}
                    transformOrigin="top-right"
                    className="max-w-[min(20rem,calc(100vw-2rem))]"
                  >
                    <ListboxOption value={NO_WINNER_VALUE}>Choose winner</ListboxOption>
                    {players.map((player) => (
                      <ListboxOption
                        key={player.id}
                        value={player.id}
                        disabled={
                          editor !== undefined &&
                          !editor.countedPlayerIds.includes(player.id) &&
                          editor.round.roundWinnerId !== player.id
                        }
                      >
                        <PlayerAvatar player={player} size={14} />
                        <span className="min-w-0 truncate">{player.name}</span>
                      </ListboxOption>
                    ))}
                  </ListboxOptions>
                </SettingListRow>
              </Listbox>
            </List>
            {unavailableWinner && (
              <InlineError message="The selected Round Winner is no longer playing. Choose or clear the Round Winner before saving." />
            )}
            {phaseErrors.length > 0 && <InlineError message={phaseErrors.join(" ")} />}
            {selectable &&
              !phasesReady &&
              (phases.isPending ? (
                <output>Loading Phases...</output>
              ) : (
                <InlineError
                  message={phases.error?.message ?? "The Game's Phase objectives are unavailable."}
                  onRetry={() => phases.refetch()}
                />
              ))}

            {/* Body */}
            <div className="relative flex min-h-0 flex-1">
              <SwipeableTabPanels
                selectedIndex={visibleIndex}
                onChange={(index) => {
                  if (!locked) setSelectedIndex(index);
                }}
                className="dialog-scroll -mx-3 -my-3 flex min-h-0 flex-1 flex-col overflow-y-auto py-3"
              >
                {players.map((player) => {
                  const playerDraft = draft.draft.players.find((p) => p.playerId === player.id);
                  if (!playerDraft) return null;
                  const isWinner = draft.draft.roundWinnerId === player.id;

                  return (
                    <TabPanel key={player.id} className="flex flex-col px-3 pb-3">
                      <List rowVariant="content">
                        {selectable && (
                          <Listbox
                            key="phase"
                            value={playerDraft.selectedPhase}
                            onChange={(phase) => {
                              if (phase !== undefined) draft.setSelectedPhase(player.id, phase);
                            }}
                            disabled={locked || !phasesReady}
                            className="w-full min-w-0"
                          >
                            <SettingListRow label={<ListboxLabel>Phase</ListboxLabel>}>
                              <ListboxButton variant="plain">
                                Phase {playerDraft.selectedPhase}
                              </ListboxButton>
                              <ListboxOptions
                                align="right"
                                anchor={{ to: "bottom end", gap: "0.25rem", padding: "1rem" }}
                                transformOrigin="top-right"
                                className="max-w-[min(24rem,calc(100vw-2rem))]"
                              >
                                {phases.data?.map(({ phaseNumber, objective }) => (
                                  <ListboxOption
                                    key={phaseNumber}
                                    value={phaseNumber}
                                    disabled={phaseError(player, phaseNumber) !== null}
                                  >
                                    <span className="whitespace-normal">
                                      Phase {phaseNumber}: {objective}
                                    </span>
                                  </ListboxOption>
                                ))}
                              </ListboxOptions>
                            </SettingListRow>
                          </Listbox>
                        )}
                        <RoundResultSection
                          key="round-result"
                          value={playerDraft.result}
                          onChange={(next) => draft.setResult(player.id, next)}
                          expanded={playerDraft.expandedSecondary}
                          onToggleExpand={(next) => draft.setExpandedSecondary(player.id, next)}
                        />

                        {showTiebreakerEntry && (
                          <TiebreakerEntrySection
                            key="tiebreaker-entry"
                            tiebreaker={game.settings.tiebreaker}
                            value={playerDraft.score}
                            onChange={(next) => draft.setScore(player.id, next)}
                            onQuickIncrement={(button) => draft.incrementQuick(player.id, button)}
                            onQuickDecrement={(button) => draft.decrementQuick(player.id, button)}
                            onQuickReset={() => draft.resetQuick(player.id)}
                            quickCounts={playerDraft.quickCounts}
                            result={playerDraft.result}
                            isRoundWinner={isWinner}
                          />
                        )}
                      </List>
                    </TabPanel>
                  );
                })}
              </SwipeableTabPanels>
            </div>
          </TabGroup>
        </fieldset>
      </Dialog>
      <EditImpactDialog
        open={confirmation !== null}
        title="Edit round"
        isPending={isPending}
        onEdit={() => {
          if (!saving.current) setConfirmation(null);
        }}
        onSave={confirmSave}
      />
      {editor && (
        <DeleteRoundDialog
          open={deleteConfirmationOpen}
          roundNumber={editor.round.roundNumber}
          isPending={isPending}
          onCancel={() => {
            if (!saving.current) setDeleteConfirmationOpen(false);
          }}
          onDelete={confirmDelete}
        />
      )}
    </>
  );
}
