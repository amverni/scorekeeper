# Scorekeeper and Phase Compan10n

Two local-first scorekeeping experiences share saved Players and UI primitives,
without sharing scoring rules. Scorekeeper supports Points, Single Round Winner,
and Pass/Fail. Points optionally uses an independently directed numeric Tiebreaker.
Phase Compan10n supports Phase 10 scoring, Continuation for further Finishing
Places, automatic completion, and Manual Finish.

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
and graph endpoint order. Completion uses that same interpretation. The raw
Game/Round APIs remain available.

The read model keeps source Rounds and score entries separate from derived
values. New Passed/Failed Points entries retain the original `pointsCardBreakdown`
(`p5`, `p10`, `skipCard`, `wild`) from the Add Round controls, including all-zero
Round Winner entries. Both `roundsApi.getByGameId()` and `gamesApi.getView()`
return those exact counters after reload. Round Skip/Sit Out penalties and Count
Tiebreaker events have no remaining-card breakdown. Legacy entries without
counters remain readable, but their unavailable breakdowns are never reconstructed.
The optional record field requires no IndexedDB store/index migration or reset.

Card-bearing writes validate whole non-negative counters, Points Card Count,
and matching point totals using the same rules as Add Round. The existing
single-entry edit API also rejects inconsistent score/breakdown updates.
`counted` flags
distinguish retained source history from contributing Rounds and entries.
`playingPlayers`, Finishing Rounds/Places, and the Game Ending Round come from
the same interpretation rather than independent per-screen calculations.

## Phase 10 continuation

The first Finishing Round is committed before **Finish Game** asks
**{name} wins. Do others want to keep playing?** Only **Keep playing** or
**Finish** can dismiss this choice; neither rolls back the saved Round. An
unanswered choice is derived from saved history and restored on return.
`gamesApi.resolveFinishChoice()` validates the loaded choice token and writes
Continuation or finalizes the result in one transaction. Failed choices remain
retryable. New Round entry supplies its loaded Game/history version and expected
Round number to reject duplicate or stale submissions, including corrections
that leave the next Round number unchanged. A stale draft remains recoverable;
close and reopen Add Round to review it against the corrected history.

**Keep playing** persists for the rest of the Game, even if a Round Edit changes
the first-place Player. Finished Players keep their columns and distinct places
but leave score entry and dealer rotation. Their totals and counted wins stop at
their Finishing Round. Earlier finishes rank first; same-Round finishes compare
the configured Tiebreaker, most recent counted Round Winner through that Round,
then Seating Order.

When at least one Player has finished and all but one eligible Players have
finished, the Game automatically finalizes and opens Standings. This takes
precedence over the choice in a two-Player Game. Manual Finish remains available
during Continuation, retaining shared places among tied unfinished Players
without granting phase progress. Active Finished Player headers show their
Finishing Places; Completed Phase 10 headers show every Player's final place.
Generic scorekeeper totals are unchanged.

Round corrections recalculate this same completion policy atomically. Existing
entries after a corrected finish, and whole Rounds after an earlier Game ending,
remain visible but muted and do not contribute to results or graphs. Another
correction can restore their contribution while the Game remains Active.
Ordinary post-finish cells and genuine Participation Gaps remain blank.
Recalculation never deletes retained history; next-Round numbering follows the
last stored Round, not just counted Rounds. Pending saves block duplicate
actions; failures retain the draft, and successful saves alone clear it.

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
Round write, Manual Finish, and per-Scorekeeper retention.
Whole-Game cleanup preserves shared Players, saved catalog data, and temporary
Phases still referenced by another Game or Phase Set.

Active Game writes must validate shared Player references inside the same
transaction as the write (`requirePlayers`/`saveActiveGame`). Player deletion
checks all Active Game references, regardless of Scorekeeper, in a transaction
that also locks Players. There is no archived/hidden Player state.
Automatic Phase completion is checked after Round saves/corrections and the
Continuation choice; explicit completion uses `gamesApi.resolveFinishChoice`,
`gamesApi.finish`, or `genericGamesApi.finish`. Manual Finish awards all Players
sharing first place in Standings. Every completion requires at least one saved Round and
retains the latest 20 Completed Games for its own Scorekeeper, removing evicted
Games and their owned records atomically. Active Games never expire.

