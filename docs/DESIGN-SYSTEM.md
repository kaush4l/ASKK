# DESIGN-SYSTEM.md — HARNESS, as it ships

> **This file is derived, not declared.** Every number in it was counted off
> `web/*.css` at the commit that introduced it, and every count is a command you
> can re-run. Where the shipped CSS contradicts `DESIGN.md`, this file records
> the CONTRADICTION and names which side is true — it never quietly picks one.
> `DESIGN.md` is the argument; `tokens.css` is the values; this is the audit.
>
> Written by TEAM SURFACE, round R20-TOUCH. Baselines marked **(before)** are
> from the tree at `e27a387`; everything else is current.

## Contents

1. What the page is made of
2. The type scale, and the one register that carries it
3. The spacing scale
4. Colour and skin
5. Touch and pointer — the posture
6. Tokens with no reader
7. Motion — the vocabulary, and what each duration MEANS
8. Breakpoints
9. What the gate can and cannot execute here

---

## 1. What the page is made of

Ten stylesheets, 1,785 lines, no framework, no CDN, no third-party script, no
font file. The file set is closed: `scripts/check-selectors.py:28-30` fails on
an eleventh. Every file is ≤ 200 lines (I12).

    wc -l web/*.css
    python3 scripts/check-selectors.py

The one structural law worth knowing before editing: **G1 — a (selector,
property) pair has ONE home.** `glass.css` may give `header` its fill while
`chrome.css` gives it its position; neither may set the other's property. This
is why a rule is moved rather than duplicated, and why the touch posture below
is a `@media` wrap in place rather than an override block at the foot of a file.

## 2. The type scale, and the one register that carries it

Six sizes, ceiling enforced at `check-selectors.py:40`. Three families, three
weights, six leadings. **Measured usage, which is the part `DESIGN.md` does not
state:**

| token | value | `font-size:` uses |
|---|---|---|
| `--t-display` | `clamp(1.5rem, 1.15rem + 1.4vw, 2rem)` | 1 |
| `--t-subhead` | `1.25rem` | 1 |
| `--t-heading` | `1.125rem` | 6 |
| `--t-body` | `1rem` | 3 |
| `--t-label` | `0.875rem` | **27** |
| `--t-caption` | `0.6875rem` | 11 |

    grep -oh 'font-size: var(--t-[a-z]*)' web/*.css | sort | uniq -c | sort -rn

**The contradiction.** `DESIGN.md §5` raised the ceiling from five sizes to six
against the complaint that "the page was 42 rendered nodes at 14px". The sixth
size was added and the distribution did not move: **27 of 49 `font-size`
declarations are still `--t-label` (14px)** and `--t-subhead` — the size the
ceiling was raised FOR — has exactly one user. The ramp is legal and the page
is still a 14px page. This is a finding, not a fix; changing it is a design
increment with a screenshot, not a token edit.

Families: `--mono` 12 uses, `--font` 4, `--display` 3 (wordmark, masthead,
lede). Weights: `--w-strong` 27, `--w-medium` 8, `--w-normal` 5.

## 3. The spacing scale

Base 4px, eight steps, and **no raw literal is expressible** — `check-selectors.py:120`
fails the build on one. Measured usage:

| step | value | uses |
|---|---|---|
| `--s-1` | 4px | 17 |
| `--s-2` | 8px | 56 |
| `--s-3` | 12px | 53 |
| `--s-4` | 16px | 14 |
| `--s-5` | 24px | 2 |
| `--s-6` | 32px | 6 |
| `--s-7` | 48px | **0** |
| `--s-8` | 64px | 5 |

Radius: `--r-sm` 18, `--r-md` 5, `--r-full` 4, `--r-lg` 2.

## 4. Colour and skin

One accent (`--accent: #c9a4ff`), three inks, one machine ink, three semantic
colours, three opaque surfaces, three glass elevations. **The skin is a token
swap and never a rule** — `check-selectors.py:93-101` fails a `[data-skin]`
selector that declares anything but a custom property. Four triggers re-point
the same tokens: `[data-skin="plain"]` (the default), `[data-glass="off"]`,
`@supports not (backdrop-filter)`, and `prefers-reduced-transparency`.

## 5. Touch and pointer — the posture

**This section is the thing that did not exist.** (before) `grep -c 'pointer: coarse\|hover: none' web/*.css`
was **0 across all ten sheets** while eleven rules painted hover states.

The posture, in three sentences:

1. **A hover painting requires a pointer that can hover.** Every `:hover` rule
   in `web/` is inside `@media (hover: hover) and (pointer: fine)`. On a coarse
   pointer a tap LATCHES `:hover` on the element it touched until you tap
   somewhere else, so an ungated hover rule paints "the pointer is here" to a
   person whose finger has gone.

   **This team did NOT reproduce the latch in isolation, and says so rather
   than borrowing the authority of a measurement it does not have.** The one
   attempt — tap the `critic` agent tab on a `(hover: none)` device, read its
   fill — returned the hover mix, and the follow-up read showed
   `el.matches(':active') === true`: the automation had left the button DOWN,
   so `:hover` and `:active` cannot be separated in that evidence. The latch is
   documented browser behaviour, not a HARNESS measurement. **What IS measured
   is the posture itself**, and that is the table below.
2. **The press affordance is `:active`, and every hover has one.** Nine `:active`
   rules already shipped — so the brief's "real pressed states are missing" was
   the one part of the starting point that was largely already done. The guard
   now proves the pairing instead of assuming it, with one stated exception.
3. **The user agent's own touch affordances are off, because this design paints
   its own.** `-webkit-tap-highlight-color: transparent` and `user-select: none`
   on `button` and `summary`. **This one WAS measured end to end**: before, a
   press on the `critic` agent tab left `getSelection()` returning `"critic"` —
   the control's own label selected instead of the control pressed, with the
   selection highlight visible in the screenshot; after, `getSelection()` is
   `""` and `user-select` computes to `none` on the shipped page.

Measured in the shipped page, under coarse-pointer emulation and again on a
fine pointer:

| | hover rules | gated | reachable on this device |
|---|---|---|---|
| 375×812, `(hover: none)` | 11 | 11 | **0** |
| 1280×800, `(pointer: fine)` | 11 | 11 | **11** |

The one deliberate exception is `web/workspace.css`'s
`.file-list .file-entry.current, .file-list .file-entry.current:hover` — a
`:hover` written beside its own hover-less twin, so it paints the resting fill
and changes nothing under a finger. `crates/ui/src/posture.rs` knows that shape
by name and lets exactly it through.

**The 44px floor, verified rather than asserted.** `web/controls.css:15` has
carried the comment "the target a thumb can hit (WCAG 2.2), a floor" since
increment 12 and nothing gated it: `scripts/layout-audit.js:189-199` reports
targets as `info(...)`, at a 24px threshold, and `info` is not counted as a
failure. Walked by hand in the real page at 375×812: 30 interactive elements,
**one under 44px** — the `.skip-link` at 134×42, which is off-screen until
focused by a keyboard, i.e. reachable only by the input class that does not
have a thumb. Every nav row measured exactly 44.0. The floor holds; the *gate*
for it does not exist and §9 records that.

## 6. Tokens with no reader

91 tokens shipped; **9 had zero readers in `web/`, `scripts/` and `crates/`.**

    for t in $(grep -oh -- '--[a-z0-9-]*:' web/tokens.css | tr -d ':' | sort -u); do \
      echo "$(grep -o "var($t)" web/*.css | wc -l) $t"; done | sort -n

Three were deleted (`--nav-w`, `--nav-icon-w`, `--tr-label`): zero readers,
zero mentions in any document, nothing to contradict. Two were given their first
reader (§7). **Four remain, and each is named rather than silently kept:**

| token | why it stays |
|---|---|
| `--ease-in` | "exits only", and this product has no exit — see §7 |
| `--e3-dim` | `DESIGN.md` names it 7 times; deleting it without editing that file swaps one contradiction for another |
| `--s-7` | declared as part of the eight-step scale `DESIGN.md:599` prints whole |
| `--gap` | **the comment beside it was FALSE.** It claimed the alias was kept "because check-layout.sh and three scripts name it"; `grep -ro -- '--gap' scripts crates web` finds it nowhere but its own declaration. `DESIGN.md:603` repeats the same false sentence. The comment in `tokens.css` is now true; `DESIGN.md:603` is still false and is another team's file. **Open: delete the alias and both sentences in one edit.** |

## 7. Motion — the vocabulary, and what each duration MEANS

(before) **six** `transition:` declarations across four files — not four; the
brief that opened this round said four, and `docs/ROADMAP.md:92` says four in
its prose while its own evidence line at `:94` says "4 files, 6 declarations".
Six is right. And **two** `@keyframes`, not the three `:94` records: the third
was the word `@keyframes` inside a comment at `web/strip.css:106`, which
`grep -c` cannot tell from a rule.

    grep -c '^@keyframes' web/*.css
    grep -oh 'transition:' web/*.css | wc -l

Seven of the nine declared motion tokens had zero readers. That is the measured
version of "cinematic is decoration": the vocabulary existed and the page spoke
two words of it.

The vocabulary, derived from what the shipped rules actually do:

| token | value | means | readers |
|---|---|---|---|
| `--dur-fast` | 120ms | a state on the element the pointer or keyboard is ON: hover, press, focus, disclosure | 9 |
| `--dur` | 220ms | a state on a surface nobody is touching: the header's scroll shadow, a panel's border answering its contents, the scrim | 3 |
| `--dur-slow` | 380ms | something ARRIVING | **1** (was 0) |
| `--ease` | `cubic-bezier(.32,.72,0,1)` | the settle — the default, and every transition in the tree | 11 |
| `--ease-out` | `cubic-bezier(.16,1,.30,1)` | entrances | **2** (was 0) |
| `--ease-in` | `cubic-bezier(.55,0,1,.45)` | exits only | **0, by ruling** |

**The one arrival.** Below 1100px the nav is a sheet that comes up from the
bottom over a scrim (`web/layout.css:129-142`), and until R20-TOUCH it appeared
in a single frame. It is now `nav-rise` at `--dur-slow` `--ease-out`, with the
scrim at `--dur`. It is the only moment in this product that IS an arrival,
which is the whole reason it is the only thing given one. Verified in the page:
`animationName: nav-rise`, `0.38s`, `cubic-bezier(0.16, 1, 0.3, 1)`.

**Why there is no exit, stated rather than left to look like an oversight.**
The sheet leaves by `[hidden]` (`crates/ui/src/main.rs:151-155`) and the scrim
by unmounting. Neither can be followed by a transition or an animation, so
`--ease-in` has no honest reader and gets none. The mechanism that would give it
one is `transition-behavior: allow-discrete` with `@starting-style`; that is an
increment, not a token edit, and it is not this one.

**Both are behind `(prefers-reduced-motion: no-preference)`**, not behind
`base.css`'s duration cut — see §9 for why that distinction cost a red gate.

**Keyframe budget: 2 → 4.** `askk-shimmer` (the wait), `swipe-cue` (the status
strip's scroll cue), `nav-rise`, `scrim-in`. `DESIGN.md §7` still says
"`askk-shimmer` is the only `@keyframes` in `web/`" — **false since
`swipe-cue` landed, and doubly false now.** Another team's file; recorded here.

**`prefers-reduced-motion` was ALREADY honoured** — the brief asked me to check
first, and the answer is that `web/base.css:162-169` cuts every animation and
transition to 0.01ms and `scripts/layout-audit.js:34-36` asserts every
`animation-name` resolves to `none` under `check-layout.sh --reduced-motion`.
Nothing was added. `web/strip.css:121` additionally gates `swipe-cue` behind
`(prefers-reduced-motion: no-preference)`.

## 8. Breakpoints

Seven width thresholds in two unit systems, plus one height threshold and one
container query:

    grep -oh '@media[^{]*' web/*.css | sort | uniq -c | sort -rn

`22rem`, `30rem`, `48rem`, `64rem`, `75rem`, `1099px`/`1100px`, plus
`(max-height: 30rem)` and `@container stage (min-width: 66rem)`. The px pair is
the nav's three-column threshold and is px on purpose (`tokens.css:159` measures
contrast against it in px); the rest are rem. This is a finding: **a scale with
seven steps in two units is not a scale a person can hold**, and consolidating
it is a layout increment with screenshots, not a search-and-replace.

## 9. What the gate can and cannot execute here

**First, the finding that makes this section matter.** `publish.sh` runs
`grep -c 'check-layout\|check-selectors\|check-size\|check-browser'` = **0**.
The six-step gate (`docs/STATUS.md`) is `cargo test`, two `cargo check`s,
`check-size.py`, `check-browser.sh` and `publish.sh --dry-run` — **not one of
them reads `web/`.** `scripts/check-selectors.py` and `scripts/check-layout.sh`
are real guards that must be run by hand, and `check-layout.sh --reduced-motion`
is a hand-run of a hand-run. Everything this document says about the stylesheets
is therefore outside the gate EXCEPT what `crates/ui/src/posture.rs` asserts,
which is why that file exists and why its scope is the whole of `web/`.

`posture.rs` makes five claims of this document RED-able under gate step 1
(`cargo test --workspace`), each with the one-line revert that proves it (T59),
each revert actually run:

| test | revert that turns it RED | run? |
|---|---|---|
| `no_hover_paints_where_a_finger_cannot_hover` | un-gate `.nav .view-item:hover` in `chrome.css` | RED ✓ |
| `everything_that_lifts_under_a_pointer_also_presses_under_a_finger` | delete `button:not(:disabled):active` | RED ✓ |
| `a_control_is_pressed_not_selected` | drop `user-select: none` from `button` | RED ✓ |
| `every_declared_duration_and_easing_has_a_reader` | delete the `nav-rise` rule | RED ✓ |
| `the_one_arrival_does_not_arrive_for_someone_who_asked_for_stillness` | drop `and (prefers-reduced-motion: no-preference)` | RED ✓ |

**Two defects this round produced and caught, recorded because both are the
project's own named failure classes.**

1. *The arrival broke reduced motion, and the browser guard found it.* Written
   as a bare `@media (max-width: 1099px)`, `scrim-in` still resolved to a live
   `animation-name` under `prefers-reduced-motion: reduce` — `base.css:162-169`
   cuts DURATION and leaves the NAME standing, and `layout-audit.js:34-36`
   asserts the name is `none`. `scripts/check-layout.sh --reduced-motion` went
   `LAYOUT CHECK FAILED: 30` — five widths x two skins x three routes, every run
   below the breakpoint. `strip.css:121` already had the right shape and the
   first draft did not copy it. Fixed by adding
   `and (prefers-reduced-motion: no-preference)`; now 54/54 PASS, exit 0.
2. *The test for it was VACUOUS, and its positive control found that.* The first
   `the_one_arrival…` looked for `animation:` in a block's SELECTOR, because
   `blocks()` returned preludes and discarded declarations. It passed over an
   empty loop, and passed the revert too. This is exactly T59 — a test that
   stays green under the broken version measures nothing — caught only because
   the control was run rather than asserted. `blocks()` now returns
   declarations, and the test counts its subject (`assert_eq!(seen, 2)`) so it
   cannot go quiet again.

**The honest limits, named rather than left to look covered (I17).**

- **These are assertions about the TEXT of `web/*.css`, not about a rendering.**
  They fail on the edit that would break the browser, which is a smaller claim
  than "the browser is not broken". The rendering half was settled by hand in
  the shipped page (§5's table) and is not, today, in any gate.
- **The 44px floor has no gate.** `scripts/layout-audit.js:189-199` reports it as
  `info` at 24px. Making it a `say(...)` at 44px, with WCAG 2.5.8's inline-link
  exemption, is a four-line change in a file TEAM SURFACE does not own.
- **`crates/ui/src/posture.rs` sits at exactly 200 lines**, the I12 ceiling. It
  is legal and it has no headroom: the sixth test splits it into `posture/mod.rs`
  plus `posture/css.rs` (the reader), and that is the shape to reach for rather
  than shortening a rationale to make room.
- **Gating the hover rules BLINDED part of `scripts/check-layout.sh`, and this
  is the cost of this increment, stated up front.** `scripts/layout-audit.js:149-164`
  copies every `:hover`/`:active` rule out of `document.styleSheets[i].cssRules`
  so it can force the state a headless browser never enters — and it walks only
  the TOP level, where a `CSSMediaRule` has no `selectorText`. A gated hover rule
  is invisible to it. **Measured, by diffing the report before and after:** 810
  `:hover` assertion lines before and 810 after, 0 FAIL both times — and 594 of
  them now read `rgba(0, 0, 0, 0)`, the RESTING paint, where before they read
  `color(srgb 0.956863 0.941176 0.980392 / 0.04)` and `rgb(21, 14, 31)`, the
  hover paint. The assertions did not disappear; they lost their subject.

      bash scripts/check-layout.sh > after.txt
      grep ':hover\[' after.txt | sed 's/.* on //' | sort | uniq -c **The fix is to recurse into `CSSMediaRule.cssRules`
  in `forced()` — about four lines — and it belongs to whoever owns
  `scripts/layout-audit.js`.** Until it lands, hover-state contrast on
  `.file-entry`, `.file-ref` and `.nav .view-item` is UNPINNABLE and is recorded
  as such rather than dressed as covered.
