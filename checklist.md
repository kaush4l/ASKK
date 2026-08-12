# checklist.md — the glass run

Every part, the problem observed, a falsifiable criterion, its builder, its
critic, status. Nothing is done until its critic **ran the app** and passed it.
Items are never deleted; a dropped one is marked won't-fix with a reason.

Status: ⬜ not started · 🔨 building · 🔍 in review · ✅ passed · ❌ failed (n) · 🚫 won't-fix

## Seams

Chosen so that coupled work has one owner. The token layer, the material, and
the file split are **one part with one owner** — they are the same edit seen
three ways, and splitting them would produce three agents racing on `:root`.
Everything after them is genuinely independent and fans out.

| # | Part | Problem observed (measured) | Acceptance criterion (falsifiable) | Builder | Critic | Status |
|---|---|---|---|---|---|---|
| **A** | **Token layer + material + file split** | 8 stylesheets, 1319 lines; 4 of them (706 lines, 54%) exist only to override the other 4 behind `html:not([data-skin="plain"])`. `--bg` and `--surface` each hold two values. 13 font sizes, 43 spacing values. Zero `backdrop-filter` in the product. | `web/` contains exactly the 7 files in DESIGN §2, each ≤200 lines. `scripts/check-selectors.py` reports 0 selectors declared in two files (G1) and 0 occurrences of `data-skin` in any rule position (G2). Token extraction reports ≤5 font sizes, ≤8 spacing values, 0 roles with two values. | orchestrator | design-critic (blind vs `reference/`) | 🔍 built, awaiting blind critic |
| **B** | Component library in Rust | 8 hand-rolled `section.panel`, 15 raw `button`, 4 raw `details`, 4 raw `form`, 6 raw `input`. Card/Button/Input/Badge/EmptyState/Skeleton/Toast/Modal do not exist. | Every one of those call sites goes through a shared component in `crates/ui/src/ui/`. No component has two implementations. `cargo test` green, `check-layering.py` green. | component-builder | component-critic | 🔨 |
| **C** | `/design-system` route | Does not exist. There is no way to see the system whole, so drift is invisible until a screen ships. | Route renders every component in DESIGN §8 in every variant and every state, over the real ground, with a skin toggle **and** a kill-backdrop-filter toggle. Reachable without a model endpoint. | component-builder | design-critic | 🔨 |
| **D** | Glass guard | The existing audit checks contrast and boundaries but knows nothing about the material: it cannot see a third stacked blur, E3 inside E1, or body text on a blur. | `scripts/layout-audit.js` gains four assertions that each **fail on demand** when the bug is reinstated: N1 (no E3 under E1/E2), N4 (≤2 blurring layers per chain), G3 (no >40-char text node without an opaque ancestor under a blur), and contrast sampled from **rendered backdrop pixels** at the lit lobe rather than from the fill colour. Proven by restoring each bug and watching the guard go red. | guard-builder | orchestrator (reinstate each bug) | 🔨 |
| **E** | Header, nav, rail, footer | Header is a flex row with no scroll behaviour. Footer does not exist. `.rail` is styled from 4 files across 9 rule blocks. | All four are E1, each defined in exactly one file (`chrome.css`). Header gains `--e1-shadow` on scroll and nothing else — no height change, no content swap. Footer is one row, 3 items, `--t-caption`. Fold transfer stays exact to the pixel in all four states (existing FOLD assertion). | chrome-builder | a11y-critic | ⬜ |
| **F** | Empty states + microcopy | Four of five rail panels are empty boxes on first load. No skeletons; a loading region is an empty box indistinguishable from an empty result. | Every list region (chat, board, tools, terminal, space, agents) renders an `EmptyState` with glyph + title + one sentence + one action, and a `Skeleton` while loading. A fresh agent shown each cold says what it is for within 5 seconds. | copy-builder | fresh-eyes-critic (never saw this repo) | 🔨 |
| **G** | Interaction states | Only `:focus-visible` and `:disabled` are defined. No `:hover`, no `:active`, no transitions anywhere — every state change is a hard cut. Default focus ring vanishes into translucent surfaces. | All five states on every interactive element. Focus ring = 2px accent + `--focus-halo` dark halo, visible over the lit lobe (sampled, not asserted). Every target ≥44×44. Full keyboard traversal, no traps. | interaction-builder | a11y-critic | 🔨 |
| **H** | Performance | Unmeasured. Backdrop blur on many simultaneous surfaces is the known cost of this aesthetic. | Frame time bounded while scrolling a 200-message log and while opening a modal, measured and recorded as a number in `progress.md`. N2 (no blur inside blur) verified as the reason it stays bounded. | perf-builder | orchestrator | ⬜ |
| **I** | Responsive + zoom | Currently verified at 6 widths × 2 skins × 2 routes by `check-layout.sh`. 320 and 1920 and 400% zoom are not covered. | Renders at 320/375/768/1024/1440/1920 and 400% zoom with no overflow, overlap, clipping, or lost function. Existing ONESCREEN / XOVERFLOW / HITTEST assertions extended to the two new widths. | guard-builder | orchestrator | 🔨 |
| **J** | Integration pass | The parts will have drifted. | One fresh agent that touched none of this walks every screen, finds the seams, fixes inconsistencies, and reconciles DESIGN.md with what shipped. Does not redesign anything that passed. | integrator | orchestrator | ⬜ |

## Rules for every builder

1. Work only from `DESIGN.md`. A value not in it is proposed to the orchestrator,
   who updates `DESIGN.md` **first**; only then does the work continue.
2. State reasoning **before** editing: what you observed in the running app, what
   the reference or the principle says is wrong, what you will change, what you
   expect to improve. An edit with no stated reasoning is reverted — not because
   it is wrong, but because nobody downstream can tell whether it was reasoned.
3. Do not change what the application does. Routing, data, business logic,
   validation, feature copy stay. A functional regression fails the whole run.
4. Never write a rule gated on `data-skin`. That is G2 and it is the single
   most-repeated defect in this repo's history — five occurrences across
   increments 12–13. The skin is a token swap.

## Rules for every critic

Fresh context. You get the goal, `DESIGN.md`, `reference/`, and the running
application. You do **not** get the builder's rationale — a critic that reads the
author's justification anchors to it and approves.

Run the app. Screenshot it. Where the comparison is visual, make it blind: two
unlabeled images, ours and the reference, say which is better and why. If ours
loses, name **the single largest gap** — the largest one, not a list — and send
it back.

Be harsh. The default failure of this loop is a critic saying "much improved!"
about something that would embarrass us next to
`reference/apple-macos-spotlight-glass.png`.

## Escalation

Three failures on one part means the strategy is wrong, not the execution.
Escalate with the tradeoff written out rather than attempting a fourth fix.
