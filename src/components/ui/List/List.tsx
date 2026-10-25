import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@headlessui/react";
import { ChevronsUpDown, Minus } from "lucide-react";
import {
  type AriaRole,
  Children,
  isValidElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./List.css";

const COMPACT_ROW_HEIGHT = "h-10";
const LIST_ANIMATION_MS = 220;
const LIST_MOVE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
const LIST_HEIGHT_EASING = "linear";
export type ListRowVariant = "compact" | "compact-content" | "content";

interface RowRect {
  top: number;
  height: number;
}

interface ListRow {
  key: string;
  child: ReactNode;
  sortableId?: string;
}

interface ExitingListRow extends ListRow {
  exitId: number;
  previousIndex: number;
  previousKeys: string[];
}

type RenderRow = (ListRow & { phase: "present" }) | (ExitingListRow & { phase: "exiting" });

interface PendingAnimations {
  id: number;
  entering: Set<string>;
  exiting: Set<string>;
  moving: Set<string>;
  previousRects: Map<string, RowRect>;
}

function ShimmerRow() {
  return (
    <div className={`${COMPACT_ROW_HEIGHT} flex items-center px-3`}>
      <div className="list-shimmer h-4 w-full rounded-md" />
    </div>
  );
}

function ShimmerRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        /* biome-ignore lint/suspicious/noArrayIndexKey: static shimmer placeholders never reorder */
        <ShimmerRow key={i} />
      ))}
    </>
  );
}

function RowDivider() {
  return <div className="list-divider mx-3 border-t border-white/10 dark:border-white/5" />;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      className="cursor-pointer rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/10"
      onClick={onClick}
      aria-label={label}
    >
      <Minus className="h-5 w-5 shrink-0 text-text-secondary" />
    </Button>
  );
}

function rowClassName(isFirst: boolean, isLast: boolean, rowVariant: ListRowVariant) {
  const radius =
    isFirst && isLast ? "rounded-2xl" : isFirst ? "rounded-t-2xl" : isLast ? "rounded-b-2xl" : "";
  const sizing =
    rowVariant === "content"
      ? "min-h-10 flex items-center px-4 py-4 text-sm"
      : rowVariant === "compact-content"
        ? "min-h-10 flex items-center px-3 py-2 text-sm"
        : `${COMPACT_ROW_HEIGHT} flex items-center px-3 text-sm`;
  return `${sizing} ${radius}`;
}

interface SortableRowProps {
  id: string;
  children: ReactNode;
  className: string;
  removable?: boolean;
  onRemove?: (id: string) => void;
  label: string;
  reorderable: boolean;
}

function SortableRow({
  id,
  children,
  className,
  removable,
  onRemove,
  label,
  reorderable,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: { draggable: !reorderable, droppable: false },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ("relative" as const) : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className={className}>
        <div className="flex min-w-0 flex-1 items-center">{children}</div>
        {removable && onRemove && (
          <RemoveButton label={`Remove ${label}`} onClick={() => onRemove(id)} />
        )}
        {reorderable ? (
          <Button
            type="button"
            ref={setActivatorNodeRef}
            data-swipe-navigation-ignore=""
            className="touch-none cursor-grab rounded-full p-1 text-text-secondary hover:bg-black/5 active:cursor-grabbing dark:hover:bg-white/10"
            aria-label={`Reorder ${label}`}
            {...attributes}
            {...listeners}
          >
            <ChevronsUpDown className="h-5 w-5 shrink-0" aria-hidden />
          </Button>
        ) : (
          <span className="size-7 shrink-0" aria-hidden />
        )}
      </div>
    </div>
  );
}

function PlainRow({ children, className }: { children: ReactNode; className: string }) {
  return <div className={className}>{children}</div>;
}

function getExplicitKeyedChildren(children: ReactNode) {
  const explicitKeys: Array<string | null> = [];

  Children.forEach(children, (child) => {
    if (child === null || child === undefined || typeof child === "boolean") return;
    explicitKeys.push(isValidElement(child) && child.key !== null ? String(child.key) : null);
  });

  return {
    childArray: Children.toArray(children),
    explicitKeys,
  };
}

function assertListChildrenHaveKeys(explicitKeys: Array<string | null>) {
  const missingIndex = explicitKeys.indexOf(null);
  if (missingIndex === -1) return;

  throw new Error(
    `List children must have stable React keys for animations. Missing key at child index ${missingIndex}.`,
  );
}

