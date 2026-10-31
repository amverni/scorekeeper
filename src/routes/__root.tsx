import { type AnyRouteMatch, createRootRoute, HeadContent, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  // Root head receives descendant matches, despite its root-only inferred match type.
  head: ({
    matches,
  }: {
    matches: readonly Pick<AnyRouteMatch, "routeId" | "globalNotFound">[];
  }) => {
    const brand =
      !matches.some((match) => match.globalNotFound) &&
      matches.some((match) => match.routeId === "/phaseCompan10n")
        ? "phaseCompan10n"
        : "scorekeeper";
    return {
      meta: [{ title: "Scorekeeper" }],
      links: [
        {
          rel: "icon",
          type: "image/png",
          sizes: "32x32",
          href: `${import.meta.env.BASE_URL}favicons/${brand}.png`,
        },
        {
          rel: "icon",
          type: "image/svg+xml",
          sizes: "any",
          href: `${import.meta.env.BASE_URL}favicons/${brand}.svg`,
        },
      ],
    };
  },
  component: () => (
    <>
      <HeadContent />
      <Outlet />
    </>
  ),
});
