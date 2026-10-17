import { TabList as HeadlessTabList, type TabListProps } from "@headlessui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  createContext,
  type ElementType,
  isValidElement,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { interactiveClasses } from "../sharedClasses";
import "./TabList.css";

const baseClasses = "glass relative flex w-full max-w-lg items-center rounded-full p-1";

interface TabListNavContextValue {
  selectedIndex: number;
  tabCount: number;
  setSelectedIndex: ((next: number) => void) | null;
}

const TabListNavContext = createContext<TabListNavContextValue | null>(null);

interface TabListOwnProps {
  /**
   * Controlled setter from the parent's `<TabGroup>`. Required if
   * `<TabList.PrevButton>` / `<TabList.NextButton>` are used as children.
   */
  setSelectedIndex?: (next: number) => void;
}

/**
 * An opaque segmented tab bar that wraps Headless UI's `TabList`.
 *
 * Accepts the same props as `@headlessui/react`'s `TabList` and layers on
 * the app's shared surface styling. Place `<Tab>` children inside just like you
 * would with the Headless UI component.
 *
 * Automatically renders a sliding opaque indicator that tracks the selected
 * tab. The tab count is derived from `React.Children.count`.
 *
 * To pair with `<TabList.PrevButton>` / `<TabList.NextButton>`, wrap your
 * `<TabGroup>` in controlled mode and pass the same `setSelectedIndex` to
 * this `TabList`.
 *
 * Must be placed inside a `<TabGroup>`.
 */
