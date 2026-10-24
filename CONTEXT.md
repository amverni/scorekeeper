# Scorekeeper

This glossary defines the shared language for Scorekeeper and Phase Compan10n, including Players, Games, scoring, and results. It distinguishes Generic Scorekeeping from Phase 10 gameplay.

## Shared language

**Scorekeeper**:
A dedicated scorekeeping experience with its own Games and presentation, such as the generic Scorekeeper app or Phase Compan10n. Saved Players are shared across Scorekeepers.

**Home**:
The shared entry page where a person chooses a Scorekeeper.

**Scorekeeper Dashboard**:
A Scorekeeper's overview of its Active Games and starting point for creating a Game. Each Scorekeeper has its own dashboard, distinct from the shared Home.

### Games and results

**Game**:
A full play session using one Scorekeeper's scoring rules. Phase 10 Games and Generic Games have different progress and completion rules, defined in their respective sections below.
_Avoid_: Match

**Round**:
One scoring cycle within a Game. The Game's rules determine which scores or outcomes are recorded.
_Avoid_: Hand, turn cycle

**Round Edit**:
A correction to the recorded scores or outcomes of an existing Round in an Active Game, rather than the recording of a new Round. Any saved Round may be edited.

**Round Deletion**:
The removal of a saved Round from an Active Game. Any saved Round may be deleted in either Scorekeeper.

**Active Game**:
A Game whose competitive result is not finalized, accepting new Rounds or Round Edits as its rules allow.
_Avoid_: Open game, live game

**Completed Game**:
A game whose competitive result has been finalized and closed after at least one saved Round. Its result preserves each Player's name and color at completion, independently of later changes to saved Players.
_Avoid_: Archived game, old game

**Reopen for Correction**:
The explicit return of a Completed Game to Active Game status, withdrawing its finalized result while preserving its Round history. Reopening uses the saved Players' current names and colors and requires all referenced saved Players to still exist.

**Pause**:
Leaving an Active Game to return to its Scorekeeper Dashboard without finalizing its result. The Game remains active and can be continued later; pausing is not a separate Game status.

**Game Winner**:
A Player awarded the win when a Game is completed. The Game's rules determine whether one Player wins or tied Players share the win.
_Avoid_: Champion

**Standings**:
The ordered comparison of Players within a Game according to its scoring rules. Standings are distinct from the order of Player columns on the scoreboard.
_Avoid_: Leaderboard, rankings

**Tiebreaker**:
A rule used to compare Players who are tied on the primary scoring measure. Phase 10 Tiebreakers and the optional Generic Tiebreaker are defined separately below.

**Score Entry Complete**:
A Player's round entry contains the information required by the Game's scoring rules to save the round.
_Avoid_: Completed, done

### Players and selection

**Player**:
A person participating in a game. A saved Player's identity, name, color, and Favorite status are shared between Phase 10 scorekeeping and Generic Scorekeeping.
_Avoid_: User, participant

**Join**:
A Player's first addition to a Game, taking effect from the next unsaved Round with zero totals and no recorded phase progress. Earlier Rounds are not backfilled.

**Withdrawal**:
The suspension of a Player's competitive eligibility, with no participation or dealer turns from the next unsaved Round. Their saved Player profile and earlier Game history remain intact, but they are not ranked or eligible to win while withdrawn.

**Rejoin**:
A withdrawn Player's return to the same Game from the next unsaved Round, resuming their existing totals and phase progress. Their absence contributes no score, penalty, or phase advancement.

**Seating Order**:
The Game's Player order used for scoreboard columns, dealer rotation, and, where the Game's rules require one, the final exact-tie fallback. It is distinct from Standings.
_Avoid_: Game Creation Order, setup order

**Dealer**:
The Player assigned to deal for a specific Round, rotating through Seating Order among Players eligible to play that Round. Tracking a Dealer is optional in a Generic Game.
_Avoid_: Host, starter

**Favorite**:
A pinned item prioritized for quick selection: a shared Player, or a Phase or Phase Set within Phase Compan10n.
_Avoid_: Bookmark

## Scorekeeper app: generic scoring

### Games and rounds

**Generic Scorekeeping**:
Recording round-by-round points, points with a tiebreaker, single round winners, or individual pass/fail results without tracking Phase 10 phases or phase outcomes. Numeric scores are whole numbers, including zero and negatives.

**Generic Game**:
A play session for one or more Players in Generic Scorekeeping that remains active until the person keeping score explicitly finishes it. Its scoring rules are fixed at creation, while Players can Join, Withdraw, and Rejoin.

**Game Name**:
An optional label given to a Generic Game to help identify it.

