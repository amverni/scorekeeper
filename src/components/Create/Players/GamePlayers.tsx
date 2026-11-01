import { Minus, Plus } from "lucide-react";
import type { PlayerId } from "../../../types";
import { shuffle } from "../../../utils";
import type { SortableItem } from "../../ui";
import { List, ListRowButton } from "../../ui";
import { useGamePlayers, useRemovePlayer, useReorderPlayers } from "../PlayerSelectionContext";
import { AddPlayerButton } from "./AddPlayerButton";
import { PlayerRow } from "./PlayerRow";
import { ShufflePlayersButton } from "./ShufflePlayersButton";

export interface GamePlayersMembership {
  lockedPlayerIds: PlayerId[];
  withdrawnPlayers: PlayerId[];
  finishedPlayers: PlayerId[];
  onRejoin: (id: PlayerId) => void;
}

export function GamePlayers({ membership }: { membership?: GamePlayersMembership }) {
  const players = useGamePlayers();
  const removePlayer = useRemovePlayer();
  const reorderPlayers = useReorderPlayers();
  const lockedIds = new Set(membership?.lockedPlayerIds);

  function handleReorder(items: SortableItem[]) {
    const playersById = new Map(players.map((player) => [player.id, player]));
    const reordered = items.map((item) => {
      const player = playersById.get(item.id);
      if (!player) throw new Error("Cannot position an unavailable Player.");
      return player;
    });
    reorderPlayers(reordered);
  }

  function handleShuffle() {
    if (players.length < 2) return;
    reorderPlayers(shuffle(players));
  }

  const items = players.map((p) => ({
    id: p.id,
    label: p.name,
    reorderable: !lockedIds.has(p.id),
  }));

  return (
    <section>
      {!membership && (
        <div className="flex items-center justify-end pb-2">
          <ShufflePlayersButton onClick={handleShuffle} disabled={players.length < 2} />
        </div>
      )}
      <List
        role="list"
        aria-label="Seating Order"
        rowVariant="compact-content"
        sortable
        items={items}
        onReorder={handleReorder}
      >
        {players.map((player) => {
          const withdrawn = membership?.withdrawnPlayers.includes(player.id);
          const finished = membership?.finishedPlayers.includes(player.id);
          const action = withdrawn ? "Rejoin" : lockedIds.has(player.id) ? "Withdraw" : "Remove";
          return (
            <li key={player.id} className="flex w-full min-w-0 items-center">
              <div
                className={[
                  "min-w-0 flex-1 wrap-anywhere",
                  withdrawn ? "grayscale text-text-secondary" : "",
                ].join(" ")}
              >
                <PlayerRow player={player} />
              </div>
              {finished ? (
                <span className="size-7 shrink-0" aria-hidden />
              ) : (
                <ListRowButton
                  aria-label={`${action} ${player.name}`}
                  onClick={() =>
                    membership && withdrawn
                      ? membership.onRejoin(player.id)
                      : removePlayer(player.id)
                  }
                >
                  {withdrawn ? (
                    <Plus className="size-5" aria-hidden />
                  ) : (
                    <Minus className="size-5" aria-hidden />
                  )}
                </ListRowButton>
              )}
            </li>
          );
        })}
        <AddPlayerButton key="add-player" />
      </List>
    </section>
  );
}
