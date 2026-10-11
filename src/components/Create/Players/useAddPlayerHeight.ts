import { useLayoutEffect, useState } from "react";

function verticalPadding(element: HTMLElement) {
  const style = getComputedStyle(element);
  return Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
}

/** Measure unconstrained content, never the filled or clipped page containers. */
export function useAddPlayerHeight() {
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!workspace) return;
    const panel = workspace.closest<HTMLElement>(".dialog-panel");
    const header = panel?.querySelector<HTMLElement>(":scope > header");
    const actions = panel?.querySelector<HTMLElement>(":scope > footer");
    const results = workspace.querySelector<HTMLElement>(".player-search-content");
    const searchScroll = workspace.querySelector<HTMLElement>(".player-search-results");
    const searchBar = workspace.querySelector<HTMLElement>(".player-search-bar");
    const form = workspace.querySelector<HTMLElement>(".add-player-form-content");
    const formScroll = form?.parentElement;
    if (
      !panel ||
      !header ||
      !actions ||
      !results ||
      !searchScroll ||
      !searchBar ||
      !form ||
      !formScroll
    )
      return;

    const measure = () => {
      const searchHeight =
        searchBar.getBoundingClientRect().height +
        results.getBoundingClientRect().height +
        verticalPadding(searchScroll);
      const createHeight =
        form.getBoundingClientRect().height + verticalPadding(formScroll) + actions.offsetHeight;
      panel.style.setProperty(
        "--add-player-height",
        `${Math.ceil(header.offsetHeight + Math.max(searchHeight, createHeight))}px`,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [header, actions, searchBar, results, form, searchScroll, formScroll]) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [workspace]);

  return setWorkspace;
}