**Generic Round**:
A scoring cycle in a Generic Game, recorded according to its Scoring Mode. Untouched Points and enabled Generic Tiebreaker entries count as zero.

### Scoring rules

**Scoring Mode**:
The choice made during Generic Game setup to record Points, Single Round Winner, or Pass/Fail results. A Generic Tiebreaker is an optional setting separate from Scoring Mode and is currently available only with Points.

**Points**:
A generic Scoring Mode that records a whole-number score for each Player in each round and compares accumulated totals using the selected Score Direction.

**Generic Tiebreaker**:
An optional secondary numeric measure totaled separately across rounds and compared only when primary totals are tied. It is currently available only with Points and has its own independent Score Direction.

**Single Round Winner**:
A generic Scoring Mode in which exactly one Player wins each round and all other Players lose. Players rank by most rounds won, with no separate Tiebreaker.

**Pass/Fail**:
A generic Scoring Mode in which selected Players pass and unselected Players fail each round; any number may pass, including none. Players rank by most passes, with no separate Tiebreaker.

**Score Direction**:
The per-game choice of whether higher or lower accumulated totals rank ahead in Generic Scorekeeping. Points and Tiebreaker each have their own independent Score Direction.

### Results

**Generic Game Winner**:
A Player awarded the win when a Generic Game is explicitly finished. Players who remain tied under the Game's scoring rules share the win.

**Generic Standings**:
The comparison of eligible Players in a Generic Game using its selected scoring rules. Players equal under those rules share a place, with subsequent places skipping by the number of tied Players (for example, 1, 1, 3). Players sharing a place are displayed in Seating Order; that order does not break the tie or affect Game Winners.

**Points Graph**:
A round-by-round view of each Player's accumulated points in a Generic Game.

## Phase Compan10n: Phase 10 scoring

### Games and phase progress

**Phase 10 Game**:
A Game played through an ordered Phase Set until normal completion or a Manual Finish.

**Continuation**:
Playing additional Phase 10 Rounds after the first Finished Player to determine further Finishing Places. The choice to continue applies to the rest of that Game.

**Active Player**:
A non-withdrawn Player included in an Active Phase 10 Game's competitive roster and Standings. A Finished Player remains in that roster but no longer participates in subsequent Rounds.
_Avoid_: Current player, enabled player

**Phase**:
A required card objective that must be satisfied to progress through the game.
_Avoid_: Level, challenge

**Phase Number**:
A Phase's numbered position within a Game's Phase Set. Repeated objectives at different positions are separate Phases for progress and selection.

**Phase Order**:
The Game's choice, fixed at creation, between resolving Phases sequentially and allowing a separate Phase selection for each Round.

**Sequential Phase Order**:
Resolving the Phases in Phase Set order.

**Selectable Phase Order**:
Choosing a Remaining Phase for each Player's Round rather than following Phase Set order. A Failed attempt leaves that Phase available for another attempt.

**Selected Phase**:
The Phase Number recorded for a Player in a particular Round, derived in Sequential Phase Order and chosen in Selectable Phase Order.

**Resolved Phase**:
A numbered Phase that a Player has Passed or taken a Round Skip for in counted history. A Phase cannot be resolved a second time.

**Remaining Phase**:
A Phase not yet resolved by a Player at the point in the Game being considered. In Selectable Phase Order, the lowest Remaining Phase is the default selection.

**Current Phase**:
In Sequential Phase Order, the Phase Number a Player is attempting in their next Round, based on saved Round outcomes. Unfinished score entry does not change a Player's Current Phase.
_Avoid_: Stage, tier

**Phase Set**:
The ordered list of phases used by a game, distinct from the card sets required by individual phases.
_Avoid_: Preset, playlist, Set (ambiguous with a card set)

**Phase 10 Round**:
A Round in which the Players still playing record scores and phase outcomes.

**Finished Player**:
A Player who has resolved every Phase in a Phase 10 Game's Phase Set. Their totals stop at their Finishing Round, and they no longer play or deal subsequent Rounds.
_Avoid_: Completed player, done player

**Finishing Round**:
The Round in which a Player resolves their last Remaining Phase, as determined by counted Round outcomes.

**Finishing Place**:
A Finished Player's distinct place, ordered by earliest Finishing Round, then the configured Tiebreaker and most recent Round Winner through that Round, then Seating Order.

**Game Ending Round**:
The last Round included in a finalized Phase 10 Game's result, distinct from any individual Player's Finishing Round.

**Excluded Round**:
A saved Phase 10 Round after the Game Ending Round, retained as history but not contributing to the finalized result.

