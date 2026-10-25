import type {
  ActiveGame,
  CompletedGame,
  CreateGameInput,
  Game,
  GameId,
  GameListItem,
  GameReadModel,
  PhaseGameEditor,
  PhaseId,
  PhasesCardPlayerGroups,
  Player,
  Round,
  StoredGame,
  StoredRound,
} from "../../types";
import { getDB } from "../db";
import {
  deleteEmptyGame,
  deleteGameRecords,
  finalizeGame,
  requirePlayers,
  saveActiveGame,
  withGameTransaction,
} from "./gameLifecycle";
import { deriveGameReadModel } from "./gameReadModel";
import { getGamePlayers } from "./gameResults";
import { phaseRoundEdits } from "./phaseRoundEdits";
import { phasesApi } from "./phases";
import { resolveEarlyGameCompletion, resolveGameCompletion } from "./roundCompletion";
import { deriveStandings } from "./standings";

export const gamesApi = {
  getRoundEditor: phaseRoundEdits.getEditor,
  previewRoundEdit: phaseRoundEdits.preview,
  editRound: phaseRoundEdits.edit,

  async getEditor(id: GameId): Promise<PhaseGameEditor | null> {
    const db = await getDB();
    const tx = db.transaction(["games", "players"]);
    const game = await tx.objectStore("games").get(id);
    if (!game || game.scorekeeper !== "phase10") {
      await tx.done;
      return null;
    }
    if (game.status !== "active") {
      throw new Error("Reopen this Completed Game for correction before editing.");
    }
    const players = await Promise.all(
      game.players.map(async (playerId) => {
        const player = await tx.objectStore("players").get(playerId);
        if (!player) throw new Error(`Player no longer exists: ${playerId}`);
        return player;
      }),
    );
    await tx.done;
    const found = await phasesApi.getByIds(game.phaseSet.phases);
    const byId = new Map(found.map((phase) => [phase.id, phase]));
    const phases = game.phaseSet.phases.map((phaseId) => {
      const phase = byId.get(phaseId);
      if (!phase) throw new Error(`Phase no longer exists: ${phaseId}`);
      return phase;
    });
    return { game, players, phases };
  },

  async getList({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<GameListItem[]> {
    const db = await getDB();
    const tx = db.transaction(["games", "players"]);
    const store = tx.objectStore("games");
    const [games, players] = await Promise.all([
      activeOnly ? store.index("by-status").getAll("active") : store.getAll(),
      tx.objectStore("players").getAll(),
    ]);
    await tx.done;
    return games
      .filter((game) => game.scorekeeper === "phase10")
      .sort(byLastActivityDesc)
      .map((game) => ({
        id: game.id,
        status: game.status,
        lastActivityAt: game.lastActivityAt,
        players: getGamePlayers(game, players),
      }));
  },

  async getAll(): Promise<Game[]> {
    const db = await getDB();
    const games = await db.getAll("games");
    return games.filter((game) => game.scorekeeper === "phase10").sort(byLastActivityDesc);
  },

  async getActive(): Promise<ActiveGame[]> {
    const db = await getDB();
    const games = await db.getAllFromIndex("games", "by-status", "active");
    return games
      .filter(
        (game): game is ActiveGame => game.status === "active" && game.scorekeeper === "phase10",
      )
      .sort(byLastActivityDesc);
  },

  async getById(id: GameId): Promise<Game | undefined> {
    const db = await getDB();
    const game = await db.get("games", id);
    return game?.scorekeeper === "phase10" ? game : undefined;
  },

  async getView(id: GameId): Promise<GameReadModel | null> {
    const db = await getDB();
    const tx = db.transaction(["games", "players", "rounds"]);
    const game = await tx.objectStore("games").get(id);
    if (!game || game.scorekeeper !== "phase10") {
      await tx.done;
      return null;
    }
    const [players, rounds] = await Promise.all([
      Promise.all(
        (game.status === "active" ? game.activePlayers : []).map((playerId) =>
          tx.objectStore("players").get(playerId),
        ),
      ),
      tx.objectStore("rounds").index("by-game").getAll(id),
    ]);
    await tx.done;
    assertPhaseRounds(rounds);
    return deriveGameReadModel({
      game,
      players: players.filter((player): player is Player => player !== undefined),
      rounds,
    });
  },

  async getPhasePlayers(id: GameId): Promise<PhasesCardPlayerGroups> {
    const db = await getDB();
    const tx = db.transaction(["games", "players", "rounds"]);
    const game = await tx.objectStore("games").get(id);
    assertActivePhaseGame(game);
    const [players, rounds] = await Promise.all([
      Promise.all(game.activePlayers.map((playerId) => tx.objectStore("players").get(playerId))),
      tx.objectStore("rounds").index("by-game").getAll(id),
    ]);
    await tx.done;
    assertPhaseRounds(rounds);
    const { includedPlayers, rows } = deriveStandings({
      game,
      players: players.filter((player): player is Player => player !== undefined),
      rounds,
    });
    const currentPhases = new Map(
      rows
        .filter((row) => !row.progress.isFinished)
        .map((row) => [row.player.id, row.progress.currentPhase]),
    );
    const groups: PhasesCardPlayerGroups = {};
    for (const player of includedPlayers) {
      const currentPhase = currentPhases.get(player.id);
      if (currentPhase !== undefined) {
        groups[currentPhase] ??= [];
        groups[currentPhase].push(player);
      }
    }
    return groups;
  },

  async create(data: CreateGameInput): Promise<ActiveGame> {
    const now = Date.now();
    const newGame: ActiveGame = {
      ...data,
      scorekeeper: "phase10",
      id: crypto.randomUUID(),
      status: "active",
      createdAt: now,
      lastActivityAt: now,
      activePlayers: data.players,
    };
    await withGameTransaction(async (tx) => {
      await requirePlayers(tx, newGame.players);
      await tx.objectStore("games").add(newGame);
    });
    return newGame;
  },

  async addPhase(gameId: GameId, phaseId: PhaseId): Promise<void> {
    await withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(gameId);
      assertActivePhaseGame(game);
      await saveActiveGame(tx, {
        ...game,
        phaseSet: { ...game.phaseSet, phases: [...game.phaseSet.phases, phaseId] },
      });
    });
  },

  async removePhase(gameId: GameId, phaseId: PhaseId): Promise<void> {
    await withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(gameId);
      assertActivePhaseGame(game);
      const phaseIndex = game.phaseSet.phases.indexOf(phaseId);
      if (phaseIndex === -1) throw new Error("Phase not found in game");
      if (game.phaseSet.phases.length === 1) {
        throw new Error("Cannot remove the last phase from a game");
      }
      if ((await tx.objectStore("rounds").index("by-game").count(gameId)) > 0) {
        throw new Error("Cannot remove phases after rounds have been recorded");
      }
      const phases = game.phaseSet.phases.filter((_, index) => index !== phaseIndex);
      const [first, ...rest] = phases;
      if (!first) throw new Error("Cannot remove the last phase from a game");
      await saveActiveGame(tx, {
        ...game,
        phaseSet: { ...game.phaseSet, phases: [first, ...rest] },
      });
    });
  },

  finish(id: GameId): Promise<CompletedGame> {
    return withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(id);
      assertActivePhaseGame(game);
      const players = await requirePlayers(tx, game.players);
      const rounds = await tx.objectStore("rounds").index("by-game").getAll(id);
      assertPhaseRounds(rounds);
      const completed = resolveEarlyGameCompletion({
        game,
        players,
        rounds,
        completedAt: Date.now(),
      });
      await finalizeGame(tx, completed);
      return completed;
    });
  },

  resolveFinishChoice(id: GameId, choice: "continue" | "finish", token: string): Promise<Game> {
    return withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(id);
      assertActivePhaseGame(game);
      const players = await requirePlayers(tx, game.players);
      const rounds = await tx.objectStore("rounds").index("by-game").getAll(id);
      assertPhaseRounds(rounds);
      const view = deriveGameReadModel({ game, players, rounds });
      if (!view.pendingFinishChoice || view.pendingFinishChoice.token !== token) {
        throw new Error("Finish Game choice changed. Reload the Game and try again.");
      }
      if (choice !== "continue" && choice !== "finish")
        throw new Error("Invalid Finish Game choice");
      if (choice === "continue") {
        const continued: ActiveGame = { ...game, continuation: true, lastActivityAt: Date.now() };
        const completion = resolveGameCompletion({
          game: continued,
          players,
          rounds,
          completedAt: continued.lastActivityAt,
        });
        if (completion) {
          await finalizeGame(tx, completion.completedGame);
          return completion.completedGame;
        }
        await saveActiveGame(tx, continued);
        return continued;
      }
      const completed = resolveEarlyGameCompletion({
        game,
        players,
        rounds,
        completedAt: Date.now(),
      });
      await finalizeGame(tx, completed);
      return completed;
    });
  },

  deleteEmpty(id: GameId): Promise<void> {
    return deleteEmptyGame(id, "phase10");
  },

  async delete(id: GameId): Promise<void> {
    await withGameTransaction(async (tx) => {
      const game = await tx.objectStore("games").get(id);
      if (game && game.scorekeeper !== "phase10")
        throw new Error("Game belongs to another Scorekeeper");
      await deleteGameRecords(tx, id);
    });
  },
};

function byLastActivityDesc(a: Game, b: Game): number {
  return b.lastActivityAt - a.lastActivityAt || b.createdAt - a.createdAt;
}

export function assertActivePhaseGame(game: StoredGame | undefined): asserts game is ActiveGame {
  if (!game || game.scorekeeper !== "phase10") throw new Error("Phase 10 Game not found");
  if (game.status === "completed") throw new Error("Cannot update a completed game");
}

export function assertPhaseRounds(rounds: StoredRound[]): asserts rounds is Round[] {
  if (rounds.some((round) => round.scorekeeper !== "phase10")) {
    throw new Error("Round belongs to another Scorekeeper");
  }
}
