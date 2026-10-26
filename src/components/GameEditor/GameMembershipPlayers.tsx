import { Minus, Plus } from "lucide-react";
import type { PlayerId } from "../../types";
import {
  useGamePlayers,
  useRemovePlayer,
  useReorderPlayers,
} from "../Create/PlayerSelectionContext";
import { PlayerRow } from "../Create/Players/PlayerRow";
import { Button, List, type SortableItem } from "../ui";

export function GameMembershipPlayers({
  lockedPlayerIds,
  withdrawnPlayers,
  finishedPlayers,
  onRejoin,
}: {
  lockedPlayerIds: PlayerId[];
  withdrawnPlayers: PlayerId[];
  finishedPlayers: PlayerId[];
  onRejoin: (id: PlayerId) => void;
}) {
  const players = useGamePlayers();
  const removePlayer = useRemovePlayer();
  const reorderPlayers = useReorderPlayers();
  const lockedIds = new Set(lockedPlayerIds);

  function handleReorder(items: SortableItem[]) {
    const playersById = new Map(players.map((player) => [player.id, player]));
    reorderPlayers(
      items.map(({ id }) => {
        const player = playersById.get(id);
        if (!player) throw new Error("Cannot position an unavailable Player.");
        return player;
      }),
    );
  }

  return (
    <List
      role="list"
      aria-label="Seating Order"
      rowVariant="compact-content"
      sortable
      items={players.map(({ id, name }) => ({
        id,
        label: name,
        reorderable: !lockedIds.has(id),
      }))}
      onReorder={handleReorder}
    >
      {players.map((player) => (
        <li key={player.id} className="flex w-full min-w-0 items-center">
          <div
            className={[
              "min-w-0 flex-1 wrap-anywhere",
              withdrawnPlayers.includes(player.id) ? "grayscale text-text-secondary" : "",
            ].join(" ")}
          >
            <PlayerRow player={player} />
          </div>
          {finishedPlayers.includes(player.id) ? (
            <span className="size-11 shrink-0" aria-hidden />
          ) : (
            <Button
              type="button"
              aria-label={`${withdrawnPlayers.includes(player.id) ? "Rejoin" : lockedIds.has(player.id) ? "Withdraw" : "Remove"} ${player.name}`}
              className="size-11 shrink-0"
              onClick={() =>
                withdrawnPlayers.includes(player.id) ? onRejoin(player.id) : removePlayer(player.id)
              }
            >
              {withdrawnPlayers.includes(player.id) ? (
                <Plus className="size-5" aria-hidden />
              ) : (
                <Minus className="size-5" aria-hidden />
              )}
            </Button>
          )}
        </li>
      ))}
    </List>
  );
}
