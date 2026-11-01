import type { ReactNode } from "react";
import { FavoritePlayers } from "./Players/FavoritePlayers";
import { GamePlayers, type GamePlayersMembership } from "./Players/GamePlayers";

export function Players({
  membership,
  isPending = false,
  error,
}: {
  membership?: GamePlayersMembership;
  isPending?: boolean;
  error?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 py-4" inert={isPending}>
      <GamePlayers membership={membership} />
      {error}
      <FavoritePlayers />
    </div>
  );
}
