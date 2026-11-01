import type { PlayerIdentity } from "../../../types";
import { PlayerAvatar } from "../../PlayerAvatar/PlayerAvatar";
import { DealerMarker } from "../../ui";

/** Displays a single player row. */
export function PlayerRow({
  player,
  firstDealer = false,
}: {
  player: PlayerIdentity;
  firstDealer?: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <PlayerAvatar player={player} />
      <span>{player.name}</span>
      {firstDealer && (
        <>
          <DealerMarker />
          <span className="sr-only">First Dealer</span>
        </>
      )}
    </span>
  );
}
