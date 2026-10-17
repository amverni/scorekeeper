import { RotateCcw } from "lucide-react";
import { type MouseEvent, type PointerEvent, useId, useRef } from "react";
import type { GameTiebreaker, PhaseStatus } from "../../types";
import { Button } from "../ui";
import { interactiveClasses } from "../ui/sharedClasses";
import { WheelSelector } from "../ui/WheelSelector/WheelSelector";
import {
  getAllowedPointScoresForResult,
  isPointsQuickIncrementNoop,
  isPointsQuickResetNoop,
  type PointsQuickButtonId,
  type QuickCounts,
} from "./addRoundDraft";
import "./TiebreakerEntrySection.css";

interface TiebreakerEntrySectionProps {
  tiebreaker: GameTiebreaker;
  value: number;
  onChange: (next: number) => void;
  onQuickIncrement: (button: PointsQuickButtonId) => void;
  onQuickDecrement: (button: PointsQuickButtonId) => void;
  onQuickReset: () => void;
  quickCounts: QuickCounts;
  /** Current round result. Null / Skipped / Sat Out disable the section. */
  result: PhaseStatus | null;
  isRoundWinner: boolean;
}

type QuickButtonAccent = "blue" | "green" | "yellow" | "red";

interface PointsQuickButton {
  id: PointsQuickButtonId;
  label: string;
  delta: number;
  accent: QuickButtonAccent;
}

const POINTS_QUICK_BUTTONS: PointsQuickButton[] = [
  { id: "p5", label: "+5", delta: 5, accent: "blue" },
  { id: "p10", label: "+10", delta: 10, accent: "green" },
  {
    id: "skipCard",
    label: "Skip",
    delta: 15,
    accent: "yellow",
  },
  { id: "wild", label: "Wild", delta: 25, accent: "red" },
];

const COUNT_QUICK_BUTTONS: number[] = [1, 2, 3, 4];
const HOLD_TO_REMOVE_MS = 500;

interface VariantConfig {
  kind: "points" | "count" | "hidden";
  label: string;
  min: number;
  max: number;
  step: number;
}

function resolveVariant(tiebreaker: GameTiebreaker): VariantConfig {
  switch (tiebreaker) {
    case "lowestPoints":
    case "highestPoints":
      return { kind: "points", label: "Points", min: 0, max: 250, step: 5 };
    case "fewestWilds":
      return { kind: "count", label: "Wilds used", min: 0, max: 25, step: 1 };
    case "fewestSkips":
      return {
        kind: "count",
        label: "Skip cards played",
        min: 0,
        max: 25,
        step: 1,
      };
    case "mostSkipped":
      return {
        kind: "count",
        label: "Times skipped",
        min: 0,
        max: 25,
        step: 1,
      };
    case "roundsWon":
      return { kind: "hidden", label: "", min: 0, max: 0, step: 1 };
  }
}

function clampToMax(value: number, max: number): number {
  return Math.min(max, value);
}

const quickButtonRowClasses = [
  "-mx-1 flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto px-1 py-1",
].join(" ");

const quickCardButtonBaseClasses = [
  "glass tiebreaker-quick-card relative inline-flex h-14 min-w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg px-2 text-sm font-bold leading-none",
  interactiveClasses,
  "transition-[filter,transform,opacity,background-color] duration-150 ease-out",
  "hover:brightness-110 active:scale-95",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

const quickCardAccentClasses: Record<QuickButtonAccent | "neutral", string> = {
  blue: "tiebreaker-quick-card--blue",
  green: "tiebreaker-quick-card--green",
  yellow: "tiebreaker-quick-card--yellow",
  red: "tiebreaker-quick-card--red",
  neutral: "",
};

function getQuickCardButtonClasses({
  accent,
  selected = false,
}: {
  accent: QuickButtonAccent | "neutral";
  selected?: boolean;
}): string {
  return [
    quickCardButtonBaseClasses,
    quickCardAccentClasses[accent],
    selected ? "tiebreaker-quick-card--selected ring-1 ring-pt-blue-500/50" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getCounterDescription(count: number): string {
  return `Used ${count} ${count === 1 ? "time" : "times"}`;
}

function QuickCardCaps() {
  return (
    <>
      <span aria-hidden className="tiebreaker-quick-card__cap tiebreaker-quick-card__cap--top" />
      <span aria-hidden className="tiebreaker-quick-card__cap tiebreaker-quick-card__cap--bottom" />
    </>
  );
}

interface PointsQuickCardButtonProps {
  button: PointsQuickButton;
  count: number;
  counterId: string;
  disabled: boolean;
  incrementNoop: boolean;
  onQuickIncrement: (button: PointsQuickButtonId) => void;
  onQuickDecrement: (button: PointsQuickButtonId) => void;
}

function PointsQuickCardButton({
  button,
  count,
  counterId,
  disabled,
  incrementNoop,
  onQuickIncrement,
  onQuickDecrement,
}: PointsQuickCardButtonProps) {
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTriggeredRef = useRef(false);
  const suppressClickRef = useRef(false);
  const canDecrement = !disabled && count > 0;
  const buttonDisabled = disabled || (incrementNoop && !canDecrement);

  const clearHoldTimer = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const startHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (buttonDisabled) return;
    holdTriggeredRef.current = false;
    if (!canDecrement) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    holdTimerRef.current = setTimeout(() => {
      holdTriggeredRef.current = true;
      suppressClickRef.current = true;
      onQuickDecrement(button.id);
    }, HOLD_TO_REMOVE_MS);
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (buttonDisabled) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const holdTriggered = holdTriggeredRef.current;
    clearHoldTimer();
    holdTriggeredRef.current = false;

    if (!holdTriggered && !incrementNoop) {
      suppressClickRef.current = true;
      onQuickIncrement(button.id);
    }
  };

  const cancelPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearHoldTimer();
    holdTriggeredRef.current = false;
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      return;
    }

    if (!buttonDisabled && !incrementNoop) {
      onQuickIncrement(button.id);
    }
  };

  return (
    <button
      type="button"
      disabled={buttonDisabled}
      onPointerDown={startHold}
      onPointerUp={finishPointer}
      onPointerCancel={cancelPointer}
      onClick={handleClick}
      className={getQuickCardButtonClasses({ accent: button.accent })}
      aria-label={[
        incrementNoop ? button.label : `Add ${button.delta} points (${button.label})`,
        canDecrement ? "hold to remove one" : "",
      ]
        .filter(Boolean)
        .join("; ")}
      aria-describedby={counterId}
    >
      <QuickCardCaps />
      <span className="relative z-10 text-text-primary">{button.label}</span>
    </button>
  );
}

