import type { EditGenericGameInput, GameId, GenericGameEditor } from "../../types";
import {
  type GameLifecycleTransaction,
  requirePlayers,
  withGameTransaction,
} from "./gameLifecycle";
import { assertGenericGame, deriveGenericScoreboard } from "./genericScoring";

export const genericGameEdits = {
  getEditor(id: GameId): Promise<GenericGameEditor | null> {
    return withGameTransaction(async (tx) => {
      const saved = await loadEditor(tx, id);
      if (!saved) return null;
      const { game, players, version } = saved;
      return { game, players, version };
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
  if (
    !Array.isArray(input.players) ||
    input.players.length <= game.players.length ||
    new Set(input.players).size !== input.players.length ||
    input.players.some((id) => typeof id !== "string" || id.length === 0) ||
    game.players.some((id, index) => input.players[index] !== id)
  ) {
    throw new Error(
      "Add new Players after the saved Seating Order. No other roster edits are supported.",
    );
  }
  const addedIds = input.players.slice(game.players.length);
  const addedPlayers = await requirePlayers(tx, addedIds);
  const afterRoundNumber = rounds.reduce((latest, round) => Math.max(latest, round.roundNumber), 0);
  const proposed = {
    ...game,
    players: [...input.players],
    playerJoins: [
      ...(game.playerJoins ?? []),
      ...addedIds.map((playerId) => ({ playerId, afterRoundNumber })),
    ],
  };
  deriveGenericScoreboard(proposed, [...players, ...addedPlayers], rounds);
  return {
    game: proposed,
    // Join changes competitive eligibility even when existing places remain the same.
    requiresConfirmation: rounds.length > 0,
  };
}
