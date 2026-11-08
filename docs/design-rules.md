# Design rules

The frontend's look, short and enforceable. Owner decision (docs/translation.md, 2026-11-07): the
rebuild/desk glassy dashboard is a must-have; one collapsible left panel holds the view elements.
Where a rule came from `LocalAgents/.worktrees/rebuild/desk` it is marked **[desk]** with the reason.
The contract (contract.md §5/§6) says *what* each primitive is; this file says how it looks.

## 1. Tokens — one file, `design/tokens.json`

Every spacing, type, radius, width, motion, easing, font, glass, background and colour value lives in **one file**,
`design/tokens.json`. It is the single source:

- the backend compiles it in (`core/src/design.rs`) and seeds `data/theme.json` from it; an older flat theme
  (`radius: "10px"`, `face` …) is migrated to this shape on read;
- the frontend imports it as `DEFAULT_TOKENS` (`src/lib/logic/theme.js`); the saved theme only overrides steps;
- the token block of `src/app.css` (between `tokens:start` / `tokens:end`) is generated from it by
  `bun scripts/tokens.js`. CSS names are `--<group>-<step>` (`--space-3`, `--text-sm`, `--motion-calm`) and plain
  `--<colour>` for the per-mode colours.

Scales (CSS `var(--<group>-<step>)`):

| group | steps |
| --- | --- |
| `space` | `0` 0px · `1` 4px · `2` 8px · `3` 12px · `4` 16px · `5` 24px · `6` 32px |
| `text` | `xs` 0.75rem · `sm` 0.875rem · `md` 1rem · `lg` 1.25rem · `xl` 2rem |
| `radius` | `none` 0px · `sm` 6px · `md` 10px · `lg` 16px · `full` 999px |
| `width` | `xs` 120px · `sm` 240px · `md` 360px · `lg` 480px · `xl` 640px · `wide` 960px · `page` 1600px · `panel` 256px · `rail` 64px · `label` 110px · `text` 72ch |
| `control` | `xs` 22px · `sm` 32px · `md` 40px · `lg` 44px |
| `icon` | `xs` 8px · `sm` 14px · `md` 18px · `lg` 32px |
| `widget` | `cell` 88px · `gap` 12px · `avatar` 96px |
| `span` | `icon` 2 2 · `small` 4 3 · `medium` 4 3 · `large` 4 3 (columns rows; medium and large open out of the grid) |
| `letter` | `body` 0.012em |
| `line` | `hair` 1px · `bold` 2px |
| `field` | `sm` 20vmax · `md` 26vmax · `lg` 34vmax · `xl` 44vmax |
| `motion` | `none` 0ms · `fast` 150ms · `base` 200ms · `calm` 260ms · `slow` 300ms · `pulse` 1600ms |
| `ease` | `calm` cubic-bezier(.22,1,.36,1) · `out` ease-out |
| `font` | `face` Amarante · `body` system-ui, sans-serif · `mono` ui-monospace, Menlo, monospace |
| `glass` | `blur` 24px · `alpha` 62% · `card` 72% · `scrim` 40% · `deep` 34% |
| `background` | `wash` 90vmax · `dot` 24px · `grid` 120px |
| `breakpoint` | `sheet` 640px · `phone` 768px |

Colours (per mode; `accent` / `press` are Askk's violet — selection, focus ring, primary fill, links, active nav,
open-ask edges; the wall fields are a violet aurora):

