# audit.md — what is actually in the stylesheet today

Measured, not remembered. Every number below came out of two extraction passes
over `web/*.css` at the commit that opens the glass run.

## The shape of the problem

Eight stylesheets, 1,319 lines, **161 distinct selectors in 208 rule blocks**.
Four of the eight (`aaa`, `instrument`, `console`, `screen` — 706 lines, 54% of
all CSS) are gated behind `html:not([data-skin="plain"])` and exist only to
override the four that are not. They were added one increment at a time, each
"last, because it layers on the tokens above", and they now fight each other by
specificity rather than by cascade order. That is not a style; it is four
patches wearing one.

**This is the single largest finding.** It is also the increment-13 bug class
restated: a rule at (0,1,2) in `instrument.css` outlived the rule meant to
replace it in `dash.css` at (0,0,1), and the page shipped broken twice behind a
green guard. Every additional gated layer multiplies the number of places a
future rule can be silently outranked.

## Token counts

### Color — 18 custom properties, 15 raw literals

| Token | Defs | Values | Verdict |
|---|---|---|---|
| `--bg` | **2** | `#17101f` (theme) / `#120b1a` (aaa) | one role, two values |
| `--surface` | **2** | `#211830` (theme) / `#1b1327` (aaa) | one role, two values |
| `--tone` | **7** | `--line` ×2, `--ink`, `--accent`, `--danger`, `--ink-dim`, `color-mix(accent 55%, ink-dim)` | a status channel, correctly one role |
| `--accent` | 1 | `#b98cff` | the single accent — held |
| `--ink` / `--ink-dim` | 1 / 1 | `#f1ecf7` (14.6:1) / `#c0b3d2` (8.1:1) | good |
| `--line` | 1 | `#3b2d52` (1.49:1) | decorative only, never an outline |
| `--control` | 1 | `#7a6a95` (3.83:1) | the 1.4.11 boundary token |
| `--machine` | 1 | `#a9c6e0` (10.88:1) | tone for machine-produced values |
| `--danger` | 1 | `#ffb3b3` | |
| `--edge` / `--glow` | 1 / 1 | `color-mix` off `--accent` | |

Raw literals outside the token block: `#a06cd5` (a hardcoded fallback accent in
`board.css` that no longer matches `--accent`), `#1a0f2b` (button ink), `#000`
×4, `rgb(0 0 0 / 45%)`. **Six colors bypass the token layer.**

Missing entirely: any `surface-elevated`, `success`, `warning`. Status colour is
smuggled through `--tone` and `--danger` only.

### Type — **13 distinct sizes**, no scale

`var(--t-label)` ×10 · `0.9rem` ×9 · `var(--t-read)` ×3 · `var(--t-label, 0.8125rem)` ×3 ·
`0.85rem` ×2 · `.82rem` ×2 · `1rem` ×2 · `0.75rem` · `.8rem` · `var(--t-readout)` ·
`1.4rem` · `0.8rem` · `0.95rem`

Three tokens (`--t-label` 0.6875rem, `--t-read` 1rem, `--t-readout`
clamp(1.3,5vw,1.9)) exist and are used 17 times. **Twenty of 37 font-size
declarations are hardcoded rem values that ignore them**, and `0.9rem`, `0.85rem`,
`0.82rem`, `0.8rem`, `.8rem`, `0.75rem` are six values doing one job: "smaller
than body". Weights: only `600` and `400` — that part is clean.

Font families: two (`system-ui` stack, `--mono`), plus `--display: var(--mono)`,
an alias that adds a name without adding a value.

### Spacing — **43 distinct values**, 83 declarations

One token, `--gap: 1rem`, used 6 times directly and once as
`calc(var(--gap) * 2)`. Everything else is literal: `0.5rem` ×9, then a long
tail of `0.25rem`, `0.35rem`, `0.4rem`, `.4rem`, `0.45rem`, `0.6rem`, `.6rem`,
`0.7rem`, `0.75rem`, `0.15rem`, `0.1rem`, `0.2rem`, `0.3rem`, `0.9rem`,
`1.5rem`. **`0.4rem` and `.4rem` are the same value written two ways in two
files** — the inventory counts them separately because the parser does, and so
does a human reading a diff.

There is no scale. 43 values is 43 independent decisions.

### Radius — 4 values, 11 uses

`0` ×6 · `50%` ×2 · `8px` ×2 · `6px`. The six `0`s are `screen.css` squaring off
what `theme.css` rounded. Two components disagree about whether the product has
rounded corners.

### Borders — 17 distinct declarations, 42 uses

