import { Radio, RadioGroup } from "@headlessui/react";
import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PlayerId, PlayerIdentity } from "../../types";
import { PlayerAvatar } from "../PlayerAvatar/PlayerAvatar";
import { Button, DialogScrollArea } from "../ui";

interface WinnerEntryProps {
  players: PlayerIdentity[];
  value: PlayerId | null;
  onChange: (value: PlayerId | null) => void;
  disabled: boolean;
  focusPlayerId?: PlayerId;
}

export function WinnerEntry({
  players,
  value,
  onChange,
  disabled,
  focusPlayerId,
}: WinnerEntryProps) {
  const focusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focusPlayerId) return;
    // Headless UI skips dialog autofocus on touch; cell edits still target their control.
    const frame = requestAnimationFrame(() => focusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusPlayerId]);

  return (
    <DialogScrollArea aria-label="Choose Round Winner" className="px-6! pt-4! pb-6!">
      <RadioGroup
        aria-label="Round Winner"
        value={value}
        onChange={onChange}
        disabled={disabled}
        className="flex flex-col gap-4"
      >
        {players.map((player) => (
          <Radio
            as={Button}
            type="button"
            key={player.id}
            value={player.id}
            ref={player.id === focusPlayerId ? focusRef : undefined}
            aria-label={player.name}
            className={[
              "min-h-12 w-full gap-3 rounded-full border-2 border-transparent px-4 py-3",
              "data-checked:border-text-secondary data-focus:outline-solid data-focus:outline-text-secondary!",
            ].join(" ")}
          >
            {({ checked }) => (
              <>
                <PlayerAvatar player={player} size={20} />
                <span
                  className="min-w-0 flex-1 truncate text-left font-semibold"
                  title={player.name}
                >
                  {player.name}
                </span>
                <Check
                  className={["size-5 shrink-0", checked ? "" : "invisible"].join(" ")}
                  aria-hidden
                />
              </>
            )}
          </Radio>
        ))}
      </RadioGroup>
    </DialogScrollArea>
  );
}
