import { Delete, Minus, Plus } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { editGenericPoints } from "../../utils/genericPoints";
import { Button, DialogScrollArea } from "../ui";
import "./PointsEntry.css";

interface NumericField {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

interface PointsEntryProps {
  name: string;
  points: NumericField;
  tiebreaker?: NumericField;
  disabled: boolean;
  submitError: string | null;
  focusMetric?: "Tiebreaker";
}

const keyClasses = ["points-key font-semibold", "data-focus:outline-text-secondary!"].join(" ");
const maxFullValueLength = String(Number.MIN_SAFE_INTEGER).length;

export function PointsEntry({
  name,
  points,
  tiebreaker,
  disabled,
  submitError,
  focusMetric,
}: PointsEntryProps) {
  const id = useId();
  const [selectedMetric, setSelectedMetric] = useState<"Points" | "Tiebreaker">(
    focusMetric ?? "Points",
  );
  const focusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focusMetric) return;
    const frame = requestAnimationFrame(() => focusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusMetric]);
  const metric = tiebreaker ? selectedMetric : "Points";
  const { value, onChange } = metric === "Tiebreaker" && tiebreaker ? tiebreaker : points;
  const fields = [
    { label: "Points" as const, ...points },
    ...(tiebreaker ? [{ label: "Tiebreaker" as const, ...tiebreaker }] : []),
  ];
  const edit = (key: string) => onChange(editGenericPoints(value, key));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    if (
      event.key === "Backspace" ||
      event.key === "Delete" ||
      (event.key.length === 1 && event.key !== " ")
    ) {
      event.preventDefault();
      edit(event.key);
    }
  };

  return (
    <div className="points-entry">
      <div className="points-entry-layout">
        <div className="points-summary">
          <div
            className={["points-fields grid", tiebreaker ? "grid-cols-2" : "grid-cols-1"].join(" ")}
          >
            {fields.map((field) => {
              const abbreviate = field.value.length > maxFullValueLength;
              const content = (
                <>
                  <span className="text-sm">{field.label}</span>
                  <output
                    id={`${id}-${field.label}-value`}
                    aria-label={`${name} ${field.label}`}
                    aria-invalid={!!field.error}
                    aria-describedby={field.error ? `${id}-${field.label}-error` : undefined}
                    aria-live="polite"
                    className="points-value max-w-full break-all font-semibold tabular-nums"
                  >
                    {abbreviate ? (
                      <>
                        <span aria-hidden title={field.value}>
                          {field.value.slice(0, 7)}...{field.value.slice(-7)}
                        </span>
                        <span className="sr-only">{field.value}</span>
                      </>
                    ) : (
                      field.value
                    )}
                  </output>
                </>
              );
              const boxClasses = "points-field w-full min-w-0 flex-col rounded-2xl!";
              return (
                <div key={field.label} className="min-w-0">
                  {tiebreaker ? (
                    <Button
                      type="button"
                      ref={field.label === focusMetric ? focusRef : undefined}
                      data-autofocus={field.label === focusMetric ? true : undefined}
                      aria-label={`${name} ${field.label}`}
                      aria-pressed={metric === field.label}
                      aria-invalid={!!field.error}
                      aria-describedby={`${id}-${field.label}-value ${id}-help${field.error ? ` ${id}-${field.label}-error` : ""}`}
                      disabled={disabled}
                      onFocus={() => setSelectedMetric(field.label)}
                      onClick={(event) => {
                        setSelectedMetric(field.label);
                        event.currentTarget.focus();
                      }}
                      onKeyDown={onKeyDown}
                      className={[
                        boxClasses,
                        "data-focus:outline-text-secondary!",
                        metric === field.label ? "border-text-secondary!" : "",
                      ].join(" ")}
                    >
                      {content}
                    </Button>
                  ) : (
                    <div className={["glass flex items-center", boxClasses].join(" ")}>
                      {content}
                    </div>
                  )}
                  {field.error && (
                    <p
                      id={`${id}-${field.label}-error`}
                      role="alert"
                      className="points-error text-center text-pt-red-500"
                    >
                      {field.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {submitError && (
            <div className="points-save-error">
              <DialogScrollArea aria-label="Round save error" className="pt-0!">
                <p role="alert" className="points-error text-center text-pt-red-500">
                  {submitError}
                </p>
              </DialogScrollArea>
            </div>
          )}
        </div>
        <p id={`${id}-help`} className="sr-only">
          Enter {metric} using the keypad or keyboard. Minus changes the sign. Backspace removes a
          digit. Delete resets to zero.
          {tiebreaker && " Select a field to change the keypad target."}
        </p>
        <div className="points-keypad-space">
          <fieldset
            aria-describedby={`${id}-${metric}-value ${id}-help`}
            className="points-keypad grid grid-cols-3"
          >
            <legend className="sr-only">
              {name} {metric} keypad
            </legend>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
              <Button
                key={digit}
                type="button"
                disabled={disabled}
                onKeyDown={onKeyDown}
                onClick={() => edit(digit)}
                className={keyClasses}
              >
                {digit}
              </Button>
            ))}
            <Button
              type="button"
              aria-label="Change sign"
              disabled={disabled || value === "0"}
              onKeyDown={onKeyDown}
              onClick={() => edit("-")}
              className={keyClasses}
            >
              <span className="flex flex-col items-center" aria-hidden>
                <Plus className="size-[0.65em]" />
                <Minus className="h-[0.35em] w-[0.65em]" />
              </span>
            </Button>
            <Button
              type="button"
              disabled={disabled}
              onKeyDown={onKeyDown}
              onClick={() => edit("0")}
              className={keyClasses}
            >
              0
            </Button>
            <Button
              type="button"
              aria-label="Backspace"
              disabled={disabled || value === "0"}
              onKeyDown={onKeyDown}
              onClick={() => edit("Backspace")}
              className={keyClasses}
            >
              <Delete className="size-[1em]" aria-hidden />
            </Button>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