export function TiebreakerEntrySection({
  tiebreaker,
  value,
  onChange,
  onQuickIncrement,
  onQuickDecrement,
  onQuickReset,
  quickCounts,
  result,
  isRoundWinner,
}: TiebreakerEntrySectionProps) {
  const variant = resolveVariant(tiebreaker);
  const counterIdBase = useId();
  if (variant.kind === "hidden") {
    return null;
  }

  const disabled =
    result === null ||
    result === "skipped" ||
    result === "satOut" ||
    (variant.kind === "points" && isRoundWinner);
  const pointValues =
    variant.kind === "points" ? getAllowedPointScoresForResult(result, isRoundWinner) : undefined;
  const resetDisabled =
    disabled ||
    isPointsQuickResetNoop({
      result,
      quickCounts,
      isRoundWinner,
    });

  const onQuickSet = (next: number) => {
    if (disabled) return;
    onChange(clampToMax(next, variant.max));
  };

  return (
    <div
      className={["flex w-full flex-col gap-2", disabled ? "opacity-50" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-disabled={disabled || undefined}
    >
      <div className="flex min-h-9 items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {variant.label}
        </p>
        {variant.kind === "points" && (
          <Button
            type="button"
            onClick={onQuickReset}
            disabled={resetDisabled}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-text-secondary hover:bg-black/5 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
            aria-label="Reset point cards"
            title="Reset point cards"
          >
            <RotateCcw className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      {variant.kind === "points" && (
        <>
          <div className="flex w-full items-start justify-between gap-2">
            <div className={quickButtonRowClasses}>
              {POINTS_QUICK_BUTTONS.map((btn) => {
                const count = quickCounts[btn.id];
                const counterId = `${counterIdBase}-${btn.id}`;
                const incrementNoop = isPointsQuickIncrementNoop({
                  result,
                  quickCounts,
                  button: btn.id,
                  isRoundWinner,
                });
                return (
                  <div key={btn.id} className="flex shrink-0 flex-col items-center gap-1">
                    <PointsQuickCardButton
                      button={btn}
                      count={count}
                      counterId={counterId}
                      disabled={disabled}
                      incrementNoop={incrementNoop}
                      onQuickIncrement={onQuickIncrement}
                      onQuickDecrement={onQuickDecrement}
                    />
                    <span
                      id={counterId}
                      className={[
                        "text-xs font-bold leading-none tabular-nums",
                        count > 0 ? "text-text-primary" : "text-text-secondary opacity-60",
                      ].join(" ")}
                    >
                      <span aria-hidden>{count}</span>
                      <span className="sr-only">{getCounterDescription(count)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 -mt-2">
              <WheelSelector
                value={value}
                onChange={onChange}
                min={variant.min}
                max={variant.max}
                step={variant.step}
                values={pointValues}
                label={variant.label}
                disabled={disabled}
              />
            </div>
          </div>
          <p
            className={
              "-mt-1 min-h-3 text-xs leading-none text-text-secondary transition-opacity duration-150"
            }
          >
            Hold to decrease.
          </p>
        </>
      )}

      {variant.kind === "count" && (
        <div className="flex w-full items-start justify-between gap-2">
          <div className={quickButtonRowClasses}>
            {COUNT_QUICK_BUTTONS.map((n) => {
              const selected = value === n;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={disabled}
                  onClick={() => onQuickSet(n)}
                  className={getQuickCardButtonClasses({
                    accent: selected ? "blue" : "neutral",
                    selected,
                  })}
                  aria-label={`Set to ${n}`}
                  aria-pressed={selected}
                >
                  <QuickCardCaps />
                  <span className="relative z-10 text-text-primary">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="shrink-0 -mt-2">
            <WheelSelector
              value={value}
              onChange={onChange}
              min={variant.min}
              max={variant.max}
              step={variant.step}
              label={variant.label}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
