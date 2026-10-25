import { TabPanel } from "@headlessui/react";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TIEBREAKER_LABELS } from "../../data/constants/gameSettings";
import { gameEditorOptions } from "../../data/hooks/useGames";
import { genericGameEditorOptions } from "../../data/hooks/useGenericGames";
import type {
  ActiveGenericGame,
  GameId,
  GenericGameEditor,
  PhaseGameEditor,
  PlayerIdentity,
} from "../../types";
import { formatPhaseDisplayName } from "../../utils";
import { GameSetupTabs } from "../Create/GameSetupTabs";
import { PlayerRow } from "../Create/Players/PlayerRow";
import { InlineError, List, ScrollFade } from "../ui";
import { StagedGameEditor } from "./StagedGameEditor";

function SettingsReference({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="glass my-4 divide-y divide-(--surface-border) rounded-2xl px-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-w-0 items-center justify-between gap-3 py-4 text-sm">
          <dt className="min-w-0 font-medium">{label}</dt>
          <dd className="min-w-0 wrap-anywhere text-right">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlayersReference({ players }: { players: PlayerIdentity[] }) {
  return (
    <div className="py-4">
      <List role="list" rowVariant="compact-content">
        {players.map((player) => (
          <li key={player.id} className="list-none">
            <PlayerRow player={player} />
          </li>
        ))}
      </List>
    </div>
  );
}

function genericSettingsRows(game: ActiveGenericGame): Array<[string, string]> {
  const { settings } = game;
  const rows: Array<[string, string]> = [
    ["Game name", game.name || "None"],
    [
      "Scoring Mode",
      settings.mode === "points"
        ? "Points"
        : settings.mode === "passFail"
          ? "Pass/Fail"
          : "Single Round Winner",
    ],
  ];
  if (settings.mode === "points") {
    rows.push(
      ["Points Direction", settings.pointsDirection === "high" ? "Higher wins" : "Lower wins"],
      ["Enable Tiebreaker", settings.tiebreaker ? "On" : "Off"],
    );
    if (settings.tiebreaker) {
      rows.push([
        "Tiebreaker Direction",
        settings.tiebreaker.direction === "high" ? "Higher wins" : "Lower wins",
      ]);
    }
  }
  rows.push(["Dealer", settings.dealer ? "On" : "Off"]);
  return rows;
}

function Inspection({ editor }: { editor: PhaseGameEditor | GenericGameEditor }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { game, players } = editor;
  const rows: Array<[string, string]> =
    game.scorekeeper === "phase10"
      ? [
          ["In-order phases", "On"],
          ["Tiebreaker", TIEBREAKER_LABELS[game.settings.tiebreaker]],
          ["Round Skip Penalty", String(game.settings.roundSkipPenalty)],
          ["Sit Out Penalty", String(game.settings.sitOutPenalty)],
        ]
      : genericSettingsRows(game);
  return (
    <GameSetupTabs
      experience={game.scorekeeper === "phase10" ? "phaseCompan10n" : "scorekeeper"}
      selectedIndex={selectedIndex}
      onChange={setSelectedIndex}
    >
      <TabPanel className="h-full px-4">
        <ScrollFade className="h-full -mx-6 px-6 pb-(--slant)">
          <PlayersReference players={players} />
        </ScrollFade>
      </TabPanel>
      {"phases" in editor && (
        <TabPanel className="h-full px-4">
          <ScrollFade className="h-full -mx-6 px-6 pb-(--slant)">
            <ol className="glass my-4 list-decimal space-y-4 rounded-2xl py-4 pr-4 pl-10 text-sm">
              {editor.phases.map((phase, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Saved Phase positions are immutable, and repeated objectives are separate positions.
                <li key={index}>{formatPhaseDisplayName(phase)}</li>
              ))}
            </ol>
          </ScrollFade>
        </TabPanel>
      )}
      <TabPanel className="h-full px-4">
        <ScrollFade className="h-full -mx-6 px-6 pb-(--slant)">
          <SettingsReference rows={rows} />
        </ScrollFade>
      </TabPanel>
    </GameSetupTabs>
  );
}

function EditorContent({
  query,
}: {
  query: UseQueryResult<PhaseGameEditor | GenericGameEditor | null>;
}) {
  if (query.isError) {
    return (
      <div className="content-container py-4">
        <InlineError message={query.error.message} onRetry={() => query.refetch()} />
      </div>
    );
  }
  if (query.isPending) {
    return <output className="content-container block py-4">Loading Game...</output>;
  }
  return query.data ? (
    <Inspection editor={query.data} />
  ) : (
    <output className="content-container block py-4">This Game is no longer available.</output>
  );
}

export function PhaseGameEditorPage({ gameId }: { gameId: GameId }) {
  const query = useQuery(gameEditorOptions(gameId));
  return (
    <StagedGameEditor experience="phaseCompan10n" gameId={gameId} save={{ status: "unsupported" }}>
      <EditorContent query={query} />
    </StagedGameEditor>
  );
}

export function GenericGameEditorPage({ gameId }: { gameId: GameId }) {
  const query = useQuery(genericGameEditorOptions(gameId));
  return (
    <StagedGameEditor experience="scorekeeper" gameId={gameId} save={{ status: "unsupported" }}>
      <EditorContent query={query} />
    </StagedGameEditor>
  );
}
