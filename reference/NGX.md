# ngx-admin (Nebular) — dark theme teardown

**Source:** live demo at `https://demo.akveo.com/ngx-admin/` — Angular 15+ / Nebular, v11.
**Theme captured:** Nebular **Dark** (`body.nb-theme-dark`), selected from the demo's own theme
chooser at `/ngx-admin/themes`. Note the deep links (`/pages/dashboard`) 404 on a hard load — the
server has no SPA fallback and bounces you to `/themes`. Every measurement below is a verbatim
`getComputedStyle` read off the live page at the stated viewport, not a paraphrase and not read
off the SCSS.

**Theme naming caveat:** ngx-admin's dark-purple theme is called **Cosmic**, not **Dark**. The
theme captured here is **Dark** (Eva Dark) as instructed — a desaturated navy, not purple. The
structural measurements are identical across themes; only the colour tokens differ.

---

## Screenshots

### `ngx-dashboard-1440.png` — default dashboard, sidebar expanded, 1440x900
The default `/pages/dashboard` (E-commerce) landing. A full-width fixed header sits above
everything; the 256px sidebar starts *below* it at y=76 and runs to the bottom. The sidebar shows
two ungrouped items (E-commerce, IoT Dashboard), then a `FEATURES` group label, then eleven
collapsible sections each with a leading 20px icon and a trailing chevron. The active item
(E-commerce) is signalled only by recolouring text+icon to primary blue plus a 4px blue bar
bled off the left edge — no background fill, no pill. The content area is a 36px-padded column
holding a 12-column Bootstrap-style grid of `nb-card`s at a 30px gutter, two promo banners on
top, then charts and a data list. A settings-gear tab is pinned to the right viewport edge.

### `ngx-sidebar-collapsed-1440.png` — compacted sidebar, 1440x900
Same page after clicking the hamburger. The sidebar drops from 256px to a **56px icon-only rail**
(`.compacted`); the labels are removed via `display: none` on `.menu-title`, the item padding
(`12px 16px`) is unchanged so the 20px icons stay optically centred, and the chevrons vanish. The
content column's left offset moves 256→56 and the column *reflows* — cards get wider, the chart
re-renders at the new width. Nothing overlays; the rail still occupies layout space. The active
item's 4px blue left bar is the only affordance that survives collapse, which is why it reads so
strongly here.

### `ngx-forms-1440.png` — form-heavy page (Forms → Form Layouts), 1440x900
Six independent form cards in a 2-column grid, each a self-contained `nb-card` with a titled
header and a bordered body. This is also the best view of **nesting**: the `Forms` parent is
recoloured blue with its left accent bar and its chevron rotated down; its four children render
as an inset block (rows start 20px from the sidebar edge) with **no icons** and a 1px divider
under each. The active child (`Form Layouts`) gets the same blue text + 4px bar as a parent
would. Inputs are full-width, dark-filled, 1px-bordered, with labels stacked above.

### `ngx-table-1440.png` — data table (Tables & Data → Smart Table), 1440x900
A single full-width `nb-card` containing a Smart Table. The card header carries only the title;
the table lives edge-to-edge in the body. Header row, a persistent inline filter row (a text
input per column plus a blue `+` add button in the Actions cell), then data rows with per-row
pencil/trash icon actions in a fixed leftmost column. Every cell is boxed by a full 1px grid, and
pagination is a centred numeric strip below the table. No sticky header, no row hover accent, no
density control.

### `ngx-dashboard-390.png` — dashboard at 390x844
Below 576px the sidebar is fully off-canvas (width 0) and the content column runs edge to edge at
16px padding. The header keeps only the hamburger and the wordmark — the theme picker, support
counter, contact, search, mail, bell and user block are all dropped. Every grid column falls to
`flex-basis: 100%`, so the two-up promo banners and the chart cards stack into one long column.
Card padding does not shrink; only the page gutter does.

