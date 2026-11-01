import type { ReactNode } from "react";
import { FavoritePlayers } from "./Players/FavoritePlayers";
import type { FirstDealerSelectProps } from "./Players/FirstDealerSelect";
import { GamePlayers, type GamePlayersMembership } from "./Players/GamePlayers";

export function Players({
  membership,
  firstDealer,
  isPending = false,
  error,
}: {
  membership?: GamePlayersMembership;
  firstDealer?: FirstDealerSelectProps;
  isPending?: boolean;
  error?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 py-4" inert={isPending}>
      <GamePlayers membership={membership} firstDealer={firstDealer} />
      {error}
      <FavoritePlayers />
    </div>
  );
}