function getListRows({
  children,
  sortableIds,
  sortableCount,
  validateKeys,
}: {
  children: ReactNode;
  sortableIds: string[];
  sortableCount: number;
  validateKeys: boolean;
}) {
  const { childArray, explicitKeys } = getExplicitKeyedChildren(children);

  if (validateKeys) {
    assertListChildrenHaveKeys(explicitKeys);
  }

  if (sortableCount > childArray.length) {
    throw new Error("List received more sortable items than children.");
  }

  const rows = childArray.map<ListRow>((child, index) => {
    const sortableId = index < sortableCount ? sortableIds[index] : undefined;
    const explicitKey = explicitKeys[index] ?? String(index);

    return {
      key: sortableId ? `sortable:${sortableId}` : `static:${explicitKey}`,
      child,
      sortableId,
    };
  });

  return rows;
}

function keysEqual(prevKeys: string[], nextKeys: string[]) {
  return (
    prevKeys.length === nextKeys.length && prevKeys.every((key, index) => key === nextKeys[index])
  );
}

function classifyRowChanges({
  previousKeys,
  nextKeys,
  skipMoveAnimations,
}: {
  previousKeys: string[];
  nextKeys: string[];
  skipMoveAnimations: boolean;
}) {
  const previousKeySet = new Set(previousKeys);
  const nextKeySet = new Set(nextKeys);

  const entering = new Set(nextKeys.filter((key) => !previousKeySet.has(key)));
  const exiting = new Set(previousKeys.filter((key) => !nextKeySet.has(key)));
  const moving = new Set<string>();

  if (!skipMoveAnimations) {
    const previousPersistentKeys = previousKeys.filter((key) => nextKeySet.has(key));
    const nextPersistentKeys = nextKeys.filter((key) => previousKeySet.has(key));
    const previousPersistentIndex = new Map(
      previousPersistentKeys.map((key, index) => [key, index]),
    );

    nextPersistentKeys.forEach((key, index) => {
      if (previousPersistentIndex.get(key) !== index) {
        moving.add(key);
      }
    });
  }

  return { entering, exiting, moving };
}

function findExitInsertionIndex(exitingRow: ExitingListRow, output: RenderRow[]) {
  const outputIndexByKey = new Map(output.map((row, index) => [row.key, index]));
  const { previousIndex, previousKeys } = exitingRow;

  let previousNeighborIndex: number | undefined;
  for (let i = previousIndex - 1; i >= 0; i--) {
    const outputIndex = outputIndexByKey.get(previousKeys[i]);
    if (outputIndex !== undefined) {
      previousNeighborIndex = outputIndex;
      break;
    }
  }

  let nextNeighborIndex: number | undefined;
  for (let i = previousIndex + 1; i < previousKeys.length; i++) {
    const outputIndex = outputIndexByKey.get(previousKeys[i]);
    if (outputIndex !== undefined) {
      nextNeighborIndex = outputIndex;
      break;
    }
  }

  if (
    previousNeighborIndex !== undefined &&
    nextNeighborIndex !== undefined &&
    previousNeighborIndex < nextNeighborIndex
  ) {
    return previousNeighborIndex + 1;
  }

  if (nextNeighborIndex !== undefined) return nextNeighborIndex;
  if (previousNeighborIndex !== undefined) return previousNeighborIndex + 1;
  return Math.min(previousIndex, output.length);
}

