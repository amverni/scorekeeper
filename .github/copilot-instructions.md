# Copilot Instructions

## Build & Quality

```bash
npm run build     # TypeScript check + Vite build
npm test          # Vitest behavior seams + Playwright WebKit layout coverage
npm run lint      # Biome check (lint + format issues)
npm run format    # Biome auto-fix formatting
```

Use targeted Vitest runs for changed pure behavior seams, then run `npm test`, `npm run lint`, and `npm run build` before finishing implementation work.

## Architecture

Client-only SPA deployed to GitHub Pages — no server, no SSR, no API routes. All data lives in IndexedDB.

### Data flow

```
Routes → Components → TanStack Query hooks → API layer → IndexedDB (idb)
```

- **`src/data/db/`** — Schema (`DBSchema` interface) and singleton `getDB()` connection
- **`src/data/api/`** — One file per domain (players, games, rounds, phases, phaseSets). All IndexedDB access goes through here — components never touch the DB directly
- **`src/data/hooks/`** — TanStack Query hooks with query key factories and `queryOptions()` for reuse
- **`src/data/constants/`** — Built-in phases and phase sets (merged with user-created data at the API layer)

### Routing

File-based routing via `@tanstack/router-plugin`. Route tree auto-generated at `src/routeTree.gen.ts` — never edit manually. Uses hash history (`/#/path`) for GitHub Pages compatibility. Keep route files thin; delegate to components.

### UI layer

- **`src/components/ui/`** — Shared primitives (Button, Dialog, List, etc.) wrapping Headless UI with opaque surfaces, borders, and shadows
- Feature components live in their own folders under `src/components/`
- Styling uses Tailwind CSS v4 via Vite plugin with custom theme tokens in `src/index.css` (`@theme` block)

## Key Conventions

### React & TanStack

- React Compiler is enabled — no manual `useMemo`/`useCallback`
- TanStack Query as local cache (not network) with local-first defaults (`staleTime: Infinity`, `retry: false`). Query key factories with hierarchical keys; mutations invalidate broadest relevant key
- TanStack Form for all forms — no raw `useState` for form fields. Cheap validation inline; async domain validation (e.g., uniqueness) via API on submit

### TypeScript & Data

- Discriminated unions for state variants (e.g., `Game = ActiveGame | CompletedGame` via `status` field)
- `0 | 1` instead of `boolean` for IndexedDB indexed fields
- Barrel exports via `index.ts` for `src/types/`, `src/components/ui/`, `src/utils/`

### Styling

- Build class strings as arrays with `.join(" ")`
- Use the existing `.glass` CSS class for elevated, opaque UI elements; its name is retained for existing consumers, not translucent glass
- Surface variants use `--surface-bg`, `--surface-border`, and `--surface-shadow`; no surface filtering or shine. Preserve modal backdrop blur as a separate focus effect
- Use theme tokens (`--color-pt-*`) from `src/index.css` instead of hardcoded values