**Participation Gap**:
A Round with no recorded entry for a Player who did not play, distinct from Sit Out. It contributes no score, penalty, or phase advancement.

**Excluded Entry**:
A recorded entry outside a Player's counted Phase 10 history, such as after their corrected Finishing Round or the Game Ending Round. It contributes no score, tiebreaker value, or phase advancement while excluded, but can become applicable again after another Round Edit.

### Results and tiebreakers

**Round Winner**:
The Player who completed their Phase in a Phase 10 Round and went out first; a recorded win contributes only while that Player's entry counts. A Round may have an unrecorded Round Winner; when every Player playing that Round takes a Round Skip or Sits Out, there is no Round Winner.
Recording a Round Winner is required only for the Rounds Won Tiebreaker, except when every Player playing that Round explicitly takes a Round Skip or Sits Out, or a correction excludes a retained historical winner. Other Tiebreakers allow a Round without a recorded winner; scores and Passed results never imply one, and corrections do not invent replacement winners.
_Avoid_: Round leader

**Phase 10 Game Winner**:
On normal Phase 10 completion, the Player in first Finishing Place. On a Manual Finish, all Players sharing first place in the current Standings share the win.

**Manual Finish**:
The explicit ending of a Phase 10 Game before its automatic completion threshold, using the current Standings as the final result without granting unplayed phase progress. Some Players may already be Finished Players.
_Avoid_: Early Finish

**Phase 10 Standings**:
Finished Players are ordered by Finishing Place ahead of unfinished Players, who compare phase progress, then the selected Tiebreaker, with equal place when those values are tied and subsequent places skipping by the number of tied Players. Progress means highest Current Phase in Sequential Phase Order and number of Resolved Phases in Selectable Phase Order.
In an Active Game, Standings compare Active Players; in a Completed Game, Standings compare the Players eligible when its result was finalized; unfinished Players within an equal place are ordered by most recent Round Winner, then Seating Order.

**Phase 10 Score Entry Complete**:
A player's round score entry has enough Round Result and Tiebreaker information to be counted as entered for that round. For Points Tiebreakers, this includes a valid Points Card Count for the player's Round Result.

**Points Card Count**:
The total number of remaining cards represented by the point-entry counters for a Points Tiebreaker.
_Avoid_: Score, points total

**Points Card Breakdown**:
The recorded counts of remaining cards in the 5-point, 10-point, Skip Card, and Wild categories for a Points Tiebreaker. These counts distinguish card combinations that produce the same point total.

**Points Tiebreaker**:
A tiebreaker that compares players by a recorded point total, where the selected rule determines whether higher or lower points win.
_Avoid_: Score tiebreaker

**Count Tiebreaker**:
A tiebreaker that compares players by a counted gameplay event, such as wild cards or skip cards.
_Avoid_: Non-points tiebreaker

**Fewest Wilds**:
A tiebreaker that compares players by the number of wild cards used, where fewer is better.
_Avoid_: Low points (for this rule)

**Rounds Won**:
A Phase 10 Tiebreaker that compares Players by their number of recorded Round wins, where more is better.

### Round status vocabulary

**Completed**:
The player met the phase objective for that round. Displayed in the score-entry UI as the past-tense label **Passed** for grammatical consistency with the other Round Result options (Failed, Skipped, Sat Out).
_Avoid_: Cleared. ("Passed" is the permitted UI label for this Phase 10 outcome.)

**Failed**:
The player did not meet the phase objective for that round.
_Avoid_: Lost phase

**Round Skip**:
The Player skips the full Round, resolves its Selected Phase, and may take a Round Skip Penalty.
_Avoid_: Skip (ambiguous)

**Sit Out**:
The Player skips the full Round without resolving its Selected Phase, which remains available afterward.
_Avoid_: Skip (ambiguous)

**Turn Skip**:
The player misses a turn within a round without skipping the entire round.
_Avoid_: Skip (ambiguous)

**Skip Card**:
A card that causes another player to take a Turn Skip. The compact label **Skip** is permitted where the surrounding score-entry controls make the card meaning unambiguous.
_Avoid_: Round Skip, Sit Out

**Round Skip Penalty**:
Points added to a Player's Round Score when they take a Round Skip.
_Avoid_: Auto-fail points

**Sit Out Penalty**:
Points added to a Player's Round Score when they Sit Out a round.
_Avoid_: Sit-out cost

### Phase catalog

**Phases Card**:
A shareable reference card for a Phase Set that lists its phases in order.
_Aliases_: Phase Card
_Avoid_: Phase Set Card, phasecard

