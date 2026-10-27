import type {
  ActiveGenericGame,
  CompletedGenericGame,
  CreateGenericGameInput,
  GameId,
  GameListItem,
  GenericGame,
  GenericGameView,
  GenericScoreboardView,
  Player,
  PlayerId,
  StoredGame,
} from "../../types";
import { getDB } from "../db";
import {
  deleteEmptyGame,
  deleteGameRecords,
  finalizeGame,
  reopenGame,
  requirePlayers,
  withGameTransaction,
} from "./gameLifecycle";
import { genericGameEdits } from "./genericGameEdits";
import {
  assertGenericGame,
  assertGenericSettings,
  deriveGenericScoreboard,
} from "./genericScoring";

export const genericGamesApi = {
  ...genericGameEdits,

  async getList({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<GameListItem[]> {
    const db = await getDB();
    const tx = db.transaction(["games", "players"]);
    const store = tx.objectStore("games");
    const games = activeOnly
      ? await store.index("by-status").getAll("active")
      : await store.getAll();
    const views = await Promise.all(
      games
        .filter((game) => game.scorekeeper === "generic")
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.createdAt - a.createdAt)
        .map((game) => resolveView(game, (playerId) => tx.objectStore("players").get(playerId))),
    );
    await tx.done;
    return views.map(({ game, players }) => ({
      id: game.id,
      name: game.name,
      status: game.status,
      lastActivityAt: game.lastActivityAt,
      players,
    }));
  },

  async create(input: CreateGenericGameInput): Promise<ActiveGenericGame> {
    if (!Array.isArray(input.players) || input.players.length === 0) {
      throw new Error("A Generic Game requires at least one Player");
    }
    if (new Set(input.players).size !== input.players.length) {
      throw new Error("Players must be unique");
    }
    const { settings } = input;
    assertGenericSettings(settings);
    const now = Date.now();
    const game: ActiveGenericGame = {
      id: crypto.randomUUID(),
      scorekeeper: "generic",
      name: input.name?.trim() || undefined,
      status: "active",
      players: [...input.players],
      settings:
        settings.mode === "points"
          ? {
              mode: "points",
              pointsDirection: settings.pointsDirection,
              tiebreaker: settings.tiebreaker ? { direction: settings.tiebreaker.direction } : null,
              dealer: settings.dealer,
            }
          : { mode: settings.mode, tiebreaker: null, dealer: settings.dealer },
      createdAt: now,
      lastActivityAt: now,
    };
    await withGameTransaction(async (tx) => {
      await requirePlayers(tx, game.players);
      await tx.objectStore("games").add(game);
    });
    return game;
  },

  async getById(id: GameId): Promise<GenericGame | undefined> {
    const db = await getDB();
    const game = await db.get("games", id);
    return game?.scorekeeper === "generic" ? game : undefined;
  },

  async getDetail(id: GameId): Promise<GenericGameView | null> {
    const db = await getDB();
    const tx = db.transaction(["games", "players"]);
    const game = await tx.objectStore("games").get(id);
    if (!game || game.scorekeeper !== "generic") return null;
    const view = await resolveView(game, (playerId) => tx.objectStore("players").get(playerId));
    await tx.done;
    return view;
  },

  async getScoreboard(id: GameId): Promise<GenericScoreboardView | null> {
    const db = await getDB();
    const tx = db.transaction(["games", "players", "rounds"]);
    const game = await tx.objectStore("games").get(id);
    if (!game || game.scorekeeper !== "generic") return null;
    assertGenericGame(game);
    const [view, rounds] = await Promise.all([
      resolveView(game, (playerId) => tx.objectStore("players").get(playerId)),
      tx.objectStore("rounds").index("by-game").getAll(id),
    ]);
    await tx.done;
    return deriveGenericScoreboard(game, view.players, rounds);
  },

  async getActive(): Promise<ActiveGenericGame[]> {
    const db = await getDB();
    return selectActive(await db.getAllFromIndex("games", "by-status", "active"));
  },

  async getActiveViews(): Promise<GenericGameView[]> {
    const db = await getDB();
    const tx = db.transaction(["games", "players"]);
    const games = selectActive(await tx.objectStore("games").index("by-status").getAll("active"));
    const views = await Promise.all(
      games.map((game) => resolveView(game, (playerId) => tx.objectStore("players").get(playerId))),
    );
    await tx.done;
    return views;
  },

  reopen(id: GameId, version: string): Promise<ActiveGenericGame> {
    return reopenGame(id, "generic", version);
  },

  finish(id: GameId): Promise<CompletedGenericGame> {
    return withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(id);
      if (!game || game.scorekeeper !== "generic") throw new Error("Generic Game not found");
      if (game.status !== "active") throw new Error("Cannot finish a Completed Game");
      assertGenericGame(game);
      const players = await requirePlayers(tx, game.players);
      const rounds = await tx.objectStore("rounds").index("by-game").getAll(id);
      const { standings } = deriveGenericScoreboard(game, players, rounds);
      const [first, ...tied] = standings.filter((row) => row.place === 1);
      if (!first) throw new Error("Cannot finish a Game without Players in Standings");
      const now = Date.now();
      const completed: CompletedGenericGame = {
        ...game,
        status: "completed",
        completionType: "manual",
        completedAt: now,
        lastActivityAt: now,
        winnerIds: [first.player.id, ...tied.map((row) => row.player.id)],
        playerSnapshots: players.map(({ id, name, color }) => ({ id, name, color })),
      };
      await finalizeGame(tx, completed);
      return completed;
    });
  },

  deleteEmpty(id: GameId): Promise<void> {
    return deleteEmptyGame(id, "generic");
  },

  async delete(id: GameId): Promise<void> {
    await withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(id);
      if (game && game.scorekeeper !== "generic") {
        throw new Error("Game belongs to another Scorekeeper");
      }
      await deleteGameRecords(tx, id);
    });
  },
};

function selectActive(games: StoredGame[]): ActiveGenericGame[] {
  return games
    .filter(
      (game): game is ActiveGenericGame =>
        game.scorekeeper === "generic" && game.status === "active",
    )
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.createdAt - a.createdAt);
}

async function resolveView(
  game: GenericGame,
  loadPlayer: (id: PlayerId) => Promise<Player | undefined>,
): Promise<GenericGameView> {
  const players = await Promise.all(
    game.players.map(async (id) => {
      const player =
        game.status === "completed"
          ? game.playerSnapshots.find((snapshot) => snapshot.id === id)
          : await loadPlayer(id);
      if (!player) throw new Error(`Player no longer exists: ${id}`);
      return player;
    }),
  );
  return { game, players };
}
