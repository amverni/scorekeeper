import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { deriveGameReadModel } from "../../data/api/gameReadModel";
import { deriveStandings } from "../../data/api/standings";
import type { CompletedGame, Player, PlayerIdentity } from "../../types";
import { PlayerRow } from "../Create/Players/PlayerRow";
import { SessionRoundDraftsProvider } from "../GameEditor/SessionRoundDrafts";
import { PlayerAvatarStack } from "../PlayerAvatarStack/PlayerAvatarStack";
import { Scoreboard } from "../Scoreboard/Scoreboard";
import { PhaseGraph } from "../Standings/PhaseGraph";
import { makePhaseGraphGame } from "../Standings/phaseGraphTestFixtures";
import { StandingsRow } from "../Standings/StandingsRow";
import { getStandingsDisplayRows } from "../Standings/standingsDialogView";
import { TiebreakerGraph } from "../Standings/TiebreakerGraph";

const identity: PlayerIdentity = { id: "amy", name: "Amy Jones", color: "#123456" };
const game: CompletedGame = {
  ...makePhaseGraphGame(),
  players: [identity.id],
  scorekeeper: "phase10",
  status: "completed",
  completionType: "normal",
  completedAt: 1,
  winnerIds: [identity.id],
  playerSnapshots: [identity],
};

function renderPresentation(players: PlayerIdentity[]) {
  const standings = deriveStandings({ game, players, rounds: [] });
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      {players.map((player) => (
        <PlayerRow key={player.id} player={player} />
      ))}
      <PlayerAvatarStack players={players} />
      <SessionRoundDraftsProvider>
        <Scoreboard view={deriveGameReadModel({ game, players, rounds: [] })} />
      </SessionRoundDraftsProvider>
      {getStandingsDisplayRows(standings).map((row) => (
        <StandingsRow key={row.player.id} row={row} />
      ))}
      <PhaseGraph series={standings.phaseGraphSeries} rows={standings.rows} totalPhases={3} />
      <TiebreakerGraph
        series={standings.tiebreakerGraphSeries}
        tiebreaker={game.settings.tiebreaker}
        rounds={[]}
      />
    </QueryClientProvider>,
  );
}

describe("Player presentation contract", () => {
  it("renders lists, scoreboards, Standings and graphs from identity, name and color alone", () => {
    expectTypeOf<PlayerIdentity>().toEqualTypeOf<Pick<Player, "id" | "name" | "color">>();
    const markup = renderPresentation([identity]);
    expect(markup).toContain("Amy Jones");
    expect(markup).toContain(">AJ</span>");
    expect(markup).toContain("background-color:#123456");
    expect(markup).toContain('stroke="#123456"');
    expect(markup).toContain("Latest phase 1: Amy Jones");
    expect(markup).toContain("Latest 0 pts: Amy Jones");
    expect(markup).not.toContain("Add round");

    const savedPlayer: Player = { ...identity, createdAt: 10, isFavorite: 1 };
    expect(renderPresentation([savedPlayer])).toBe(markup);
  });
});
