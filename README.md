# Scorekeeper and Phase Compan10n

Two local-first scorekeeping experiences share saved Players and UI primitives,
without sharing scoring rules. Scorekeeper supports Points, Single Round Winner,
and Pass/Fail. Points optionally uses an independently directed numeric Tiebreaker.
Phase Compan10n retains Phase 10 scoring and automatic completion, and also supports
Early Finish.

## Development

```bash
npm ci
npm run dev
npm run lint
npm run build
```

React Compiler is enabled. Submitted forms use TanStack Form; the data flow is
Routes -> Components -> TanStack Query -> domain API -> IndexedDB. Query keys
separate the Scorekeepers, while Player mutations invalidate dependent views in
both. Totals, Standings, graphs, and result snapshots are derived in the API layer.

Phase 10 views share `gamesApi.getView()` through `gameViewOptions()`. A single
readonly transaction loads the Game, its live Players (or completed snapshots),
and Rounds. One interpretation supplies ordered scorecard columns, dealer
indicators, per-Round/running values, phase progress, Standings, graph series,
and graph endpoint order. Completion uses that same interpretation through the
existing Standings adapter. The raw Game/Round APIs remain available.

The read model keeps source Rounds and score entries separate from derived
values. Existing records contain aggregate scores, not Points Card Breakdowns;
the read model does not reconstruct unavailable card counters. This prefactor
does not change the schema, scoring rules, completion thresholds, or supported
correction and membership workflows.

## Navigation and presentation

The client-only SPA uses hash routes beneath the configured GitHub Pages base
(`/scorekeeper/`). Home at `/` always shows the two branded Scorekeeper choices in
a panel-free layout with Safe Area spacing, without a visible header, footer, or
back arrow. The generic Scorekeeper Dashboard lives at `/scorekeeper`, with
`/scorekeeper/create`, `/scorekeeper/players`, `/scorekeeper/games`, and
`/scorekeeper/game/$gameId` beneath it. Phase Compan10n pages remain under
`/phaseCompan10n`. Old top-level generic routes and `/scorekeepers` are removed
without redirects. Game detail and mutation APIs reject the wrong Scorekeeper's
records.

Both dashboards and Game pages put **Home** first in their contextual menus to
return to the shared chooser. Active and Completed Games keep Menu top-right
and Standings bottom-left, replacing the Game's old Back action. The existing
finish/pause control stays bottom-right and is available only for Active Games.
Phase 10 keeps its Phases Card top-left while active, with unchanged sharing;
Generic Games have no Phases Card. Menu destinations remain contextual to the
Scorekeeper, and navigation alone never finishes a Game.
Pause, setup Cancel, and back arrows within a Scorekeeper return to its dashboard.
Both Scorekeeper Dashboards show only Active Games; each Games page includes that
Scorekeeper's Active and retained Completed Games. Saved Player names, colors, and favorites
are shared. Generic pages have straight-edged surfaces; Phase pages retain their
logo, slants, and specialized controls.

The [shared presentation contracts](docs/shared-presentation.md) describe shell
and Player identity boundaries. [CONTEXT.md](CONTEXT.md) defines domain vocabulary.
Phases Card sharing remains self-contained at the
[nested hash routes](docs/adr/0001-self-contained-phases-card-share-urls.md).

## Tests

`npm test` runs Vitest behavior tests, including rendered safe-area layout tests
using Playwright WebKit. After installing npm dependencies, install that browser:

```bash
npx playwright install webkit
npm test
```

On Linux CI, use `npx playwright install --with-deps webkit` instead. The browser
tests start and close their own local Vite server; no running app is required.
Device insets are supplied through the shared `--safe-area-inset-*` CSS variables
because desktop WebKit automation does not expose hardware cutouts or Safari's
mobile toolbar. Real-device checks remain necessary for browser-chrome overlap.

## Scorekeeper persistence

All Scorekeepers share `phase10-db`. Schema version 8 deliberately resets disposable
pre-refactor data, including Players, Games/Rounds, custom Phases/Sets, favorites,
and settings. This runs only when upgrading from a version below 8; ordinary
reloads and future upgrades must preserve the new records.
Keep the reset boundary at `oldVersion < 8`: future schema changes must increment
the database version and add separate, nondestructive upgrade steps, with guarded
store/index creation. Never move the reset boundary to the latest version.

Game/Round records have explicit `scorekeeper` ownership. Shared lifecycle types
live in `src/types/gameLifecycle.ts`; Phase 10 fields remain in the Phase variants.
All generic Round submissions provide an explicit `mode` matching their Game;
there is no implicit Points-mode compatibility fallback.
Completed Games contain `playerSnapshots` (identity/name/color), `winnerIds`, and
`completionType`. Active views use live saved Players; completed views use snapshots.
Normal Phase 10 completion still awards exactly one winner under its existing rules.

Use `withGameTransaction`, `finalizeGame`, and `deleteGameRecords` in
`src/data/api/gameLifecycle.ts` for completion and Game-owned cleanup. Resolve
winners and capture identities inside that transaction, including the finishing
Round write, Early Finish, and per-Scorekeeper retention.
Whole-Game cleanup preserves shared Players, saved catalog data, and temporary
Phases still referenced by another Game or Phase Set.

Active Game writes must validate shared Player references inside the same
transaction as the write (`requirePlayers`/`saveActiveGame`). Player deletion
checks all Active Game references, regardless of Scorekeeper, in a transaction
that also locks Players. There is no archived/hidden Player state.
Normal Phase completion happens through `roundsApi.add`; manual completion uses
`gamesApi.finish` or `genericGamesApi.finish`. Manual completion awards all tied
first-place Players. Every completion requires at least one saved Round and
retains the latest 20 Completed Games for its own Scorekeeper, removing evicted
Games and their owned records atomically. Active Games never expire.

Add Round drafts live only while their scoreboard is mounted. Closing the dialog
retains a draft; saving clears it, and leaving (including Pause) discards it.
Completed scoreboards, Standings, graphs, and Games lists use snapshots even after
saved Players are edited or deleted.

Active Generic Points and Pass/Fail Games support editing a saved Round from its expanded
scorecard details. Edit opens the full prefilled entry form and selects the
chosen Player's control without changing its value. Pass/Fail retains the familiar
outcome controls and allows any number of passes, including none or all Players.
Closing an unsaved editor discards only that correction; the
separate Add Round draft is retained. Changed totals and graph points save
directly when places do not change. Changed places (including shared places)
require the compact **Edit round** confirmation; **Edit**, Escape, and outside
dismissal return to the unchanged draft, while **Save** commits it. Generic
completion remains an explicit Finish Game action.

The public `genericRoundsApi.getEditor`, `previewEdit`, and `edit` commands
validate Active Game ownership, matching Points/Pass-Fail mode, Player entries, and the loaded
history version. Preview never writes. Save revalidates the version and impact
inside the same transaction as the Round/activity writes, then invalidates
related Generic Game queries. New Generic Rounds carry stable IDs and revisions
without changing IndexedDB stores or indexes. Existing Rounds lacking this
metadata remain readable but cannot be edited; no backfill or reset is performed.
Completed Games, Single Round Winner editing, Round deletion,
cross-reload draft persistence, and production debug controls are not exposed.
