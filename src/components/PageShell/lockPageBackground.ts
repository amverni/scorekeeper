let owners = 0;
let pendingRelease: number | undefined;
let restoreBackground: (() => void) | undefined;

function freezeBackground(root: HTMLElement) {
  const restore: (() => void)[] = [];
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  function setStyle(element: HTMLElement, property: string, value: string) {
    const previous = element.style.getPropertyValue(property);
    const priority = element.style.getPropertyPriority(property);
    element.style.setProperty(property, value);
    restore.push(() => {
      if (previous) element.style.setProperty(property, previous, priority);
      else element.style.removeProperty(property);
    });
  }

  const bounds = root.getBoundingClientRect();
  for (const shell of root.querySelectorAll<HTMLElement>(".page-shell")) {
    const style = getComputedStyle(shell);
    const shellBounds = shell.getBoundingClientRect();
    // Custom properties retain viewport units in computed style. Resolve them
    // through a noninteractive length probe before freezing their values.
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;width:0;padding:0;border:0";
    shell.append(probe);
    for (const property of [
      "--page-shell-panel-height",
      "--page-shell-control-size",
      "--page-shell-control-icon-size",
      "--safe-area-inset-top",
      "--safe-area-inset-right",
      "--safe-area-inset-bottom",
      "--safe-area-inset-left",
    ]) {
      probe.style.height = style.getPropertyValue(property);
      setStyle(shell, property, `${probe.getBoundingClientRect().height}px`);
    }
    probe.remove();
    setStyle(shell, "--page-shell-viewport-height", `${shellBounds.height}px`);
    setStyle(shell, "width", `${shellBounds.width}px`);
  }
  for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    const style = getComputedStyle(element);
    if (!/(auto|scroll|overlay)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
    const top = element.scrollTop;
    const left = element.scrollLeft;
    setStyle(element, "overflow", "hidden");
    setStyle(element, "overscroll-behavior", "none");
    restore.push(() => element.scrollTo({ top, left, behavior: "instant" }));
  }
  // Freeze the app subtree, not body/html or the portal. Headless UI continues
  // to own document locking, focus, and nested overlay permissions.
  for (const [property, value] of Object.entries({
    position: "fixed",
    top: `${bounds.top}px`,
    left: `${bounds.left}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    "max-width": "none",
    "min-height": "0",
  })) {
    setStyle(root, property, value);
  }

  return () => {
    for (const reset of restore) reset();
    // Restore only a changed position, after library unlock/focus restoration.
    // Do not fight browser-owned viewport movement while the modal is active.
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    }
  };
}

export function lockPageBackground() {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing app root for background locking");
  if (pendingRelease !== undefined) {
    cancelAnimationFrame(pendingRelease);
    pendingRelease = undefined;
  }
  restoreBackground ??= freezeBackground(root);
  owners++;
  return () => {
    owners--;
    if (owners !== 0) return;
    pendingRelease = requestAnimationFrame(() => {
      pendingRelease = undefined;
      restoreBackground?.();
      restoreBackground = undefined;
    });
  };
}