| token | light | dark |
| --- | --- | --- |
| `bg` | #ffffff | #000000 |
| `surface` | #ffffff | #000000 |
| `fg` | #111114 | #ededed |
| `muted` | #6b6b76 | #8a8a93 |
| `border` | #e2e2e8 | #26262a |
| `neutral` | #6b6b76 | #8a8a93 |
| `ok` | #1a7f37 | #3fb950 |
| `warn` | #9a6700 | #d29922 |
| `error` | #cf222e | #f85149 |
| `busy` | #0969da | #58a6ff |
| `accent` | #7c3aed | #b794ff |
| `tint` | #fbf9ff | #0d0a14 |
| `edge` | #ffffff | #3b3450 |
| `wall-a` | #d9ccff | #1e0c3d |
| `wall-b` | #f3d1ff | #33103f |
| `wall-c` | #c9d4ff | #0e1a44 |
| `wall-d` | #ffd9ec | #2b0b29 |
| `ripple` | rgb(255 255 255 / 42%) | rgb(196 176 255 / 9%) |
| `press` | #6d28d9 | #c4b0ff |
| `press-ink` | #ffffff | #1b0b3f |
| `ink` | #000000 | #000000 |
| `shadow` | rgb(46 16 101 / 24%) | rgb(0 0 0 / 80%) |

The theme editor edits exactly these groups and steps; `POST /theme` refuses an unknown group or step and a value
of the wrong type (a colour where a length belongs, a `;`).

## 2. Glass material **[desk]**

Three layers, as in the desk: **wall** (fixed, painted once) → **content** → **what floats**. The desk
proved this reads as depth without moving anything; blur is the expensive part, so only the floating
layer blurs.

- `.glass` — what floats (left panel, sheet, canvas toolbar, mobile menu button): tint at `glass-alpha`,
  `backdrop-filter: blur(var(--blur)) saturate(180%)`, a 1 px edge at 55 % of `edge`, an inner top
  highlight, and a soft deep shadow. **Never glass on glass.**
- `.pane` — content cards and canvas frames: tint at `card-alpha`, border, inner highlight, no blur.
- `prefers-reduced-transparency: reduce` → opaque: alphas 100 %, no blur, no wall fields.

## 3. Typography