export function TabList<TTag extends ElementType = "div">(
  props: TabListProps<TTag> & TabListOwnProps,
) {
  const { children, setSelectedIndex, ...rest } = props as TabListProps<"div"> &
    TabListOwnProps & {
      children?: ReactNode | ((bag: { selectedIndex: number }) => ReactNode);
      ref?: Ref<HTMLDivElement>;
    };
  const { ref: forwardedRef, ...tabListProps } = rest;
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const setListRef = useCallback(
    (node: HTMLDivElement | null) => {
      setListElement(node);
      assignRef(forwardedRef, node);
    },
    [forwardedRef],
  );

  const incomingClassName = (tabListProps as Record<string, unknown>).className;
  const merged =
    typeof incomingClassName === "function"
      ? (...args: unknown[]) =>
          [baseClasses, (incomingClassName as (...a: unknown[]) => string)(...args)]
            .filter(Boolean)
            .join(" ")
      : [baseClasses, incomingClassName].filter(Boolean).join(" ");

  return (
    <HeadlessTabList {...tabListProps} ref={setListRef} className={merged}>
      {({ selectedIndex }: { selectedIndex: number }) => {
        const resolved = typeof children === "function" ? children({ selectedIndex }) : children;
        return (
          <TabListContents
            listElement={listElement}
            selectedIndex={selectedIndex}
            setSelectedIndex={setSelectedIndex ?? null}
          >
            {resolved}
          </TabListContents>
        );
      }}
    </HeadlessTabList>
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  ref.current = value;
}

interface TabListContentsProps {
  children: ReactNode;
  listElement: HTMLDivElement | null;
  selectedIndex: number;
  setSelectedIndex: ((next: number) => void) | null;
}

interface IndicatorRect {
  width: number;
  x: number;
}

function TabListContents({
  children,
  listElement,
  selectedIndex,
  setSelectedIndex,
}: TabListContentsProps) {
  const tabCount = Children.toArray(children).filter(isValidElement).length;
  const [indicatorRect, setIndicatorRect] = useState<IndicatorRect | null>(null);

  useLayoutEffect(() => {
    if (tabCount === 0) {
      setIndicatorRect(null);
      return;
    }

    if (!listElement) return;

    let frame = 0;

    const measure = () => {
      const tabs = listElement.querySelectorAll<HTMLElement>('[role="tab"]');
      const selectedTab = tabs[selectedIndex];
      if (!selectedTab) {
        setIndicatorRect(null);
        return;
      }

      const nextRect = {
        width: selectedTab.offsetWidth,
        x: selectedTab.offsetLeft,
      };

      setIndicatorRect((previous) => {
        if (
          previous &&
          Math.abs(previous.width - nextRect.width) < 0.5 &&
          Math.abs(previous.x - nextRect.x) < 0.5
        ) {
          return previous;
        }
        return nextRect;
      });
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();

    const scrollContainer = listElement.parentElement;
    scrollContainer?.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(listElement);
      for (const tab of listElement.querySelectorAll<HTMLElement>('[role="tab"]')) {
        resizeObserver.observe(tab);
      }
    }

    return () => {
      cancelAnimationFrame(frame);
      scrollContainer?.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, [listElement, selectedIndex, tabCount]);

  return (
    <TabListNavContext.Provider
      value={{
        selectedIndex,
        tabCount,
        setSelectedIndex,
      }}
    >
      {tabCount > 0 && (
        <div
          className="glass glass-tab-indicator pointer-events-none absolute top-1 bottom-1 left-0 rounded-full transition-[transform,width,opacity] duration-300 ease-in-out"
          style={{
            opacity: indicatorRect ? 1 : 0,
            transform: `translateX(${indicatorRect?.x ?? 0}px)`,
            width: `${indicatorRect?.width ?? 0}px`,
          }}
          aria-hidden
        />
      )}
      {children}
    </TabListNavContext.Provider>
  );
}

const navButtonClasses = [
  "glass",
  "inline-flex items-center justify-center rounded-full relative",
  "size-9 shrink-0",
  interactiveClasses,
  "hover:brightness-110 active:scale-110",
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
].join(" ");

function useTabListNavContext(): TabListNavContextValue | null {
  return useContext(TabListNavContext);
}

function warnNoContext(componentName: string) {
  if (import.meta.env.DEV) {
    console.warn(
      `<TabList.${componentName}> rendered without context AND without controlled props. Pass selectedIndex/tabCount/setSelectedIndex props, or render inside <TabList>.`,
    );
  }
}

interface NavButtonProps {
  className?: string;
  "aria-label"?: string;
  /**
   * Controlled mode: pass when `<TabList.PrevButton>` / `<TabList.NextButton>`
   * is rendered outside `<TabList>` (e.g., overlaid on the panel area).
   * All three must be provided together.
   */
  selectedIndex?: number;
  tabCount?: number;
  setSelectedIndex?: (next: number) => void;
}

/**
 * Selects the previous tab when clicked. Disabled at the first tab.
 *
 * - Inside `<TabList>`: relies on context populated by a controlled `<TabGroup>`.
 * - Outside `<TabList>`: pass `selectedIndex` + `tabCount` + `setSelectedIndex`
 *   as props to control directly (useful when overlaying chevrons on panel area).
 */
function PrevButton({
  className,
  "aria-label": ariaLabel = "Previous tab",
  selectedIndex: selectedIndexProp,
  setSelectedIndex: setSelectedIndexProp,
}: Omit<NavButtonProps, "tabCount"> & { tabCount?: number }) {
  const ctx = useTabListNavContext();
  const selectedIndex = selectedIndexProp ?? ctx?.selectedIndex ?? 0;
  const setSelectedIndex = setSelectedIndexProp ?? ctx?.setSelectedIndex ?? null;
  if (!ctx && setSelectedIndexProp === undefined) warnNoContext("PrevButton");
  const disabled = !setSelectedIndex || selectedIndex <= 0;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => setSelectedIndex?.(selectedIndex - 1)}
      className={[navButtonClasses, className].filter(Boolean).join(" ")}
    >
      <ChevronLeft className="size-5" aria-hidden />
    </button>
  );
}

/**
 * Selects the next tab when clicked. Disabled at the last tab.
 *
 * - Inside `<TabList>`: relies on context populated by a controlled `<TabGroup>`.
 * - Outside `<TabList>`: pass `selectedIndex` + `tabCount` + `setSelectedIndex`
 *   as props to control directly.
 */
function NextButton({
  className,
  "aria-label": ariaLabel = "Next tab",
  selectedIndex: selectedIndexProp,
  tabCount: tabCountProp,
  setSelectedIndex: setSelectedIndexProp,
}: NavButtonProps) {
  const ctx = useTabListNavContext();
  const selectedIndex = selectedIndexProp ?? ctx?.selectedIndex ?? 0;
  const tabCount = tabCountProp ?? ctx?.tabCount ?? 0;
  const setSelectedIndex = setSelectedIndexProp ?? ctx?.setSelectedIndex ?? null;
  if (!ctx && setSelectedIndexProp === undefined) warnNoContext("NextButton");
  const disabled = !setSelectedIndex || selectedIndex >= tabCount - 1;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => setSelectedIndex?.(selectedIndex + 1)}
      className={[navButtonClasses, className].filter(Boolean).join(" ")}
    >
      <ChevronRight className="size-5" aria-hidden />
    </button>
  );
}

TabList.PrevButton = PrevButton;
TabList.NextButton = NextButton;
