import { type IDBPDatabase, openDB } from "idb";
import type { Phase10DB } from "./schema";

let dbInstance: IDBPDatabase<Phase10DB> | null = null;
let opening: Promise<IDBPDatabase<Phase10DB>> | null = null;

export async function getDB(): Promise<IDBPDatabase<Phase10DB>> {
  if (dbInstance) return dbInstance;
  if (!opening) {
    opening = openDB<Phase10DB>("phase10-db", 9, {
      upgrade(db, oldVersion) {
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
