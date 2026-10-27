import type { IDBPTransaction } from "idb";
import type {
  ActiveGame,
  ActiveGenericGame,
  GameId,
  Player,
  PlayerId,
  ScorekeeperId,
  StoredGame,
} from "../../types";
import { getDB } from "../db";
import type { Phase10DB } from "../db/schema";

const lifecycleStores = ["games", "players", "rounds", "customPhases", "customPhaseSets"] as const;
export type GameLifecycleTransaction = IDBPTransaction<
  Phase10DB,
  typeof lifecycleStores,
  "readwrite"
>;

export async function withGameTransaction<T>(
  operation: (tx: GameLifecycleTransaction) => Promise<T>,
): Promise<T> {
  const db = await getDB();
  const tx = db.transaction(lifecycleStores, "readwrite");
  // Observe IDB request failures immediately; callers still receive the original error.
  const settled = tx.done.catch((error: unknown) => error);
  try {
    const result = await operation(tx);
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch (abortError) {
      if (!(abortError instanceof DOMException && abortError.name === "InvalidStateError")) {
        throw abortError;
      }
    }
    await settled;
    throw error;
  }
}

export async function finalizeGame(
  tx: GameLifecycleTransaction,
  completed: Extract<StoredGame, { status: "completed" }>,
): Promise<void> {
  if ((await tx.objectStore("rounds").index("by-game").count(completed.id)) === 0) {
    throw new Error("A Game needs at least one saved Round before completion");
  }
  const completedGames = (await tx.objectStore("games").index("by-status").getAll("completed"))
    .filter(
      (game): game is Extract<StoredGame, { status: "completed" }> =>
        game.status === "completed" && game.scorekeeper === completed.scorekeeper,
    )
    .sort((a, b) => (b.completionOrder ?? b.completedAt) - (a.completionOrder ?? a.completedAt));
  const latest = completedGames[0];
  completed.completionOrder = Math.max(
    completed.completedAt,
    latest ? (latest.completionOrder ?? latest.completedAt) + 1 : completed.completedAt,
  );
  await tx.objectStore("games").put(completed);
  for (const game of completedGames.slice(19)) {
    await deleteGameRecords(tx, game.id);
  }
}

export function reopenGame(id: GameId, owner: "phase10", version: string): Promise<ActiveGame>;
export function reopenGame(
  id: GameId,
  owner: "generic",
  version: string,
): Promise<ActiveGenericGame>;
export function reopenGame(
  id: GameId,
  owner: ScorekeeperId,
  version: string,
): Promise<ActiveGame | ActiveGenericGame> {
  return withGameTransaction(async (tx) => {
    const game = await tx.objectStore("games").get(id);
    if (!game || game.scorekeeper !== owner) {
      throw new Error(`${owner === "phase10" ? "Phase 10" : "Generic"} Game not found`);
    }
    if (game.status !== "completed") throw new Error("Only a Completed Game can be reopened.");
    if (JSON.stringify(game) !== version) {
      throw new Error("Game changed. Reload the Game before reopening for correction.");
    }
    await requirePlayers(tx, game.players);
    const {
      completedAt: _completedAt,
      completionOrder: _completionOrder,
      completionType: _completionType,
      winnerIds: _winnerIds,
      playerSnapshots: _playerSnapshots,
      ...saved
    } = game;
    const now = Date.now();
    const active: ActiveGame | ActiveGenericGame =
      saved.scorekeeper === "phase10"
        ? {
            ...saved,
            status: "active",
            activePlayers: [...saved.players],
            deferFinishChoiceUntilSave: true,
            lastActivityAt: now,
          }
        : { ...saved, status: "active", lastActivityAt: now };
    await tx.objectStore("games").put(active);
    return active;
  });
}

export function requirePlayers(
  tx: GameLifecycleTransaction,
  ids: readonly PlayerId[],
): Promise<Player[]> {
  return Promise.all(
    ids.map(async (id) => {
      const player = await tx.objectStore("players").get(id);
      if (!player) {
        throw new Error(`Player no longer exists: ${id}`);
      }
      return player;
    }),
  );
}

export async function saveActiveGame(
  tx: GameLifecycleTransaction,
  game: ActiveGame,
): Promise<void> {
  if (game.activePlayers.some((id) => !game.players.includes(id))) {
    throw new Error("Active Players must belong to the Game");
  }
  await requirePlayers(tx, game.players);
  await tx.objectStore("games").put(game);
}

export function deleteEmptyGame(id: GameId, owner: ScorekeeperId): Promise<void> {
  return withGameTransaction(async (tx) => {
    const game = await tx.objectStore("games").get(id);
    if (!game) throw new Error("Game no longer exists");
    if (game.scorekeeper !== owner) throw new Error("Game belongs to another Scorekeeper");
    if (game.status !== "active") throw new Error("Cannot quick-delete a Completed Game");
    if ((await tx.objectStore("rounds").index("by-game").count(id)) !== 0) {
      throw new Error("Cannot quick-delete a Game with saved Rounds");
    }
    await deleteGameRecords(tx, id);
  });
}

export async function deleteGameRecords(tx: GameLifecycleTransaction, id: GameId): Promise<void> {
  const games = tx.objectStore("games");
  const game = await games.get(id);
  const rounds = tx.objectStore("rounds");
  let cursor = await rounds.index("by-game").openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await games.delete(id);
  if (!game || game.scorekeeper !== "phase10") return;

  const remainingPhaseGames = (await games.getAll()).filter(
    (other) => other.scorekeeper === "phase10",
  );
  const phaseSets = tx.objectStore("customPhaseSets");
  const persistedSet = await phaseSets.get(game.phaseSet.id);
  const phaseIds = new Set(game.phaseSet.phases);
  if (
    persistedSet?.type === "temporary" &&
    !remainingPhaseGames.some((other) => other.phaseSet.id === persistedSet.id)
  ) {
    await phaseSets.delete(persistedSet.id);
    for (const phaseId of persistedSet.phases) phaseIds.add(phaseId);
  }
  const remainingSets = await phaseSets.getAll();
  for (const phaseId of phaseIds) {
    const phase = await tx.objectStore("customPhases").get(phaseId);
    if (
      phase?.type === "temporary" &&
      !remainingPhaseGames.some((other) => other.phaseSet.phases.includes(phaseId)) &&
      !remainingSets.some((set) => set.phases.includes(phaseId))
    ) {
      await tx.objectStore("customPhases").delete(phaseId);
    }
  }
}