### `ngx-sidebar-mobile-390.png` — off-canvas sidebar open at 390x844
Tapping the hamburger slides the full 256px sidebar back in as a `position: fixed; z-index: 999`
overlay anchored at `top: 76px` — it starts below the header rather than covering it. **There is
no backdrop or scrim**: the page behind stays at full brightness and is not inert, so the
"CONTACT US" and "LEARN MORE" buttons remain visible and clickable 130px to the right of the open
menu. The menu keeps its full desktop treatment including the expanded `Forms` subtree.

---

## Measured values

All values verbatim from `getComputedStyle` on the live Dark theme at 1440x900 unless a viewport
is stated.

### Sidebar

| Property | Value |
|---|---|
| Element | `nb-sidebar.menu-sidebar.start` |
| Width — expanded (≥1200px) | `256px` (`min-width: auto`, `max-width: none`) |
| Width — compacted (576–1199px) | `56px`, class `fixed compacted` |
| Width — collapsed (≤575px) | `0px`, class `fixed collapsed` |
| Background | `rgb(34, 43, 69)` — same token as header and cards |
| Border | `border-right: 0px none rgb(255, 255, 255)` (i.e. **no border**) |
| Separation from content | `box-shadow: rgb(26, 31, 51) 0px 8px 16px 0px` only |
| Position (desktop) | `nb-sidebar` is `static`; inner `.main-container` is `position: fixed` |
| Inner scroller | `.scrollable { overflow-y: auto; height: 824px; padding: 20px }` |
| Item height | `48px` |
| Item padding | `12px 16px` |
| Item font | `13px / 24px`, `600`, `"Open Sans", sans-serif`, `text-transform: none` |
| Item colour — resting | `rgb(255, 255, 255)` |
| Item colour — active | `rgb(51, 102, 255)` |
| Item background — active | `rgba(0, 0, 0, 0)` (**none**) |
| Active accent | `a.active::before` — `width: 4px`, `background: rgb(51, 102, 255)` |
| Active `border-left` | `0px none` — the bar is a pseudo-element, not a border |
| Icon size | `20x20px` (`nb-icon`, svg `20x20`) |
| Icon colour — resting | `rgb(143, 155, 179)` |
| Icon colour — active | `rgb(51, 102, 255)` |
| Icon→label gap | `margin-right: 8px` (label box starts at x=44: 16 pad + 20 icon + 8 gap) |
| Label | `.menu-title { flex: 1 0 auto; font-size: 13px; margin-left: 0; padding-left: 0 }` |
| Chevron | `.expand-state` `20x20px`, `rgb(143, 155, 179)`, at x=220 |
| Row divider | `border-bottom: 1px solid rgb(21, 26, 48)` on every `li.menu-item` |
| Group header (`FEATURES`) | `height: 49px`, `padding: 12px 16px`, `13px/600`, `rgb(143, 155, 179)`, `text-transform: none`, `letter-spacing: normal`, no background |
| Sub-item list | `ul.menu-items { padding: 0 20px }` — inset, not indented |
| Sub-item | `48px` tall, `padding: 12px 16px`, **no icon**, own `1px solid rgb(21,26,48)` divider |
| Sub-item text x | `36px` — **8px to the LEFT of parent text (44px)** |
| Compacted item padding | `12px 16px` unchanged; `.menu-title { display: none }` |

### Header

| Property | Value |
|---|---|
| Element | `nb-layout-header.fixed` |
| Height | `76px` |
| Width | `1440px` — **spans the full viewport, above the sidebar** |
| Background | `rgb(34, 43, 69)` |
| Border-bottom | `0px none` |
| Box-shadow | `none` |
| Position | `fixed`, `z-index: 1040` (sidebar overlay is `999`, settings tab `998`) |
| Inner nav | `padding: 20px`, `display: flex`, `align-items: center`, `justify-content: flex-start` |
| Sidebar relationship | Sidebar starts **below** the header (`.main-container` `top: 76px`); layout container has `padding: 76px 0 0` |
| Contents (desktop) | hamburger toggle → wordmark → theme `<select>` → "Support us" + GitHub star → download count → contact email → search → mail → bell → avatar + name |
| Contents (390px) | hamburger + wordmark only |
| Toggle | `a.sidebar-toggle` `28x29px`, `15px`, `rgb(143, 155, 179)`, `margin-right: 20px` |
| Wordmark | `.logo` `28px / 400`, `rgb(255,255,255)`, `padding: 0 20px`, `border-left: 1px solid rgb(21, 26, 48)` |

