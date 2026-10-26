import type { EditGenericGameInput, GameId, GenericGameEditor } from "../../types";
import {
  type GameLifecycleTransaction,
  requirePlayers,
  withGameTransaction,
} from "./gameLifecycle";
import { assertSavedSeats } from "./gameMembership";
import {
  assertGenericGame,
  deriveGenericScoreboard,
  genericRoundPlayerIds,
} from "./genericScoring";

export const genericGameEdits = {
  getEditor(id: GameId): Promise<GenericGameEditor | null> {
    return withGameTransaction(async (tx) => {
      const saved = await loadEditor(tx, id);
      if (!saved) return null;
      const { game, players, rounds, version } = saved;
      const { withdrawnPlayers } = deriveGenericScoreboard(game, players, rounds);
      return { game, players, version, withdrawnPlayers };
    });
  },

  previewEdit(input: EditGenericGameInput) {
    return withGameTransaction(async (tx) => {
      const { requiresConfirmation } = await evaluateEdit(tx, input);
      return { requiresConfirmation };
    });
  },

  edit(input: EditGenericGameInput) {
    return withGameTransaction(async (tx) => {
      const { game, requiresConfirmation } = await evaluateEdit(tx, input);
      if (requiresConfirmation && input.confirmImpact !== true) {
        throw new Error("This edit will change game results. Confirm the edit before saving.");
      }
      const saved = { ...game, lastActivityAt: Date.now() };
      await tx.objectStore("games").put(saved);
      return saved;
    });
  },
};

async function loadEditor(tx: GameLifecycleTransaction, id: GameId) {
  const game = await tx.objectStore("games").get(id);
  if (!game || game.scorekeeper !== "generic") return null;
  if (game.status !== "active") {
    throw new Error("Reopen this Completed Game for correction before editing.");
  }
  assertGenericGame(game);
  const [players, rounds] = await Promise.all([
    requirePlayers(tx, game.players),
    tx.objectStore("rounds").index("by-game").getAll(id),
  ]);
  return { game, players, rounds, version: JSON.stringify([game, rounds]) };
}

async function evaluateEdit(tx: GameLifecycleTransaction, input: EditGenericGameInput) {
  const saved = await loadEditor(tx, input.gameId);
  if (!saved) throw new Error("Generic Game not found.");
  const { game, players, rounds, version } = saved;
  if (input.version !== version) {
    throw new Error("Game history changed. Close and reopen Edit game to load the saved values.");
  }
  const savedIds = new Set(game.players);
  assertSavedSeats(game.players, input.players);
  const addedIds = input.players.filter((id) => !savedIds.has(id));
  const addedPlayers = await requirePlayers(tx, addedIds);
  const afterRoundNumber = rounds.reduce((latest, round) => Math.max(latest, round.roundNumber), 0);
  const eligible = new Set(genericRoundPlayerIds(game, afterRoundNumber + 1));
  const withdrawnPlayers =
    input.withdrawnPlayers === undefined
      ? game.players.filter((id) => !eligible.has(id))
      : input.withdrawnPlayers;
  if (
    !Array.isArray(withdrawnPlayers) ||
    new Set(withdrawnPlayers).size !== withdrawnPlayers.length ||
    withdrawnPlayers.some((id) => !savedIds.has(id))
  ) {
    throw new Error("Withdrawn Players must be unique saved Game members.");
  }
  const withdrawn = new Set(withdrawnPlayers);
  const changes = game.players
    .filter((id) => !eligible.has(id) !== withdrawn.has(id))
    .map((playerId) => ({
      playerId,
      afterRoundNumber,
      type: withdrawn.has(playerId) ? ("withdrawal" as const) : ("rejoin" as const),
    }));
  if (addedIds.length === 0 && changes.length === 0) {
    throw new Error("No Game membership changes to save.");
  }
  if (
    changes.some(({ type }) => type === "withdrawal") &&
    input.players.length - withdrawn.size < 2
  ) {
    throw new Error("Withdrawal must leave at least two eligible Players.");
  }
  const proposed = {
    ...game,
    players: [...input.players],
    playerJoins: [
      ...(game.playerJoins ?? []),
      ...addedIds.map((playerId) => ({ playerId, afterRoundNumber })),
    ],
    playerMembershipChanges: [...(game.playerMembershipChanges ?? []), ...changes],
  };
  deriveGenericScoreboard(proposed, [...players, ...addedPlayers], rounds);
  return {
    game: proposed,
    // Join changes competitive eligibility even when existing places remain the same.
    requiresConfirmation: rounds.length > 0,
  };
}
