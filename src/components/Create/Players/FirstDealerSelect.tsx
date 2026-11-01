import type { FirstDealerSelection, PlayerId } from "../../../types";
import { PlayerAvatar } from "../../PlayerAvatar/PlayerAvatar";
import { DealerMarker, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "../../ui";
import { iconPhaseButtonClasses } from "../Phases/phaseButtonClasses";
import { useGamePlayers } from "../PlayerSelectionContext";

export interface FirstDealerSelectProps {
  value: FirstDealerSelection;
  onChange: (value: FirstDealerSelection) => void;
}

export function FirstDealerSelect({ value, onChange }: FirstDealerSelectProps) {
  const players = useGamePlayers();
  return (
    <Listbox<PlayerId | null>
      value={value.type === "player" ? value.playerId : null}
      onChange={(playerId) =>
        onChange(playerId === null ? { type: "random" } : { type: "player", playerId })
      }
    >
      <ListboxButton
        variant="icon"
        className={iconPhaseButtonClasses}
        aria-label="Choose First Dealer"
        title="Choose First Dealer"
      >
        <DealerMarker />
      </ListboxButton>
      <ListboxOptions
        align="right"
        anchor={{ to: "bottom end", gap: "0.25rem", padding: "1rem" }}
        transformOrigin="top-right"
        className="max-h-72 overflow-y-auto"
      >
        <ListboxOption value={null}>Random</ListboxOption>
        {players.map((player) => (
          <ListboxOption key={player.id} value={player.id}>
            <PlayerAvatar player={player} variant="icon" />
            {player.name}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}
