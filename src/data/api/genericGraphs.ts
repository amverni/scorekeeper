import type {
  GenericGame,
  GenericGameSettings,
  GenericGraphSeries,
  GenericScoreboardView,
  PlayerId,
  PlayerIdentity,
} from "../../types";

export function deriveGenericGraphs(
  settings: GenericGameSettings,
  players: PlayerIdentity[],
  rounds: GenericScoreboardView["rounds"],
  joins: GenericGame["playerJoins"] = [],
): Pick<GenericScoreboardView, "primaryGraph" | "tiebreakerGraph"> {
  const primary = createSeries(players, joins);
  const secondary =
    settings.mode === "points" && settings.tiebreaker ? createSeries(players, joins) : null;

  for (const round of rounds) {
    for (const score of round.scores) {
      const series = primary.get(score.playerId);
      if (!series) throw new Error("Player does not belong to the Game");
      series.points.push({
        roundNumber: round.roundNumber,
        value:
          "totalPoints" in score
            ? score.totalPoints
            : "totalWins" in score
              ? score.totalWins
              : score.totalPasses,
      });
      if (secondary) {
        const series = secondary.get(score.playerId);
        if (!series || !("totalTiebreaker" in score) || score.totalTiebreaker === undefined) {
          throw new Error("Round is missing its accumulated Tiebreaker.");
        }
        series.points.push({ roundNumber: round.roundNumber, value: score.totalTiebreaker });
      }
    }
  }

  return {
    primaryGraph: {
      metric:
        settings.mode === "points"
          ? "Points"
          : settings.mode === "singleRoundWinner"
            ? "Rounds Won"
            : "Passes",
      direction: settings.mode === "points" ? settings.pointsDirection : "high",
      series: [...primary.values()],
    },
    tiebreakerGraph:
      secondary && settings.tiebreaker
        ? {
            metric: "Tiebreaker",
            direction: settings.tiebreaker.direction,
            series: [...secondary.values()],
          }
        : null,
  };
}

function createSeries(players: PlayerIdentity[], joins: GenericGame["playerJoins"]) {
  return new Map(
    players.map(({ id, name, color }): [PlayerId, GenericGraphSeries] => [
      id,
      {
        player: { id, name, color },
        points: [
          {
            roundNumber: joins?.find(({ playerId }) => playerId === id)?.afterRoundNumber ?? 0,
            value: 0,
          },
        ],
      },
    ]),
  );
}
