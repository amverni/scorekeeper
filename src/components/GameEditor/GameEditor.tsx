import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { TIEBREAKER_LABELS } from "../../data/constants/gameSettings";
import { gameEditorOptions, useEditGame, usePreviewGameEdit } from "../../data/hooks/useGames";
import {
  genericGameEditorOptions,
  useEditGenericGame,
  usePreviewGenericGameEdit,
} from "../../data/hooks/useGenericGames";
import type { ActiveGenericGame, GameId, GenericGameEditor, PhaseGameEditor } from "../../types";
import { formatPhaseDisplayName } from "../../utils";
import { InlineError } from "../ui";
import { GameMembershipEditor } from "./GameMembershipEditor";
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
  return (
    <output className="content-container block py-4">This Game is no longer available.</output>
  );
}

export function PhaseGameEditorPage({ gameId }: { gameId: GameId }) {
  const query = useQuery(gameEditorOptions(gameId));
  const preview = usePreviewGameEdit();
  const edit = useEditGame();
  const navigate = useNavigate();
  if (query.data && !query.isError) {
    const editor = query.data;
    return (
      <GameMembershipEditor
        key={gameId}
        editor={editor}
        experience="phaseCompan10n"
        isPending={preview.isPending || edit.isPending}
        preview={(input) => preview.mutateAsync(input)}
        save={async (input) => {
          await edit.mutateAsync(input);
          await navigate({ to: "/phaseCompan10n/game/$gameId", params: { gameId } });
        }}
        phases={
          <ol className="glass my-4 list-decimal space-y-4 rounded-2xl py-4 pr-4 pl-10 text-sm">
            {editor.phases.map((phase, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Saved Phase positions are immutable.
              <li key={index}>{formatPhaseDisplayName(phase)}</li>
            ))}
          </ol>
        }
        settings={
          <SettingsReference
            rows={[
              ["In-order phases", editor.game.settings.inOrderPhases === false ? "Off" : "On"],
              ["Tiebreaker", TIEBREAKER_LABELS[editor.game.settings.tiebreaker]],
              ["Round Skip Penalty", String(editor.game.settings.roundSkipPenalty)],
              ["Sit Out Penalty", String(editor.game.settings.sitOutPenalty)],
            ]}
          />
        }
      />
    );
  }
  return (
    <StagedGameEditor experience="phaseCompan10n" gameId={gameId} save={{ status: "unsupported" }}>
      <EditorContent query={query} />
    </StagedGameEditor>
  );
}

export function GenericGameEditorPage({ gameId }: { gameId: GameId }) {
  const query = useQuery(genericGameEditorOptions(gameId));
  const preview = usePreviewGenericGameEdit();
  const edit = useEditGenericGame();
  const navigate = useNavigate();
  if (query.data && !query.isError) {
    return (
      <GameMembershipEditor
        key={gameId}
        editor={query.data}
        experience="scorekeeper"
        isPending={preview.isPending || edit.isPending}
        preview={(input) => preview.mutateAsync(input)}
        save={async (input) => {
          await edit.mutateAsync(input);
          await navigate({ to: "/scorekeeper/game/$gameId", params: { gameId } });
        }}
        settings={<SettingsReference rows={genericSettingsRows(query.data.game)} />}
      />
    );
  }
  return (
    <StagedGameEditor experience="scorekeeper" gameId={gameId} save={{ status: "unsupported" }}>
      <EditorContent query={query} />
    </StagedGameEditor>
  );
}
