import type {
  GameReadModel,
  GameRoundView,
  GameTiebreaker,
  PlayerId,
  StandingsDerivation,
  StandingsInput,
} from "../../types";
import {
  formatTiebreakerValue,
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
  const version = JSON.stringify([game, sortedRounds]);
  const totalPhases = game.phaseSet.phases.length;
  const gameOrder = new Map(game.players.map((playerId, index) => [playerId, index]));
  const columnIds = game.status === "active" ? game.activePlayers : game.players;
  const playerById = new Map(includedPlayers.map((player) => [player.id, player]));
  const orderedPlayers = columnIds.map((id) => {
    const player = playerById.get(id);
    if (!player) throw new Error(`Player identity not found: ${id}`);
    return player;
  });
  const stateByPlayerId = new Map(
    includedPlayers.map((player) => [
      player.id,
      {
        progress: getInitialPlayerProgress(),
        tiebreakerTotal: 0,
        finishingRound: null as number | null,
        mostRecentWin: -1,
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
  const stateFor = (id: PlayerId) => {
    const state = stateByPlayerId.get(id);
    if (!state) throw new Error(`Player interpretation not found: ${id}`);
    return state;
  };
  let nextSeat = 0;
  const nextDealer = (participatingIds: readonly PlayerId[]) => {
    for (let offset = 0; offset < game.players.length; offset++) {
      const index = (nextSeat + offset) % game.players.length;
      const id = game.players[index];
      if (participatingIds.includes(id)) return id;
    }
    return null;
  };
  let gameEndingRound: number | null = null;
  let automaticCompletion = false;
  const roundViews: GameRoundView[] = [];

  for (const round of sortedRounds) {
    const counted = gameEndingRound === null;
    const participatingIds = columnIds.filter(
      (id) =>
        !stateFor(id).progress.isFinished && round.scores.some((score) => score.playerId === id),
    );
    const dealerId = counted ? nextDealer(participatingIds) : null;
    if (dealerId !== null) nextSeat = (gameOrder.get(dealerId) ?? 0) + 1;
    const scores = orderedPlayers.map((player) => {
      const state = stateFor(player.id);
      const recorded = round.scores.find((entry) => entry.playerId === player.id);
      const entryCounts = counted && !state.progress.isFinished && recorded !== undefined;
      // Phase assignment is derived from counted history, never from an excluded entry.
      const effectiveScore = entryCounts
        ? { ...recorded, currentPhase: state.progress.currentPhase }
        : recorded;
      const sourceTiebreakerValue = getRoundTiebreakerValue(
        round,
        player.id,
        game.settings.tiebreaker,
        recorded,
      );
      const tiebreakerValue = entryCounts ? sourceTiebreakerValue : 0;
      const wasFinished = state.progress.isFinished;
      if (entryCounts && effectiveScore) {
        state.progress = getProgressAfterScore(effectiveScore, state.progress, totalPhases);
        state.tiebreakerTotal += tiebreakerValue;
        if (round.roundWinnerId === player.id) state.mostRecentWin = round.roundNumber;
        if (state.progress.isFinished) state.finishingRound = round.roundNumber;
      }
      if (counted && !wasFinished) {
        state.phasePoints.push({ roundNumber: round.roundNumber, ...state.progress });
        state.tiebreakerPoints.push({
          roundNumber: round.roundNumber,
          value: state.tiebreakerTotal,
          standingValue: toTiebreakerStandingValue(state.tiebreakerTotal, game.settings.tiebreaker),
        });
      }
      return {
        playerId: player.id,
        source: recorded,
        phaseNumber: effectiveScore?.currentPhase ?? null,
        counted: entryCounts,
        sourceTiebreakerValue,
        tiebreakerValue,
        runningTiebreakerTotal: state.tiebreakerTotal,
      };
    });
    roundViews.push({ source: round, dealerId, scores, counted });
    if (counted) {
      const finishedCount = includedPlayers.filter(
        (player) => stateFor(player.id).progress.isFinished,
      ).length;
      automaticCompletion = finishedCount > 0 && finishedCount >= includedPlayers.length - 1;
      if (automaticCompletion || (finishedCount > 0 && !game.continuation)) {
        gameEndingRound = round.roundNumber;
      }
    }
  }

  const sortedRows = includedPlayers
    .map((player) => {
      const state = stateFor(player.id);
      return {
        player,
        place: 1,
        showPlace: true,
        progress: state.progress,
        finishingRound: state.finishingRound,
        tiebreakerTotal: state.tiebreakerTotal,
        formattedTiebreaker: formatTiebreakerValue(state.tiebreakerTotal, game.settings.tiebreaker),
      };
    })
    .sort((a, b) => {
      const finishComparison = (a.finishingRound ?? Infinity) - (b.finishingRound ?? Infinity);
      if (a.finishingRound !== b.finishingRound) return finishComparison;
      return (
        b.progress.standingValue - a.progress.standingValue ||
        compareTiebreakerTotals(a.tiebreakerTotal, b.tiebreakerTotal, game.settings.tiebreaker) ||
        stateFor(b.player.id).mostRecentWin - stateFor(a.player.id).mostRecentWin ||
        (gameOrder.get(a.player.id) ?? 0) - (gameOrder.get(b.player.id) ?? 0)
      );
    });
  let place = 1;
  const rows = sortedRows.map((row, index) => {
    const previous = sortedRows[index - 1];
    const sharedPlace =
      previous !== undefined &&
      !previous.progress.isFinished &&
      !row.progress.isFinished &&
      previous.progress.standingValue === row.progress.standingValue &&
      previous.tiebreakerTotal === row.tiebreakerTotal;
    if (!sharedPlace) place = index + 1;
    return { ...row, place, showPlace: !sharedPlace };
  });
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
      points: stateFor(player.id).phasePoints,
    })),
    tiebreakerGraphSeries: includedPlayers.map((player) => ({
      player,
      points: stateFor(player.id).tiebreakerPoints,
    })),
    hasFinishedPlayers,
    gameWinner,
  };
  const pendingFinishChoice =
    game.status === "active" && !game.continuation && gameWinner && !automaticCompletion
      ? { winner: gameWinner.player, token: version }
      : null;
  const playingPlayerIds = columnIds.filter((id) => !stateFor(id).progress.isFinished);
  const playerViews = orderedPlayers.map((player) => {
    const state = stateFor(player.id);
    const row = rows.find((row) => row.player.id === player.id);
    if (!row) throw new Error(`Player Standings not found: ${player.id}`);
    return {
      ...player,
      progress: state.progress,
      tiebreakerTotal: state.tiebreakerTotal,
      formattedTiebreaker: row.formattedTiebreaker,
      finishingRound: state.finishingRound,
      finishingPlace: state.progress.isFinished ? row.place : null,
      place: row.place,
    };
  });

  return {
    game,
    version,
    players: playerViews,
    rounds: roundViews,
    nextRoundNumber: (sortedRounds.at(-1)?.roundNumber ?? 0) + 1,
    upcomingDealerId:
      game.status === "active" && !pendingFinishChoice && !automaticCompletion
        ? nextDealer(playingPlayerIds)
        : null,
    pendingFinishChoice,
    gameEndingRound:
      gameEndingRound ??
      (game.status === "completed" ? (sortedRounds.at(-1)?.roundNumber ?? null) : null),
    automaticCompletion,
    playingPlayers: playerViews.filter((player) => !player.progress.isFinished),
    standings,
    tiebreakerGraphPlayerOrder: includedPlayers
      .slice()
      .sort(
        (a, b) =>
          stateFor(b.id).mostRecentWin - stateFor(a.id).mostRecentWin ||
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
  return isLowerBetterTiebreaker(tiebreaker) ? first - second : second - first;
}
