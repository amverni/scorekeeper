import { DialogTitle, Tab, TabGroup, TabPanel } from "@headlessui/react";
import { Check, Loader2, Minus, Redo, Trophy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAddRound } from "../../data/hooks/useRounds";
import type { ArrayAtLeastOne, Game, PlayerIdentity, RoundScore } from "../../types";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import {
  Button,
  Dialog,
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
  players: PlayerIdentity[];
  draft: UseAddRoundDraft;
  onGameCompleted?: () => void;
  afterLeave?: () => void;
  nextRoundNumber: number;
  expectedVersion: string;
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
  players,
  draft,
  onGameCompleted,
  afterLeave,
  nextRoundNumber,
  expectedVersion,
}: AddRoundDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const addRound = useAddRound(game.id);
  const toastRef = useRef<ToastHandle>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const completedAfterLeave = useRef(false);

  // Keep the selected player visible in the horizontal tab strip.
  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const tabs = list.querySelectorAll<HTMLElement>('[role="tab"]');
    const target = tabs[selectedIndex];
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedIndex]);

  const progress = getDraftProgress(draft.draft, game.settings.tiebreaker);
  const canSave = progress.ready && !addRound.isPending;
  const showTiebreakerEntry = game.settings.tiebreaker !== "roundsWon";
  const playerTabColumnCount = Math.max(players.length, 1);

  const handleSave = () => {
    if (!canSave || saving.current) return;
    let scores: ArrayAtLeastOne<Omit<RoundScore, "currentPhase">>;
    try {
      scores = toRoundScores(draft.draft, game.settings.tiebreaker);
    } catch {
      toastRef.current?.show("Round draft is incomplete — fix highlighted players.");
      return;
    }
    const winnerId = draft.draft.roundWinnerId;
    saving.current = true;
    addRound.mutate(
      { scores, roundWinnerId: winnerId, expectedRoundNumber: nextRoundNumber, expectedVersion },
      {
        onSuccess: (result) => {
          draft.reset();
          setSelectedIndex(0);
          completedAfterLeave.current = result.outcome === "gameCompleted";
          onClose(false);
        },
        onError: (error) => {
          toastRef.current?.show(`Couldn't save round: ${error.message} Try again.`);
        },
        onSettled: () => {
          saving.current = false;
        },
      },
    );
  };

  const handleWinnerSelect = (next: WinnerSelectValue) => {
    if (next === NO_WINNER_VALUE) {
      draft.clearRoundWinner();
      return;
    }
    draft.setRoundWinner(next);
  };

  const winnerValue: WinnerSelectValue = draft.draft.roundWinnerId ?? NO_WINNER_VALUE;
  const winnerPlayer = players.find((p) => p.id === draft.draft.roundWinnerId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      afterLeave={() => {
        afterLeave?.();
        if (completedAfterLeave.current) {
          completedAfterLeave.current = false;
          onGameCompleted?.();
        }
      }}
      dismissible={!addRound.isPending}
      sizing="workspace"
      bodyScroll="custom"
      minBodyHeight={240}
      header={<DialogTitle className="sr-only">Add Round</DialogTitle>}
      actions={
        <div className="flex shrink-0 items-center gap-3 pt-1">
          <AddRoundProgressPopover
            players={players}
            draft={draft.draft}
            tiebreaker={game.settings.tiebreaker}
          />
          <Button
            type="button"
            variant="ready"
            aria-label="Save round"
            onClick={handleSave}
            disabled={!canSave}
            className="glass relative inline-flex size-10 cursor-pointer items-center justify-center rounded-full hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {addRound.isPending ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      }
    >
      <div className="sticky top-0 z-50 h-0 shrink-0">
        <Toast ref={toastRef} />
      </div>
      <fieldset
        disabled={addRound.isPending}
        inert={addRound.isPending}
        aria-busy={addRound.isPending}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 pb-4 text-text-primary"
      >
        <TabGroup
          selectedIndex={selectedIndex}
          onChange={(index) => {
            if (!addRound.isPending) setSelectedIndex(index);
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
                      disabled={addRound.isPending}
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
              disabled={addRound.isPending || progress.winnerRequirement === "disabled"}
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
                    <ListboxOption key={player.id} value={player.id}>
                      <PlayerAvatar player={player} size={14} />
                      <span className="min-w-0 truncate">{player.name}</span>
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </SettingListRow>
            </Listbox>
          </List>

          {/* Body */}
          <div className="relative flex min-h-0 flex-1">
            <SwipeableTabPanels
              selectedIndex={selectedIndex}
              onChange={(index) => {
                if (!addRound.isPending) setSelectedIndex(index);
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
  );
}
