# Reference workspaces

[Issue #65](https://github.com/amverni/phaze-compan10n/issues/65) migrates Phase 10 Standings, Generic Standings, and the in-Game Phases Card reference to the shared floating modal described in [Shared presentation contracts](shared-presentation.md#shared-modals). The [#66 cutover](https://github.com/amverni/phaze-compan10n/issues/66) makes that presentation universal; references no longer opt in.

Both Standings retain their `max-w-xl` (576px) cap and use the available height inside usable Safe Areas with 16px edge clearance. Their existing tab panels own list scrolling and horizontal swipes; graphs retain their series, accessible tables, and Player identities. The shared header X replaces Generic Standings' footer Close without adding a visible title. Phase resets to Standings when opened; Generic resets after leaving, preserving its existing interrupted-close behavior.

Standings retain fixed header controls while at least 200px of body space remains for tabs and a useful graph. Exceptionally cramped space uses whole-modal scrolling with a 288px workspace body rather than collapsing the chart. Normal body scrolling returns when space becomes available.

Phases Card retains its distinct `max-w-lg` (512px) cap and hugs short content. Share sits beside the single header X, outside the independently scrolling phase list. Whole-modal scrolling keeps these controls and long content reachable in exceptionally cramped space. Existing loading, retry, missing-data feedback, expanded Player groups, copied-link feedback, and close/reopen cleanup are unchanged.

App-level WebKit journeys cover both appearances, short portrait and landscape screens, desktop caps, long-list endings, glass effects and focus rings, keyboard and swipe tabs, focus restoration, and reopening. Visible-viewport simulation covers cramped-layout fallback and restoration; it is not evidence of native iPhone keyboard or Safari-toolbar behavior.