### Content area

| Property | Value |
|---|---|
| Column | `nb-layout-column` — `flex: 1 0 0%`, `max-width: none`, `background: transparent` |
| Padding ≥992px | `36px 36px 12px` |
| Padding 768–991px | `24px 24px 8px` |
| Padding <768px | `16px 16px 0px` |
| Max-width | **none** — the column is fluid, no centred measure at any width |
| Page scroller | `.scrollable-container { overflow-y: auto; height: 900px }` (= viewport) |
| Grid row | `.row { display: flex; margin-left: -15px; margin-right: -15px }` |
| Grid column | `padding-left: 15px; padding-right: 15px` → **30px gutter** |
| Columns ≥768px | `col-md-6` → `flex-basis: 50%` (2-up) |
| Columns <768px | `col-12` → `flex-basis: 100%` (1-up) |
| Card | `background: rgb(34, 43, 69)`, `border: 1px solid rgb(16, 20, 38)`, `border-radius: 4px`, `box-shadow: none`, `margin-bottom: 30px`, `padding: 0` |
| Card header | `padding: 16px 24px`, `15px / 24px`, `600`, `rgb(255,255,255)`, `border-bottom: 1px solid rgb(21, 26, 48)`, `text-transform: none`, transparent bg |
| Card body | `padding: 0`, `overflow: hidden`, `15px`, `rgb(255,255,255)` — **padding is per-component, not on the body** |

### Colour tokens (Dark theme)

| Role | Value |
|---|---|
| App background | `rgb(21, 26, 48)` |
| Surface (header, sidebar, card) | `rgb(34, 43, 69)` |
| Card border | `rgb(16, 20, 38)` |
| Divider / hairline | `rgb(21, 26, 48)` (= app background) |
| Primary / active | `rgb(51, 102, 255)` |
| Muted text + resting icons | `rgb(143, 155, 179)` |
| Body text | `rgb(255, 255, 255)` |
| Base font | `"Open Sans", sans-serif`, `15px` |

### Responsive & scroll

| Question | Answer |
|---|---|
| Sidebar collapse threshold | **1199px** — 1200 is `expanded`, 1199 is `fixed compacted` |
| Collapses to | a **56px icon-only rail** that still occupies layout space (content offset 256→56) |
| Off-canvas threshold | **575px** — 576 is `compacted`, 575 is `collapsed` (width 0) |
| Off-canvas behaviour | hamburger slides the full 256px panel in as `position: fixed; z-index: 999; top: 76px`, **no backdrop, content not inert** |
| Content padding steps | 36px (≥992) → 24px (768–991) → 16px (<768) |
| Grid steps | 2-up ≥768px, 1-up <768px |
| Does the sidebar scroll independently? | **Yes** — `.scrollable { overflow-y: auto; height: 824px }`, i.e. viewport minus the 76px header |
| Does the header stick? | **Yes** — `position: fixed`, `z-index: 1040`, full viewport width |
| Does the content scroll independently? | Yes — `.scrollable-container` is the page scroller at exactly viewport height |

---

## The five structural decisions worth stealing

1. **Make the header a full-width fixed bar and start the sidebar underneath it, then pay for it
   once with a single `padding-top` on the layout container.** ngx-admin sets
   `nb-layout-header { position: fixed; height: 76px; width: 100vw; z-index: 1040 }` and
   `.layout-container { padding: 76px 0 0 }`. Every child — sidebar, content, off-canvas overlay —
   inherits the correct top offset from that one declaration. No child ever computes
   `calc(100vh - header)` for itself.