function mergeRows(currentRows: ListRow[], exitingRows: ExitingListRow[]) {
  const currentKeys = new Set(currentRows.map((row) => row.key));
  const output: RenderRow[] = currentRows.map((row) => ({ ...row, phase: "present" }));

  const sortedExitingRows = [...exitingRows]
    .filter((row) => !currentKeys.has(row.key))
    .sort((a, b) => a.previousIndex - b.previousIndex);

  for (const exitingRow of sortedExitingRows) {
    const insertionIndex = findExitInsertionIndex(exitingRow, output);
    output.splice(insertionIndex, 0, { ...exitingRow, phase: "exiting" });
  }

  return output;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface SortableItem {
  id: string;
  label?: string;
  /** Locked rows remain insertion targets without exposing a drag handle. */
  reorderable?: boolean;
}

export interface ListProps {
  /** Every non-loading child must have a stable React key so row animations can track identity. */
  children?: ReactNode;
  /** Allow row content like dropdown panels to escape the rounded list container. */
  allowOverflow?: boolean;
  /**
   * Make the list scroll internally instead of overflowing its parent.
   * The list's `.glass` wrapper becomes the scroll container so its
   * drop shadow is preserved (it would otherwise be clipped by a
   * surrounding `overflow: auto` ancestor). Pair with sizing classes
   * via `className` (e.g. `min-h-0 flex-1`).
   */
  scrollable?: boolean;
  /** Extra classes appended to the list's outer `.glass` wrapper. */
  className?: string;
  /** Accessible name for focusable/scrollable list regions. */
  "aria-label"?: string;
  /** Optional semantic role for the list container. */
  role?: AriaRole;
  /** Optional keyboard focus support for the list container. */
  tabIndex?: number;
  isLoading?: boolean;
  shimmerRows?: number;
  /** Variable-height rows use `content`, or `compact-content` to retain compact spacing. */
  rowVariant?: ListRowVariant;
  emptyMessage?: ReactNode;
  sortable?: boolean;
  items?: SortableItem[];
  onReorder?: (items: SortableItem[]) => void;
  removable?: boolean;
  onRemove?: (id: string) => void;
}

export function List({
  children,
  allowOverflow = false,
  scrollable = false,
  className: classNameProp,
  "aria-label": ariaLabel,
  role,
  tabIndex,
  isLoading = false,
  shimmerRows = 0,
  rowVariant = "compact",
  emptyMessage,
  sortable = false,
  items,
  onReorder,
  removable = false,
  onRemove,
}: ListProps) {
  const sortableCount = sortable && items ? items.length : 0;
  const sortableIds = items?.map((item) => item.id) ?? [];
  const currentRows = getListRows({
    children,
    sortableIds,
    sortableCount,
    validateKeys: !isLoading,
  });
  const [exitingRows, setExitingRows] = useState<ExitingListRow[]>([]);
  const renderedRows = mergeRows(currentRows, exitingRows);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const previousRowsRef = useRef<ListRow[]>([]);
  const previousRectsRef = useRef(new Map<string, RowRect>());
  const pendingAnimationsRef = useRef<PendingAnimations | null>(null);
  const activeAnimationsRef = useRef<Animation[]>([]);
  const animatedKeysRef = useRef(new Set<string>());
  const exitingAnimationKeysRef = useRef(new Set<string>());
  const currentRowsRef = useRef(currentRows);
  const mountedRef = useRef(false);
  const animationRunRef = useRef(0);
  const exitIdRef = useRef(0);
  const skipNextMoveAnimationRef = useRef(false);
  const isDraggingRef = useRef(false);

  currentRowsRef.current = currentRows;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function setRowRef(key: string, node: HTMLDivElement | null) {
    if (node) {
      rowRefs.current.set(key, node);
    } else {
      rowRefs.current.delete(key);
    }
  }

  function measureRows(rows: ListRow[]) {
    const rects = new Map<string, RowRect>();

    for (const row of rows) {
      const element = rowRefs.current.get(row.key);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      rects.set(row.key, { top: rect.top, height: rect.height });
    }

    return rects;
  }

  function lockExitingRowsAtZero(keys: Iterable<string>) {
    for (const key of keys) {
      const element = rowRefs.current.get(key);
      if (!element) continue;
      element.style.height = "0px";
      element.style.overflow = "hidden";
      element.style.willChange = "";
    }
  }

  function cleanupAnimatedStyles(keys: Iterable<string>, lockedKeys = new Set<string>()) {
    for (const key of keys) {
      if (lockedKeys.has(key)) continue;
      const element = rowRefs.current.get(key);
      if (!element) continue;
      element.style.height = "";
      element.style.overflow = "";
      element.style.willChange = "";
    }
  }

  function cancelActiveAnimations() {
    const currentKeys = new Set(currentRowsRef.current.map((row) => row.key));
    // A row restored mid-exit must recover its natural height, not stay collapsed.
    const exitingKeys = new Set(
      [...exitingAnimationKeysRef.current].filter((key) => !currentKeys.has(key)),
    );
    lockExitingRowsAtZero(exitingKeys);
    for (const animation of activeAnimationsRef.current) {
      animation.cancel();
    }
    activeAnimationsRef.current = [];
    cleanupAnimatedStyles(animatedKeysRef.current, exitingKeys);
    animatedKeysRef.current.clear();
    exitingAnimationKeysRef.current = new Set();
  }

  function finishAnimationRun(pending: PendingAnimations) {
    if (animationRunRef.current !== pending.id) return;

    lockExitingRowsAtZero(pending.exiting);
    for (const animation of activeAnimationsRef.current) {
      animation.cancel();
    }
    cleanupAnimatedStyles(animatedKeysRef.current, pending.exiting);
    activeAnimationsRef.current = [];
    animatedKeysRef.current.clear();
    exitingAnimationKeysRef.current = new Set();

    if (pending.exiting.size > 0) {
      setExitingRows((rows) => rows.filter((row) => !pending.exiting.has(row.key)));
    }

    requestAnimationFrame(() => {
      previousRectsRef.current = measureRows(currentRowsRef.current);
    });
  }

  function startAnimations(pending: PendingAnimations) {
    pendingAnimationsRef.current = null;
    cancelActiveAnimations();

    if (prefersReducedMotion() || isDraggingRef.current) {
      if (pending.exiting.size > 0) {
        setExitingRows((rows) => rows.filter((row) => !pending.exiting.has(row.key)));
      }
      previousRectsRef.current = measureRows(currentRowsRef.current);
      return;
    }

    animationRunRef.current = pending.id;
    const animations: Animation[] = [];
    const animatedKeys = new Set<string>();

    for (const key of pending.entering) {
      const element = rowRefs.current.get(key);
      if (!element) continue;

      const height = element.getBoundingClientRect().height;
      if (height === 0) continue;

      element.style.overflow = "hidden";
      element.style.willChange = "height";
      animatedKeys.add(key);
      animations.push(
        element.animate([{ height: "0px" }, { height: `${height}px` }], {
          duration: LIST_ANIMATION_MS,
          easing: LIST_HEIGHT_EASING,
        }),
      );
    }

    for (const key of pending.exiting) {
      const element = rowRefs.current.get(key);
      if (!element) continue;

      const height =
        pending.previousRects.get(key)?.height ?? element.getBoundingClientRect().height;
      if (height === 0) continue;

      element.style.overflow = "hidden";
      element.style.willChange = "height";
      animatedKeys.add(key);
      animations.push(
        element.animate([{ height: `${height}px` }, { height: "0px" }], {
          duration: LIST_ANIMATION_MS,
          easing: LIST_HEIGHT_EASING,
          fill: "forwards",
        }),
      );
    }

    for (const key of pending.moving) {
      const element = rowRefs.current.get(key);
      const previousRect = pending.previousRects.get(key);
      if (!element || !previousRect) continue;

      const rect = element.getBoundingClientRect();
      const deltaY = previousRect.top - rect.top;
      if (Math.abs(deltaY) < 0.5) continue;

      element.style.willChange = "transform";
      animatedKeys.add(key);
      animations.push(
        element.animate(
          [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
          {
            duration: LIST_ANIMATION_MS,
            easing: LIST_MOVE_EASING,
          },
        ),
      );
    }

    if (animations.length === 0) {
      finishAnimationRun(pending);
      return;
    }

    activeAnimationsRef.current = animations;
    animatedKeysRef.current = animatedKeys;
    exitingAnimationKeysRef.current = pending.exiting;

    void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(
      () => finishAnimationRun(pending),
    );
  }

  function applyPendingAnimationsIfReady() {
    const pending = pendingAnimationsRef.current;
    if (!pending) return false;

    for (const key of pending.exiting) {
      if (!rowRefs.current.has(key)) return false;
    }

    startAnimations(pending);
    return true;
  }

  useLayoutEffect(() => {
    if (isLoading) {
      pendingAnimationsRef.current = null;
      cancelActiveAnimations();
      setExitingRows((rows) => (rows.length === 0 ? rows : []));
      previousRowsRef.current = [];
      previousRectsRef.current = new Map();
      mountedRef.current = false;
      return;
    }

    if (applyPendingAnimationsIfReady()) return;

    const previousRows = previousRowsRef.current;
    const previousKeys = previousRows.map((row) => row.key);
    const nextKeys = currentRows.map((row) => row.key);

    if (!mountedRef.current) {
      mountedRef.current = true;
      previousRowsRef.current = currentRows;
      previousRectsRef.current = measureRows(currentRows);
      return;
    }

    if (keysEqual(previousKeys, nextKeys)) {
      previousRowsRef.current = currentRows;
      return;
    }

    const skipMoveAnimations = skipNextMoveAnimationRef.current;
    skipNextMoveAnimationRef.current = false;

    const { entering, exiting, moving } = classifyRowChanges({
      previousKeys,
      nextKeys,
      skipMoveAnimations,
    });
    const nextKeySet = new Set(nextKeys);
    const exitingRowsToAdd = previousRows
      .map((row, previousIndex) => ({ row, previousIndex }))
      .filter(({ row }) => exiting.has(row.key))
      .map<ExitingListRow>(({ row, previousIndex }) => ({
        ...row,
        exitId: ++exitIdRef.current,
        previousIndex,
        previousKeys,
      }));

    pendingAnimationsRef.current = {
      id: animationRunRef.current + 1,
      entering,
      exiting,
      moving,
      previousRects: previousRectsRef.current,
    };
    previousRowsRef.current = currentRows;

    if (exitingRowsToAdd.length > 0) {
      setExitingRows((rows) => [
        ...rows.filter((row) => !nextKeySet.has(row.key) && !exiting.has(row.key)),
        ...exitingRowsToAdd,
      ]);
      return;
    }

    setExitingRows((rows) => rows.filter((row) => !nextKeySet.has(row.key)));
    applyPendingAnimationsIfReady();
  });

  useLayoutEffect(
    () => () => {
      animationRunRef.current += 1;
      pendingAnimationsRef.current = null;
      for (const animation of activeAnimationsRef.current) {
        animation.cancel();
      }
      activeAnimationsRef.current = [];
      for (const key of animatedKeysRef.current) {
        const element = rowRefs.current.get(key);
        if (!element) continue;
        element.style.overflow = "";
        element.style.willChange = "";
      }
      animatedKeysRef.current.clear();
    },
    [],
  );

  function handleDragStart() {
    isDraggingRef.current = true;
    pendingAnimationsRef.current = null;
    cancelActiveAnimations();
  }

  function handleDragEnd(event: DragEndEvent) {
    isDraggingRef.current = false;
    const { active, over } = event;
    if (!over || !items || !onReorder || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    if (items[oldIndex].reorderable === false) return;

    const reordered = [...items];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    skipNextMoveAnimationRef.current = true;
    onReorder(reordered);
  }

  function handleDragCancel() {
    isDraggingRef.current = false;
  }

  function itemLabel(id: UniqueIdentifier) {
    return items?.find((item) => item.id === id)?.label ?? "item";
  }

  function itemPosition(id: UniqueIdentifier) {
    return `position ${sortableIds.indexOf(String(id)) + 1} of ${sortableIds.length}`;
  }

  function renderRow(row: RenderRow, index: number, totalCount: number) {
    const isFirst = index === 0;
    const isLast = index === totalCount - 1;
    const className = rowClassName(isFirst, isLast, rowVariant);
    const reactKey = row.phase === "exiting" ? `exit:${row.key}:${row.exitId}` : row.key;

    return (
      <div
        key={reactKey}
        ref={(node) => setRowRef(row.key, node)}
        className="list-row-shell"
        data-list-row-key={row.key}
        data-list-row-phase={row.phase}
      >
        {index > 0 && <RowDivider />}
        {row.phase === "present" && row.sortableId ? (
          <SortableRow
            id={row.sortableId}
            className={className}
            removable={removable}
            onRemove={onRemove}
            label={items?.find((item) => item.id === row.sortableId)?.label ?? "item"}
            reorderable={items?.find((item) => item.id === row.sortableId)?.reorderable !== false}
          >
            {row.child}
          </SortableRow>
        ) : (
          <PlainRow className={className}>{row.child}</PlainRow>
        )}
      </div>
    );
  }

  const renderRows = () =>
    renderedRows.map((row, index) => renderRow(row, index, renderedRows.length));
  const hasRows = currentRows.length > 0 || exitingRows.length > 0;

  const containerProps = {
    "aria-label": ariaLabel,
    role,
    tabIndex,
  };

  if (!isLoading && !hasRows) {
    if (!emptyMessage) return null;
    const emptyClassName = [
      "flex items-center justify-center py-8 text-sm text-text-secondary",
      scrollable && "overflow-y-auto",
      classNameProp,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={emptyClassName} {...containerProps}>
        {emptyMessage}
      </div>
    );
  }

  const className = [
    "glass relative rounded-2xl",
    scrollable ? "overflow-y-auto" : allowOverflow ? "overflow-visible" : "overflow-hidden",
    classNameProp,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} {...containerProps}>
      {isLoading ? (
        <ShimmerRows count={shimmerRows} />
      ) : sortable && items ? (
        <DndContext
          accessibility={{
            announcements: {
              onDragStart: ({ active }) =>
                `Picked up ${itemLabel(active.id)}, ${itemPosition(active.id)}.`,
              onDragOver: ({ active, over }) =>
                over
                  ? `${itemLabel(active.id)} moved to ${itemPosition(over.id)}.`
                  : `${itemLabel(active.id)} is outside the list.`,
              onDragEnd: ({ active, over }) =>
                `Dropped ${itemLabel(active.id)} at ${itemPosition(over?.id ?? active.id)}.`,
              onDragCancel: ({ active }) =>
                `Cancelled moving ${itemLabel(active.id)}. Returned to ${itemPosition(active.id)}.`,
            },
          }}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {renderRows()}
          </SortableContext>
        </DndContext>
      ) : (
        renderRows()
      )}
    </div>
  );
}
