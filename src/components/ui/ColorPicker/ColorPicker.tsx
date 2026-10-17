import { useId } from "react";
import { COLOR_GRID, getColorEntry } from "../../../data/constants/colors";
import { getContrastColor } from "../../../utils";

export interface ColorPickerProps {
  /** Color entry name (or legacy hex value). */
  value: string;
  onChange: (colorName: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const groupName = useId();
  const selectedEntry = getColorEntry(value);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-secondary">
        Avatar{selectedEntry ? ` · ${selectedEntry.name}` : ""}
      </span>
      <div className="glass relative rounded-xl p-2" role="radiogroup" aria-label="Avatar color">
        <div className="overflow-hidden rounded-lg">
          {Array.from({ length: Math.max(...COLOR_GRID.map((c) => c.length)) }, (_, row) => {
            const rowKey = COLOR_GRID.map((column) => column[row]?.hex ?? "empty").join(":");
            return (
              <div key={rowKey} className="flex">
                {COLOR_GRID.map((column) => {
                  const { hex, name, icon: Icon } = column[row];
                  const isSelected = selectedEntry?.name === name;
                  const contrastColor = getContrastColor(hex);
                  return (
                    <label key={hex} className="relative aspect-square flex-1 cursor-pointer">
                      <input
                        type="radio"
                        name={groupName}
                        value={name}
                        checked={isSelected}
                        onChange={() => onChange(name)}
                        aria-label={`Select color ${name}`}
                        className="absolute inset-0 h-full w-full cursor-pointer appearance-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
                        style={{ backgroundColor: hex }}
                      />
                      {isSelected && (
                        <Icon
                          className="pointer-events-none absolute inset-0 m-auto"
                          size={28}
                          strokeWidth={1.5}
                          color={contrastColor}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