Add Round drafts live in memory for the current app session, keyed by Game and
Scorekeeper. Closing the dialog or navigating away (including Edit game and
Pause) retains entered values, selected Players and explicit winners. Saving
clears the saved draft; reloading starts a fresh draft. No draft is stored in
IndexedDB or browser storage. Ineligible Phase entries remain in the session
draft for later revalidation rather than being erased when the roster changes.
Completed scoreboards, Standings, graphs, and Games lists use snapshots even after
saved Players are edited or deleted.

### Game inspection

The bottom **Edit game** action in an Active Game's menu opens
`/phaseCompan10n/game/$gameId/edit` or `/scorekeeper/game/$gameId/edit` through
hash navigation. These full-page routes reuse creation's `GameSetupTabs` and
load saved configuration through `gamesApi.getEditor()` or
`genericGamesApi.getEditor()`, not app defaults. Settings and ordered Phase
references are static; current Phase Games use Sequential Phase Order.
Unlike long-lived local view caches, editor queries reread on every entry and
are released on unmount so reopening never reuses stale editor configuration.
Completed, missing, wrong-Scorekeeper and unavailable-reference Games cannot
be edited or implicitly reopened. Loading failures are explicit and retryable.

This slice only inspects configuration: Players and rules cannot yet be changed,
and the Save icon stays visible and disabled. `StagedGameEditor` separates the
Game-editor presentation from membership controls and accepts an explicit Save
state (`unsupported`, `unchanged`, `invalid`, `pending`, or `ready`). Later
membership features supply their staged form and a ready Save action only for
net supported valid changes; there is no placeholder mutation. X returns to the
same Game, while Back or navigation away discards the Game-editor draft without
prompting. That lifecycle is independent of the retained next-Round draft.

Active Generic Games support editing a saved Round from its expanded scorecard
details in all three Scoring Modes. Edit opens the full prefilled entry form and
selects the chosen Player's tab for Points, or focuses their existing outcome
control without changing the saved selection. Pass/Fail allows any number of
passes, including none or all Players. Closing an unsaved editor discards only that
correction; the separate Add Round draft is retained. Changed totals and graph
points save directly when places do not change.
Changed Round winners or places (including shared places) require the compact
**Edit round** confirmation; **Edit**, Escape, and outside dismissal return to the
unchanged draft, while **Save** commits it. Generic completion remains an explicit
Finish Game action.

Every saved Generic Round editor also offers **Delete Round**. The compact
**Delete round** confirmation identifies its Round number and permanence.
**Cancel** receives initial focus; Cancel, Escape, and outside dismissal preserve
the editor draft. Confirming **Delete** removes only that Round, consecutively
renumbers stored history, and recalculates totals, Standings, graphs, and dealers
without another impact confirmation. Deleting the sole Round retains the same
empty Active Game, roster, and settings; the next saved Round is Round 1.

The public `genericRoundsApi.getEditor`, `previewEdit`, `edit`, and `delete` commands
validate Active Game ownership, matching supported Scoring Mode, Player entries,
and the loaded history version. Preview never writes. Save revalidates the version
and impact inside the same transaction as the Round/activity writes, then
invalidates related Generic Game queries. Delete likewise checks the captured
history version and commits deletion, renumbering, and activity atomically.
Failed or stale mutations leave saved history unchanged and retain the draft.
New Generic Rounds carry stable IDs and
revisions without changing IndexedDB stores or indexes. Existing Rounds lacking
this metadata remain readable but cannot be edited or deleted; no backfill or reset is
performed.
Single Round Winner corrections require exactly one winner among the Game's
eligible Players; impact approval cannot override invalid entries.
Completed Game editing, cross-reload draft persistence, and production
debug controls are not exposed.