2. **Give the app exactly two independent scroll regions, both sized to the viewport, and never
   let the document scroll.** The sidebar owns `.scrollable { overflow-y: auto; height: 824px }`
   and the content owns `.scrollable-container { overflow-y: auto; height: 900px }` — both
   equal to viewport (minus header, for the sidebar). A fifty-item menu and a thousand-row table
   scroll past each other without either one moving the header or losing its own position.

3. **Collapse the section menu by removing the labels, not by rebuilding the row.** The compacted
   rail keeps `padding: 12px 16px` and the 20px icon identical and only sets
   `.menu-title { display: none }`. 256px → 56px is `16 + 20 + 16 + 4`, which falls out of the
   arithmetic rather than being a second hand-tuned layout. One CSS class, no duplicate template.

4. **Signal the active section with a 4px pseudo-element bar bled off the panel edge, not with a
   background fill.** `a.active::before { width: 4px; background: <primary> }` plus recolouring
   text and icon to primary. It costs no layout, survives the collapse to a 56px icon rail where
   a text colour alone would be ambiguous, and does not fight a glass or translucent panel the
   way a filled pill does.

5. **Drive layout state off named breakpoints with hard thresholds and step the page gutter with
   them.** Compact at ≤1199px, off-canvas at ≤575px, gutter 36 → 24 → 16px at 992 / 768. The
   transitions are discrete and testable — you can assert "at 1200 the sidebar is 256px, at 1199
   it is 56px" — rather than emerging from a soup of `min()` and `clamp()` nobody can predict.

---

## The three worth NOT stealing

This is an enterprise CRUD admin template: fifty-three nav destinations, every screen a
self-contained page of cards, no single artefact that the operator watches over time. The askk
console is the opposite — one live conversation at the centre, a handful of sections, a dark
glass surface. Three of ngx-admin's choices are actively wrong for that.

1. **Every surface is the same flat opaque `rgb(34, 43, 69)`.** Header, sidebar and card are all
   one token; separation is carried by a `1px solid rgb(16,20,38)` border and a single
   `0 8px 16px` shadow. That is a deliberate choice for a template that must survive six themes,
   and it produces a page with no depth order at all — nothing reads as *above* anything else.
   A glass console needs the opposite: a small set of elevation tiers with different blur and
   translucency, so the conversation reads as the ground plane and the rail and any transient
   panel read as floating over it. Copying the single-surface token would flatten the product's
   one distinguishing visual idea.

2. **The content column is fluid with `max-width: none` and a 30px-gutter card grid that reflows
   on every sidebar toggle.** For a dashboard of independently-sized charts that is fine — nothing
   loses its place. For a conversation it is destructive: collapsing the rail rewraps every line
   of every message, and at 1600px+ a fluid column produces 140-character measure that nobody can
   read. The centre stage needs a fixed comfortable measure that does **not** move when the rail
   collapses; the rail's 200px should go to the margins, not to the line length.

3. **Nesting is signalled almost entirely by the absence of an icon, and the off-canvas menu has
   no backdrop.** Sub-item text sits at x=36 while parent text sits at x=44 — children are drawn
   *eight pixels to the left of their parents*, with an inset `ul` and a divider doing all the
   work. It survives only because ngx-admin's icons are decorative and the tree is shallow. And
   at ≤575px a 256px panel slides over live, non-inert content with no scrim, so the operator can
   tap a button they cannot fully see. On a single-operator console where a menu tap may start or
   stop an agent run, both are real hazards: indent children to the right of their parents, and
   put a real scrim behind any overlay that can dispatch an action.

---

## Method notes

- Screenshots taken with the gstack `/browse` headless Chromium at `1440x900` and `390x844`,
  Nebular Dark theme selected through the demo's own theme chooser.
- The shared browse daemon was already in use by another session and kept stealing the active
  tab, so this capture ran an isolated daemon (`BROWSE_PORT=8944`) with its own state file.
- Breakpoints were found by sweeping the viewport at 1600 / 1440 / 1200 / 1100 / 992 / 900 / 768 /
  700 / 576 / 500 / 390 and then bisecting 1200↔1199 and 576↔575, reading
  `nb-sidebar.className` and its computed width at each step.
- No file outside `reference/` was touched.
