import { type IDBPDatabase, openDB, unwrap } from "idb";
import type { StoredGame, StoredRound } from "../../types";
import type { Phase10DB } from "./schema";

let dbInstance: IDBPDatabase<Phase10DB> | null = null;
let opening: Promise<IDBPDatabase<Phase10DB>> | null = null;

export async function getDB(): Promise<IDBPDatabase<Phase10DB>> {
  if (dbInstance) return dbInstance;
  if (!opening) {
    opening = openDB<Phase10DB>("phase10-db", 10, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // Version 8 deliberately resets disposable pre-Scorekeeper data, once only.
        if (oldVersion < 8) {
          for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);

          const players = db.createObjectStore("players", { keyPath: "id" });
          players.createIndex("by-isFavorite", "isFavorite");
          const games = db.createObjectStore("games", { keyPath: "id" });
          games.createIndex("by-created", "createdAt");
          games.createIndex("by-status", "status");
          const rounds = db.createObjectStore("rounds", {
            keyPath: ["gameId", "roundNumber"],
          });
          rounds.createIndex("by-game", "gameId");
          const phases = db.createObjectStore("customPhases", { keyPath: "id" });
          phases.createIndex("by-type", "type");
          db.createObjectStore("customPhaseSets", { keyPath: "id" });
          const favorites = db.createObjectStore("favorites", {
            keyPath: ["entityType", "entityId"],
          });
          favorites.createIndex("by-type", "entityType");
          db.createObjectStore("settings", { keyPath: "id" });
        }
        if (oldVersion < 10) migratePhaseOccurrences(unwrap(tx));
      },
      blocking() {
        closeDB();
      },
      terminated() {
        dbInstance = null;
      },
    });
  }
  try {
    dbInstance = await opening;
    return dbInstance;
  } finally {
    opening = null;
  }
}

export function closeDB(): void {
  dbInstance?.close();
  dbInstance = null;
}

function migratePhaseOccurrences(tx: IDBTransaction) {
  const games = tx.objectStore("games").openCursor();
  games.addEventListener("success", () => {
    const cursor = games.result;
    if (!cursor) return;
    const game: StoredGame = cursor.value;
    if (game.scorekeeper === "phase10") {
      game.phaseOccurrences = game.phaseSet.phases.map((phaseId) => ({
        id: crypto.randomUUID(),
        phaseId,
      }));
      cursor.update(game);
      const rounds = tx.objectStore("rounds").index("by-game").openCursor(game.id);
      rounds.addEventListener("success", () => {
        const roundCursor = rounds.result;
        if (!roundCursor) return;
        const round: StoredRound = roundCursor.value;
        if (round.scorekeeper === "phase10") {
          for (const score of round.scores) {
            const occurrence = game.phaseOccurrences[score.currentPhase - 1];
            if (!occurrence) throw new Error("Saved Round Phase is unavailable.");
            score.phaseOccurrenceId = occurrence.id;
          }
          roundCursor.update(round);
        }
        roundCursor.continue();
      });
    }
    cursor.continue();
  });
}