`1px solid var(--line)` ×10 is the workhorse. Then `1px solid var(--edge)` ×3,
`1px solid var(--edge, var(--line))` ×2, `3px solid var(--line)` ×2,
`3px solid var(--accent)`, `3px solid var(--accent, #a06cd5)`,
`1px solid var(--machine, var(--ink-dim))`, `1px solid var(--ink-dim)`,
`2px solid transparent`, plus bare `dashed` / `dotted` state switches.

Four different widths (1px, 2px, 3px, 0) and two fallback chains for tokens that
are always defined.

### Depth — **zero blur, zero z-index**

`backdrop-filter`: **0 occurrences.** `filter: blur()`: 0. `z-index`: 0.
There is no material and no explicit stacking order anywhere in the product.

Shadows: 10 distinct, 11 uses, every one of them a glow (`0 0 X var(--glow)`)
rather than a light-and-shadow depth cue. Two are `none` (screen.css switching
off what aaa.css turned on). One is `0 0.25rem 1rem -0.3rem var(--glow)` — the
only declaration in the codebase that reads like an elevation.

### Motion — 5 keyframe animations, 6 declarations

`askk-pulse` ×2, `askk-scan`, `askk-breathe`, `askk-travel`, `askk-arrive`.
Durations 0.3s / 1.2s / 1.6s / 2s / 2.4s. Easing: `ease-out`, `ease-in-out`,
`linear` ×2. All five are correctly switched off under `prefers-reduced-motion`
(verified by the existing headless probe). **No transitions at all** — nothing
eases between states; every hover and fold is a hard cut.

## Component inventory — what the markup hand-rolls

From `crates/ui/src/*.rs` (3,236 lines across 16 files):

| Thing | Instances | Shared component? |
|---|---|---|
| `section.panel` | **8** | ❌ hand-rolled 8× |
| raw `button {}` | **15** | ❌ none |
| raw `details`/`summary` | **4** | ❌ none |
| raw `form` | **4** | ❌ none |
| raw `input` | **6** | ❌ none |
| `.note` | 7 | ❌ a class, not a component |
| `.pending` | 4 | ❌ a class, not a component |
| `PanelToggle` | 2 | ✅ `dash.rs` |
| `AgentTabs` | 1 | ✅ `tabs.rs` |
| `ChatPane` | 1 | ✅ `chat.rs` |
| `Composer` | 1 | ✅ `composer.rs` |

So: four real components exist. **Card, Button, Input, Select, Modal, Sheet,
Toast, Badge, Table, EmptyState, Skeleton, Avatar, Header, Footer do not.**
There is no `/design-system` route.

### The same surface styled in three places

| Surface | Styled in |
|---|---|
| `.panel` | `theme.css:54`, `aaa.css:50`, `screen.css:97` |
| `.msg` | `theme.css:122`, `aaa.css:84`, `screen.css:109` |
| `.agent-row` | `board.css:29`, `instrument.css:69`, `screen.css:117` |
| `.tool-call` | `theme.css:198`, `aaa.css:89`, `screen.css:116` |
| `.agent-tabs .tab` | `theme.css:142`, `aaa.css:94`, `panel.css:27` |
| `.rail` | `console.css:168`, `instrument.css:176/183`, `dash.css:133/154`, `screen.css:142` |

`.rail` is styled from four files across nine rule blocks. This is what "painted
over" looks like when it is measured instead of asserted.

## What is already good, and must survive

Not everything here is debt. These are load-bearing and the glass run does not
get to break them:

- **One accent token.** Purple, one value, used everywhere. Held for 13 increments.
- **`--control` at 3.83:1** exists specifically because a decorative `--line` at
  1.49:1 was being used as an outline. That distinction is a WCAG 1.4.11 fix and
  is enforced by `scripts/layout-audit.js`.
- **`[hidden] { display: none !important }`** is the collapse mechanism, and it
  works with the machine layer off. The fold is skin-independent by construction.
- **Reduced motion is honored** and proven by a headless probe that fails on demand.
- **The plain skin is a real product**, not a degradation. Increment 13 spent four
  fixes making it so. Anything written `html:not([data-skin="plain"])` that should
  apply to both skins is the single most-repeated defect in this repo's history —
  five occurrences, recorded as increment 13's lesson.
- **`scripts/check-layout.sh`** runs the shell's markup against the *built*
  stylesheets in `dist/` at six widths × two skins × two routes and fails on any
  FAIL line. It asserts fold transfer to the pixel, hit-testing, one-screen, and
  contrast on rendered elements. It is the only reason this audit can quote
  numbers instead of impressions.

## The four numbers to beat

| Metric | Now | Target |
|---|---|---|
| Distinct font sizes | 13 | ≤ 5 |
| Distinct spacing values | 43 | ≤ 8 |
| Roles with two values (`--bg`, `--surface`) | 2 | 0 |
| Surfaces styled in 3+ files | 6 | 0 |
