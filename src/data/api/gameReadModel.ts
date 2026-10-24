import type {
  GameReadModel,
  GameRoundScoreView,
  GameRoundView,
  GameTiebreaker,
  PlayerId,
  PlayerIdentity,
  Round,
  StandingsDerivation,
  StandingsInput,
  StandingsRow,
} from "../../types";
import {
  formatTiebreakerValue,
  getDealerId,
  getInitialPlayerProgress,
  getProgressAfterScore,
  getRoundTiebreakerValue,
  isLowerBetterTiebreaker,
  toTiebreakerStandingValue,
} from "../../utils";
import { getGamePlayers } from "./gameResults";

export function deriveGameReadModel({ game, players, rounds }: StandingsInput): GameReadModel {
  if (game.scorekeeper !== "phase10" || rounds.some((round) => round.scorekeeper !== "phase10")) {
    throw new Error("Phase 10 Standings require Phase 10 Game and Round data");
  }
  const includedPlayers = getGamePlayers(game, players);
  const sortedRounds = rounds.slice().sort((a, b) => a.roundNumber - b.roundNumber);
  const totalPhases = game.phaseSet.phases.length;
  const gameOrder = new Map(game.players.map((playerId, index) => [playerId, index]));
  const columnIds = game.status === "active" ? game.activePlayers : game.players;
  const playerById = new Map(includedPlayers.map((player) => [player.id, player]));
  const orderedPlayers = columnIds.map((id) => {
    const player = playerById.get(id);
    if (!player) throw new Error(`Player identity not found: ${id}`);
    return player;
  });
  const roundViews: GameRoundView[] = [];
  const stateByPlayerId = new Map(
    includedPlayers.map((player) => [
      player.id,
      {
        progress: getInitialPlayerProgress(),
        tiebreakerTotal: 0,
        phasePoints: [{ roundNumber: 0, ...getInitialPlayerProgress() }],
        tiebreakerPoints: [
          {
            roundNumber: 0,
            value: 0,
            standingValue: toTiebreakerStandingValue(0, game.settings.tiebreaker),
          },
        ],
      },
    ]),
  );

  for (const round of sortedRounds) {
    const roundScores = new Map<PlayerId, GameRoundScoreView>();
    for (const player of includedPlayers) {
      const state = stateByPlayerId.get(player.id);
      if (!state) continue;

      const score = round.scores.find((entry) => entry.playerId === player.id);
      if (score) {
        state.progress = getProgressAfterScore(score, state.progress, totalPhases);
      }
      const tiebreakerValue = getRoundTiebreakerValue(
        round,
        player.id,
        game.settings.tiebreaker,
        score,
      );
      state.tiebreakerTotal += tiebreakerValue;
      roundScores.set(player.id, {
        playerId: player.id,
        source: score,
        tiebreakerValue,
        runningTiebreakerTotal: state.tiebreakerTotal,
      });
      state.phasePoints.push({
        roundNumber: round.roundNumber,
        ...state.progress,
      });
      state.tiebreakerPoints.push({
        roundNumber: round.roundNumber,
        value: state.tiebreakerTotal,
        standingValue: toTiebreakerStandingValue(state.tiebreakerTotal, game.settings.tiebreaker),
      });
    }
    roundViews.push({
      source: round,
      dealerId: getDealerId(round.roundNumber, columnIds),
      scores: orderedPlayers.map((player) => {
        const score = roundScores.get(player.id);
        if (!score) throw new Error(`Player Round interpretation not found: ${player.id}`);
        return score;
      }),
    });
  }

  const standingsRows = includedPlayers.map((player) => {
    const state = stateByPlayerId.get(player.id);
    const progress = state?.progress ?? getInitialPlayerProgress();
    const tiebreakerTotal = state?.tiebreakerTotal ?? 0;
    return {
      player,
      place: 1,
      showPlace: true,
      progress,
      tiebreakerTotal,
      formattedTiebreaker: formatTiebreakerValue(tiebreakerTotal, game.settings.tiebreaker),
    };
  });
  const sortedRows = standingsRows.sort((a, b) => {
    const progressComparison = b.progress.standingValue - a.progress.standingValue;
    if (progressComparison !== 0) return progressComparison;

    const tiebreakerComparison = compareTiebreakerTotals(
      a.tiebreakerTotal,
      b.tiebreakerTotal,
      game.settings.tiebreaker,
    );
    if (tiebreakerComparison !== 0) return tiebreakerComparison;

    const roundWinnerComparison =
      getMostRecentRoundWin(b.player.id, sortedRounds) -
      getMostRecentRoundWin(a.player.id, sortedRounds);
    if (roundWinnerComparison !== 0) return roundWinnerComparison;

    return (gameOrder.get(a.player.id) ?? 0) - (gameOrder.get(b.player.id) ?? 0);
  });
  const rows = applyCompetitionPlaces(sortedRows);
  const hasFinishedPlayers = rows.some((row) => row.progress.isFinished);
  const gameWinner =
    game.status === "completed"
      ? (rows.find((row) => row.player.id === game.winnerIds[0]) ?? null)
      : hasFinishedPlayers
        ? (rows[0] ?? null)
        : null;

  const standings: StandingsDerivation = {
    includedPlayers,
    rows,
    phaseGraphSeries: includedPlayers.map((player) => ({
      player,
      points: stateByPlayerId.get(player.id)?.phasePoints ?? [],
    })),
    tiebreakerGraphSeries: includedPlayers.map((player) => ({
      player,
      points: stateByPlayerId.get(player.id)?.tiebreakerPoints ?? [],
    })),
    hasFinishedPlayers,
    gameWinner,
  };

  return {
    game,
    players: orderedPlayers.map((player) => {
      const state = stateByPlayerId.get(player.id);
      if (!state) throw new Error(`Player interpretation not found: ${player.id}`);
      return {
        ...player,
        progress: state.progress,
        tiebreakerTotal: state.tiebreakerTotal,
        formattedTiebreaker: formatTiebreakerValue(state.tiebreakerTotal, game.settings.tiebreaker),
      };
    }),
    rounds: roundViews,
    nextRoundNumber: sortedRounds.length + 1,
    upcomingDealerId:
      game.status === "active" ? getDealerId(sortedRounds.length + 1, columnIds) : null,
    standings,
    tiebreakerGraphPlayerOrder: includedPlayers
      .slice()
      .sort(
        (a, b) =>
          getMostRecentRoundWin(b.id, sortedRounds) - getMostRecentRoundWin(a.id, sortedRounds) ||
          (gameOrder.get(a.id) ?? 0) - (gameOrder.get(b.id) ?? 0),
      )
      .map((player) => player.id),
  };
}

function compareTiebreakerTotals(
  first: number,
  second: number,
  tiebreaker: GameTiebreaker,
): number {
  if (isLowerBetterTiebreaker(tiebreaker)) {
    return first - second;
  }

  return second - first;
}

function getMostRecentRoundWin(playerId: PlayerId, rounds: readonly Round[]): number {
  let mostRecent = -1;
  for (const round of rounds) {
    if (round.roundWinnerId === playerId) {
      mostRecent = round.roundNumber;
    }
  }

  return mostRecent;
}

function applyCompetitionPlaces<TPlayer extends PlayerIdentity>(
  rows: StandingsRow<TPlayer>[],
): StandingsRow<TPlayer>[] {
  let place = 1;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    if (
      previous &&
      previous.progress.isFinished === row.progress.isFinished &&
      previous.progress.currentPhase === row.progress.currentPhase &&
      previous.tiebreakerTotal === row.tiebreakerTotal
    ) {
      return {
        ...row,
        place,
        showPlace: false,
      };
    }

    place = index + 1;
    return {
      ...row,
      place,
      showPlace: true,
    };
  });
}