- **Amarante** (weight 400 only, self-hosted `static/fonts/`, OFL) is the face for everything but data
  **[desk: the owner's must-have system font there]**. `font-synthesis: none`: no faux bold.
- **Hierarchy by size, never weight.** Scale: 0.8 (meta) · 0.875 (sm) · 1 (body) · 1.25 (card title, lg) · 2 rem (xl).
- **Mono** (`mono` token, tabular numbers) for data: numbers, ids, phases, meter values, tables, code.
  (The desk set mono to Amarante too; here data stays mono so numbers align.)
- Text wraps at word boundaries, ≤ 72ch; row titles truncate with an ellipsis (contract §6).

## 4. Space, radius, elevation, motion

- Spacing on a 4/8 px rhythm (Stack gap = n × 4 px). Gutters 16 px, 24 px from 768 px.
- Radius: `radius` for cards; controls `radius × 0.7`; inputs `radius × 0.6`; floating glass
  `radius + 6px` (concentric corners **[desk]**).
- Elevation: wall 0 · content 1 · panel/toolbars 30 · scrims 40/45 · sheet 41 · mobile drawer 50.
- Motion: ≤ 300 ms, ease `--calm` (cubic-bezier(.22,1,.36,1)) **[desk]** (`src/lib/logic/motion.js`). What moves:
  colour, shadow, the panel's width, a 0.98 press scale; a card's **size change morphs in place** (its height
  animates old → new in 260 ms, the new content fades in; the grid's reorder flips, 240 ms); a **status change
  cross-fades** (old and new line share one cell, 160/200 ms); the status light **pulses** while running or
  waiting. `prefers-reduced-motion: reduce` → none of it (durations 0, no pulse).
- **No card moves for state** **[desk: "a status change moves no card by one pixel", proven by pixel
  diff there]**: phase changes only colour and shadow, never size or place; only the owner (a size step, a
  drag) or the space a card gets changes its size. Order changes only by the
  owner (drag / arrows).

## 5. Layout shell

- One **left panel** ("view elements"), floating glass, 12 px inset:
  1. **Views**: Dashboard, Canvas (current view in `press`).
  2. **Engines**: the tree from `world` (engines → children, indented 14 px per depth; nothing
     hardcoded; updates on every `world`/`twin` event). A phase dot + mono phase word (its own phase) and the summary
     counts as small chips (`2 running`, `1 failed`, contract §2); an engine that failed or has anything failed below it
     shows its title in `error`. Click: on the dashboard a top engine scrolls to and
     focuses its card; otherwise it opens the engine's `full` view in the sheet.
  3. **Foot**: Unlock/Lock (edit mode), Theme (only unlocked), Appearance, connection status (dot + word).
- **Collapsed** = a 64 px icon rail (engine initials ringed in phase colour); remembered in
  `localStorage` (`askk.panel`, every access in try/catch).
- **≤ 768 px**: no panel in flow; a 44 px glass menu button top-left (with the status dot) opens it as an
  overlay drawer over a scrim. Navigation, a tree click, Escape or the scrim close it.
- Content takes the rest: dashboard grid per contract §6; canvas fills the height.
- **The page is a tree** (`data/ui/<view>.json`, contract §6): Page → Panel + CardGrid | Canvas. The background is
  the Page's `background`: the desk's colour fields (hard-edged discs in `wall-a..d` at fixed places, so glass has
  edges to soften), a soft wash, the desk's fine ripple (its own SVG noise, no asset), then an optional image
  (`/ui/assets/…`, `https://…`), a tint (a token name or `#hex`), a blur (px, the image only) and a dim (0–0.8). All
  of it is edited in edit mode (Panel → Page) with live preview, and saved via `POST /ui`.
- The sheet floats as glass: right side from 640 px (12 px inset), bottom sheet on phones.
- **Composer** (the page tree's footer text area, contract §6): floating glass, fixed to the bottom of the content
  area (left edge at `--shell`, so never under the panel), `space-3` above the safe-area inset, max `width-xl`,
  centred, radius `md + space-1`. Elevation 30 (with the toolbars; the mobile drawer at 50 overlays it). Phase chips
  are pills (32 px, 40 px on touch), the selected one (the mode) filled `press`; the Run workflow menu opens above
  the bar on an opaque surface (never glass on glass). Text area
  16 px, 40 px min, grows to 12 lines; Send is the `press` button, Stop an `error`-outlined one. The status line is
  mono `xs`, its light pulsing `busy` while the loop runs. It never covers content: a spacer of its height on the
  dashboard; on the canvas the toolbar and minimap rise by `--composer`.

## 6. Primitives

What a tree may say (every style prop is a scale step; content props — `value`, `label`, `title`, … — are free text):

| prop | primitives | steps |
| --- | --- | --- |
| `gap`, `pad` | Stack, Grid, CardGrid | 0–6 → `--space-n` |
| `size` (text) | Text | `xs sm md lg xl` → `--text-*` |
| `size` / `at` (card) | Card, Slot, CardGrid | `icon small medium large` (CardGrid also `auto`) |
| `min`, `max` | Grid, CardGrid | width steps `xs sm md lg xl wide page` |
| `tone`, `light` | all | `neutral ok warn error busy accent` |
| `radius` | any | `none sm md lg full` |
| `children` | any container | `{{size?, kinds?: {{<kind>: {{size}}}}}}` (card sizes; contract §6 Cascade) |
| background `at` | Page / Background fields | `[x, y]`, each 0–8 (eighths of the page) |
| background `size` | fields | `sm md lg xl` → `--field-*` |
| background `blur`, `dim` | Page / Background | 0–6 (blur → `--space-n`, dim → n/10) |
| background `tint`, field `color` | Page / Background | a colour token name |
| `grid`, `minimap`, `edges`, `zoom` | Canvas | bool, bool, `curve straight step none`, ratios per card size |
| `phases` | Composer | bool (`target`, `placeholder`, Page `default` are content) |


| primitive | look |
| --- | --- |
| Card | `.pane`; title 1.25 rem (opens full view); phase ≠ neutral → edge tinted and a soft backlight shadow in the tone **[desk backlight]**; failed → `error` edge |
| Text | sizes from §3; `tone` colours text; mono for data |
| Badge | pill, 22 px tall, tone border + 10 % tone fill + tone ink |
| Meter | 8 px track (6 % fg), filled bar in tone, mono `value/max`; shrinks inside rows, fills elsewhere |
| Button | 40 px, tone-tinted border over a half tint; hover 14 % tone; press scale |
| Field | 16 px input, 40 px tall, label above in `muted`; submit is a `press` button |
| Table | mono tabular cells, hairline rows, `muted` headers |
| Code | mono 0.8 rem in a faint inset well |
| Divider | 1 px `border` |
| Slot item | row with a 40 px chevron; hover = 5 % fg wash; failed → 2 px `error` inset edge |
| Unknown | dashed `warn` box |

**State colours only for phase and attention.** Phase → tone per contract §5. A failed object (a broken
`.md`) shows in `error` everywhere it appears (card edge, slot edge, panel entry) and offers only what
still works: no Edit (no kind config), Remove stays; its view shows the error text, wrapped.

## 7. Card sizes

Everything is a card; every object has four sizes, all its own (the language: `docs/glass.md`). Icon and small are
places in the **widget grid** (`Widgets`: square cells, `widget.cell` / `widget.gap`, dense packing, phones 4 full-width
columns); medium and large open *out of* it, so in the grid they keep the small footprint (tokens `span`).

| size | footprint | shows |
| --- | --- | --- |
| `icon` | 2×2 tile | the avatar on top, large and centred (`widget.avatar`), the label below (2 lines), the status ring; **no control outside the tile** — the size controls sit inside its top-right corner, shown on hover / focus, a long press on touch |
| `small` | 4×3 card | header (avatar, title on up to 2 lines — never cut to "Work…" —, the phase chip `status.chip` if any, light + `now`), the **focus** line (`status.focus`), the object's own small tree, then its **activity** (`twin.activity`, newest first: time · action · text · ✓/✕) in the scroll area |
| `medium` | the content area | the card **expands into the view**: it morphs from its grid rect to the content box (right of the panel, above the composer) while the rest recedes behind a frosted scrim; its full detail, activity beside it; Escape, the scrim or Close return |
| `large` | the viewport | the **immersive scene** at `/focus?id=<id>` (linkable): the page wall intensified, one sheet of deep glass, the `large` tree laid out by its `scene`; it zooms in with the View Transitions API (a swap without it); Escape, Close or Back return |

One size control cycles icon → small → medium → large (→ icon); ⛶ goes straight to large; a card's title opens its
medium. Only icon and small are remembered (`layouts.<view>.sizes`). The featured engine on the dashboard is the
container, shown in place; its ⛶ opens its scene. Pure logic: `src/lib/logic/focus.js` (tested).

The composer never covers content: on the dashboard the content scrolls in its own area that ends at the composer's
top (`--composer`).

## 8. Accessibility

- Contrast: text ≥ 4.5:1 (AA), large text and UI edges ≥ 3:1, in light and dark, over the glass and the
  wall **[desk: measured from pixels in ui/proof/card.js]**. Colour is never the only signal: phase also
  reads as a word.
- Touch targets ≥ 40 px (44 px for the floating menu button); inputs 16 px; no horizontal scroll at 375 px.
- Focus: 2 px `press` ring, 2 px offset, on every control; the dashboard cell takes focus when the tree
  scrolls to it. Toggles use `aria-pressed`, the panel `aria-expanded`, status `aria-live`.

## 10. Enforcement (by structure)

- **Trees**: `core/src/design.rs` `check_tree` refuses px/rem/em/vh, %, hex, `rgb()`/`hsl()`, font names, durations,
  free style props (`style`, `color`, `width` …) and any non-step value in a style prop, naming the path and the rule.
  Used by `POST /ui` (400) and on load (an older tree is migrated to the nearest steps, `migrate_tree`).
  Tests: `core/src/tests_design.rs` (every kind × 4 sizes, seeded trees, refusals, migration, engine `children:`),
  `server/src/main.rs` `ui_and_theme_posts_refuse_raw_values`.
- **Theme**: `check_theme` (`POST /theme`).
- **Token sync**: `src/lib/design.test.js` — `DEFAULT_TOKENS` equals the file, the app.css block equals
  `tokenBlock()`, Rust's seed equals the file (`seeded_page_trees_and_theme_follow_the_rules`).
- **Raw-value lint**: `src/lib/design.test.js` fails on any px/rem/em, hex, rgb/hsl, non-token `font-family`, `ms`/`s`
  duration, numeric `duration:`/`ms(n)`, or sized `<svg>` in `src/lib/primitives`, `src/lib/components`, `src/routes`
  and `app.css` outside its token block. The only exception: a media query may name a `breakpoint` token's value
  (CSS cannot read variables there). Primitives map steps → tokens only through `src/lib/logic/scale.js`; JS motion
  reads `MOTION` from the tokens (`ms("calm")`).

## 11. Canvas

An infinite backdrop over the page background: dots on `--background-dot`, faint lines on `--background-grid`,
both moving with the camera (lines only when zoomed far out). Every engine is a glass frame — header: light, title,
phase, open asks, status line; body: its elements as cards at the zoom-picked size (unless a `children:` default
says otherwise). Frames without a saved position are a tidy tree (parents above children, never overlapping); a
drag places one (saved in `layouts.canvas.positions`). Edges: parent → child, and every `help.ask` route (asker →
holder, or a "You" pin for the owner); open asks are accent, flowing, glowing. A running frame glows in its tone
(never resizes). Pan: drag (one finger on touch) with light inertia; zoom: wheel, pinch, − + Fit, keys `+ - 0`;
minimap (click or drag to move). Selecting a frame rings it and opens its sheet. Page-tree props: `grid`,
`minimap`, `edges`, `zoom`. Pure logic and tests: `src/lib/logic/canvas.js`, `canvas.test.js`.

- **Layout**: a compact tidy tree — top-level engines side by side in one row (wrapped into rows when Fit shows
  them larger, as on a phone), each child row just below its parent, siblings side by side, each subtree packed
  against its neighbours' contours, a parent centred over its children; laid out with the frames' measured sizes and
  again whenever they change. A saved position wins; a free child of a dragged parent hangs below it. No two frames
  overlap (tested with random measured sizes).
- **Zoom → size, legibly**: the `zoom` thresholds pick a size, then legibility caps it: no text under 10 px on
  screen (`LEGIBLE_PX`; each size's smallest text: cards `xs`, an icon frame its `md` title, a far frame its `xl`
  title). Too small → icon cards in an icon frame (avatar + title, no small chips or status line) → the far frame
  (avatar + title only; the title visually hidden below its own legible zoom). The cap overrides the cascade and the
  owner's step on the canvas (`resolveSize({cap})`), never enlarging. The "You" pin keeps a legible size at any zoom.
- **Fit**: the largest size whose layout fits the viewport at a zoom inside that size's legible band (`fitView`),
  then fitted again to the measured frames. Checked in the browser: every visible text ≥ 10 px at Fit.

## 9. Do not

- No raw colours, no grey fills in dark mode, no bold (one weight).
- No glass on glass; no blur on content cards.
- No layout change from a state change; no animation over 300 ms; none under reduced motion.
- No top bar; no second navigation surface; no hardcoded engine names.
- No HTML from the backend beyond the primitives (markdown via `Text md`, sanitised).
- No `localStorage` access outside try/catch.