**Saved Phase**:
A reusable phase definition kept for future games.
_Avoid_: Permanent phase

**Temporary Phase**:
A phase definition scoped to one game session.
_Avoid_: Draft phase

**Saved Phase Set**:
A reusable phase-set definition kept for future games.
_Avoid_: Permanent phase set

**Temporary Phase Set**:
A phase-set definition scoped to one game session.
_Avoid_: Draft phase set

## Shared interface layout

**Safe Area**:
A viewport region reserved for device or browser controls. Interactive content remains outside it, while noninteractive visual surfaces may continue through it.
_Avoid_: Safe space

**Visual Bleed**:
The noninteractive continuation of a decorative background, surface, shadow, or similar visual through a Safe Area without moving interactive content into that area.
_Avoid_: Overflow (when referring to this deliberate layout behavior)

**Input Reveal**:
The minimal repositioning of a Scorekeeper's view needed to make the focused input visible when the software keyboard opens or focus moves to another input. It permits the page and modal to move together, without keyboard-driven modal shrinking.

**Keyboard Freeze**:
The shared keyboard-open state after Input Reveal, with content scrolling paused inside and outside modals, no independent background movement, and modal swipe-to-dismiss paused. Further Input Reveal and explicit modal dismissal remain permitted; closing the software keyboard ends the freeze.

### Logo presentation

**Logo Palette**:
The ordered colors of a Scorekeeper logo's decorative stripes, from top to bottom. A Logo Palette can have different light and dark appearances.

**Base Logo Palette**:
A Scorekeeper's ordinary Logo Palette, used whenever no Logo Theme applies.

**Logo Theme**:
A scheduled use of a Logo Palette for the Scorekeeper app alone or for all Scorekeepers. It changes stripe colors and count, not the lettering, stripe direction, or the rest of the interface.
_Avoid_: App theme (when referring only to logo stripes)

## Flagged ambiguities

- **"Scorekeeper" names both a product and a category.**
  **Resolution:** Use **Scorekeeper app** for the generic product when needed; **Scorekeepers** collectively includes it and Phase Compan10n.

- **"Game", "Round", "Standings", and "Game Winner" do not imply Phase 10 rules.**
  **Resolution:** Use their shared definitions unless a specific Scorekeeper is established. Use the qualified Generic or Phase 10 terms when comparing behavior across Scorekeepers.

- **"Points" can be a primary score or a tiebreaker value.**
  **Resolution:** Generic **Points** is a primary Scoring Mode; a Phase 10 **Points Tiebreaker** resolves tied phase progress. Do not apply Phase 10 card-counting rules to generic numeric entries.

- **"Pass/Fail" does not mean phase completion.**
  **Resolution:** Generic **Pass/Fail** records independent outcomes without Phases. **Completed** and **Failed** in the Phase 10 section describe phase outcomes only.

- **"Skip" is overloaded within Phase 10.**
  **Resolution:** Use **Skip Card** for the card that causes a Turn Skip, **Turn Skip** for the missed turn, **Round Skip** for full-round skips that advance phase, and **Sit Out** for full-round skips that do not advance phase. The compact label **Skip** is acceptable only when surrounding card-entry controls make **Skip Card** unambiguous.

- **"Complete" is overloaded.**
  **Resolution:** **Completed Game** describes a finalized Game. Within Phase 10 round outcomes, **Completed** means the phase objective was met; **Score Entry Complete** describes whether a round entry is ready to save.

## Example dialogue

**Developer:** "Does every Game have a Phase Set?"
**Domain expert:** "No. Only a Phase 10 Game has a Phase Set; a Generic Game uses its Scoring Mode."
**Developer:** "Can nobody pass a Generic Round in Pass/Fail?"
**Domain expert:** "Yes. All Players fail that round, without any phase outcome."
**Developer:** "Does the Generic Tiebreaker add to Points?"
**Domain expert:** "No. Compare accumulated Points first, then the separately accumulated Tiebreaker only if Points are tied."
**Developer:** "If Maya takes a Round Skip this round, does she move to the next phase?"  
**Domain expert:** "Yes, a Round Skip advances phase, and she may take a Round Skip Penalty."  
**Developer:** "If she instead chooses Sit Out?"  
**Domain expert:** "Then she retries the same Current Phase next round."  
**Developer:** "And if two players finish the final phase together?"  
**Domain expert:** "Use the configured Tiebreaker; for Fewest Wilds, compare wild-card counts."  
**Developer:** "In a Points Tiebreaker, does the quick button labeled Skip mean a Round Skip?"  
**Domain expert:** "No, that compact label means Skip Card in that score-entry context."
