# DESIGN.md — ASKK, liquid glass

The source of truth. Every token lands here before it lands in code. An agent
that needs a value not in this file stops and proposes it; it does not invent
one locally.

Read `audit.md` first for what this replaces and why.

---

## 1. Philosophy

ASKK is a control surface for agents that are actually running. Its job is to
let you see what a machine is doing and to let you say the next thing quickly.
The interface is chrome around a conversation; the conversation is the product.

So the glass is **frame, not content**. Translucency and light live on the app's
edges — the header, the two side panels, anything floating above the page — and
the middle stays calm, opaque, and legible. You should be able to read a
thousand-word model reply on this page at 2am without the material asking for
attention. Depth exists to say *which layer am I on*, never to decorate.

It refuses: glass on top of glass on top of glass; a blur behind body text;
decoration that carries information no other channel carries; animation longer
than a breath; any surface whose boundary you have to hunt for. It refuses to be
prettier at the cost of being readable — the plain skin is a full product, not a
degradation, and it ships every feature the glass one does.

A designer who has never seen this app should be able to reject a mockup with
this paragraph. If the mockup's centre column is translucent, reject it. If the
text sits directly on a blur, reject it. If you cannot tell in one second which
panel is on top, reject it.

---

## 2. Structure — how the CSS is organised

The old stylesheet was eight files, four of them existing only to override the
other four behind `html:not([data-skin="plain"])`. That is deleted. The new
arrangement, in `web/index.html` link order:

| File | Owns | Ceiling |
|---|---|---|
| `tokens.css` | `:root` and the three fallback token blocks. **No selector here targets an element.** | 200 |
| `base.css` | element defaults: `html`, `body`, headings, links, focus, native form controls | 200 |
| `glass.css` | the material: `.e1` / `.e2` / `.e3`, the nesting rule, the opaque path | 200 |
| `surfaces.css` | card, message, row, tool-call, disclosure, empty state, skeleton | 200 |
| `controls.css` | button, input, textarea, select, tab, badge, toggle | 200 |
| `layout.css` | the dashboard shell: three regions, the fold, breakpoints | 200 |
| `chrome.css` | header, nav, rail, footer — the persistent furniture | 200 |

**Invariant G1 — one home per property.** No *(selector, property)* pair may be
declared in two files. `scripts/check-selectors.py` fails the build on a
duplicate.

The pair, not the selector, is the right unit — and getting that wrong was the
first mistake in this document. "No selector in two files" sounds stricter and is
actually useless: it forbids `glass.css` giving `header` its fill while
`chrome.css` gives it its `position`, which is exactly the separation the file
split exists to create. What actually shipped broken twice in increments 12–13
was **one property set twice**: `grid-template-columns` declared in
`instrument.css` at specificity (0,1,2) and again in `dash.css` at (0,0,1), where
the loser was the newer rule. The pair rule catches that and permits the split.

**Invariant G2 — no skin-gated rules.** There is no `html:not([data-skin="plain"])`
anywhere. The skin is a **token swap**, not a stylesheet: `[data-skin="plain"]`
re-points the glass tokens at their opaque values and every rule in the product
keeps working untouched. This is the same code path as the `backdrop-filter`
fallback and `prefers-reduced-transparency`, so the fallback is exercised every
time anyone uses the plain skin. The repo's most-repeated defect — five
occurrences of a both-skins rule written machine-skin-only — becomes impossible
to express.

---

## 3. Color

### The ground

The glass has to sit on something with structure or it reads as grey plastic.
The ground is a fixed, three-lobe gradient field — never an image, so it costs
nothing and never fails to load.

```css
--ground:        #0b0611;   /* the base under everything */
--ground-deep:   #070409;   /* the vignette floor */
--lobe-accent:   rgba(214, 178, 255, 0.88);
--lobe-cool:     rgba(126, 172, 255, 0.52);
--lobe-warm:     rgba(255, 138, 214, 0.20);

--ground-field:
  radial-gradient(26rem 20rem at 14%  2%, var(--lobe-accent), transparent 58%),
  radial-gradient(22rem 17rem at 92% 82%, var(--lobe-cool),   transparent 60%),
  radial-gradient(34rem 24rem at 62% 40%, var(--lobe-warm),   transparent 62%),
  linear-gradient(180deg, var(--ground) 0%, var(--ground-deep) 100%);
```

**Concentrated, not spread — and the first version of this section got that
exactly backwards.** It specified three faint lobes washed across the whole
viewport, and a blind critic measured the result: the brightest pixel anywhere
in the rendered ground was **55/255**, and under the glass the backdrop never
passed **32**. The material was implemented correctly and had nothing to work
on; every surface read as a slightly lighter opaque panel.

The instructive comparison is that Reflect is globally *darker* than this
design — 91% of its pixels under sRGB 52, against our 87% — and still reads as
lit, because it puts 3.1% of its pixels above 208 and puts **all of them
directly behind one card**. Light that is spread is not light. These beams peak
at `rgb(190, 160, 226)`, L=0.42, and sit behind the chrome rather than between
it.

Applied to `body` with `background-attachment: fixed`, so panels move over a
still field and the parallax reads as depth rather than as scrolling wallpaper.

**The lightest region of this field is the top-left lobe.** Every contrast
measurement in this document and in the guard is taken there — it is the worst
case for light-on-glass, and it is where glassmorphism fails invisibly.

### Semantic roles

| Token | Value | Contrast on ground | Used for |
|---|---|---|---|
| `--ink` | `#f4f0fa` | 16.1:1 | primary text: replies, headings, input values |
| `--ink-2` | `#c6bad8` | 8.9:1 | secondary text: metadata, notes, timestamps, labels |
| `--ink-3` | `#8d80a6` | 4.6:1 | tertiary: placeholder, disabled label. **Never below 16px, never on glass.** |
| `--machine` | `#a9c6e0` | 11.2:1 | machine-produced values: paths, args, shell output, statuses |
| `--accent` | `#c9a4ff` | 10.4:1 | the one accent. Selection, focus, the live agent, links |
| `--accent-ink` | `#1a0f2b` | 9.4:1 on accent | text *on* a filled accent surface |
| `--success` | `#8fe0b4` | 11.8:1 | a turn completed, a file written |
| `--warning` | `#f2cf87` | 12.2:1 | degraded: no isolation, endpoint unreachable but retrying |
| `--danger` | `#ffadad` | 9.7:1 | a turn failed, a tool refused |
| `--hairline` | `rgba(255,255,255,0.10)` | — | the glass edge. **Decorative. Never the only boundary.** |
| `--hairline-lit` | `rgba(255,255,255,0.18)` | — | the top edge light-catch |
| `--control` | `#c0b3d4` | 12.4:1 | the boundary of any control with no fill (WCAG 1.4.11 ≥ 3:1) |
| `--divider` | `rgba(255,255,255,0.07)` | — | rules inside a surface |

`--accent` moved from `#b98cff` to `#c9a4ff`. The reason is specific and worth
stating precisely, because the first draft of this line overstated it: on the
**ground** the old value measures 4.98:1 and passes. On **E3 glass over the lit
lobe** — fill `rgba(255,255,255,0.09)` over `rgba(185,140,255,0.20)` over
`#0b0611`, an effective backdrop luminance of 0.042 — it measures **4.49:1 and
fails**. `#c9a4ff` measures 5.6:1 in that same worst case. That is the whole
argument, and it is why contrast on this design is sampled from rendered pixels
rather than computed from a fill colour: the token that fails is the one that
looked fine everywhere except the one place it mattered.

No other ink moved down.

`--control` was `#8b7aa8` and moved when the ground did. 3:1 is measured
against the **brightest backdrop a boundary sits on**, and the moment there was
a real beam behind the glass the old value measured **1.81:1** on lit chrome
while still reading 4.4:1 against the ground. It is 3.50:1 on lit glass and
8.9:1 on the plain skin's opaque surface. A token whose whole job is being
visible has to follow the light.

**`--hairline` vs `--control` is the load-bearing distinction in this palette.**
A hairline is a light catch on a material; it is allowed to be 1.4:1 because
something else — a fill, a shadow, a size change — is already separating the
surface. A control that has no fill is *drawn by its border*, and that border is
a non-text boundary at 3:1 minimum. The existing audit enforces this and it must
keep passing.

### Opaque surfaces (content areas, and the whole fallback path)

| Token | Glass value | Opaque value |
|---|---|---|
| `--surface-1` | — | `#150e1f` |
| `--surface-2` | — | `#1c1428` |
| `--surface-3` | — | `#241a33` |

Content that holds body text — the chat log, a model reply, the agent editor —
sits on `--surface-1` at full opacity. This is deliberate and is the main way
this design stays readable.

---

## 4. Glass — the material

Three elevations. Not four, not "a card variant that's a bit more frosted".

**Every number below is calibrated against `reference/NOTES.md`**, which carries
verbatim `getComputedStyle()` output from Apple (apple.com/os/macos, the HIG
materials page), Reflect and Linear, plus pixel-sampled luminance from the
macOS 27 Spotlight capsule and a visionOS panel. Five findings from that set
drive these values, and each one moved a number I had guessed wrong:

| Reference finding | Measured | Effect here |
|---|---|---|
| Blur clusters at **15–22px** for cards, **20px** for chrome. Nothing measured above 22. | Apple curtain 20px · Reflect card 15px · Reflect popover 22px · Linear header 20px | E1 28→**20**, E3 40→**22** |
| `saturate()` appears **only on Apple's light chrome**, never on a dark ground | HIG light nav `saturate(1.8) blur(20px)`; every dark surface has no saturate | E1 170%→**110%**, E3 185%→**115%** |
| Hairlines are exactly **1px at `rgba(255,255,255,0.08–0.10)`** | Reflect `0.1` · Linear `0.08` | E2 0.075→**0.08**, E3 0.14→**0.10** |
| **The top edge is a separate treatment in every high-craft example.** Linear adds a second inset white at 4%; Apple paints a specular arc; Reflect skips it *and its cards read flatter* | Linear `rgba(255,255,255,0.04) 0 1px 0 0 inset` | kept, retuned down from 0.18 |
| **Outer drop shadows are near-absent** — three of four carry the whole effect on blur + hairline alone | Apple `none` · Reflect card `none` · Linear header `none` | E1/E2 shadow → **none** |
| On a **dark** ground, glass *adds* light (visionOS panel 0.041 over a 0.003 cabin, ~13×); on a **bright** ground it *darkens* (Spotlight capsule 0.051 under a 0.318 wallpaper, ~6×) | pixel-sampled | our ground is dark, so the fill is **white-alpha**, and E3 over the lit lobe gets a dimming layer |

The last row is the one that decides whether this works. Apple's own published
number for clear glass over bright content is a **dark dimming layer at 35%**
(`reference/hig-liquid-glass-variants.png`). Our top-left lobe is the bright
content, so `--e3-dim` exists for exactly that.

### E1 — chrome

The app frame: **header, nav panel, rail panel. Not the stage.**

This section used to list "the stage's own container" and it contradicted §1,
which says *"If the mockup's centre column is translucent, reject it."* The code
took this side and shipped a blurred column holding the conversation. §1 is the
paragraph written to be used as a veto and it wins; §4 is corrected. Chrome is
the frame, and the frame does not include the middle.

The fill below is `fill` and `dim` **composited into one layer**. They were two
— a white-alpha fill over a dark `::before` at 55% — which is wrong twice: a
pseudo-element with `inset: 0` does not cover the scrolled area of a scrolling
panel, and nothing that measures a page by walking `backgroundColor` up the tree
can see it, so the guard read the raw beam and failed a page that was fine. The
single rgba is also the shape the reference uses — Apple's localnav pill
`rgba(42,42,45,0.843)`, Reflect's card `rgba(4,1,21,0.1)`: a **dark** tint on a
bright ground, not a white one. Under-glass luminance sweeps 0.007 → 0.102
across one panel, ~14×.

```css
--e1-fill:    rgba(31, 28, 35, 0.575);   /* white .055 over dark .55, resolved */
--e1-blur:    20px;
--e1-sat:     110%;
--e1-border:  1px solid var(--hairline);          /* 1px @ .10 */
--e1-lit:     inset 0 1px 0 0 var(--hairline-lit);/* the separate top edge */
--e1-shadow:  none;                      /* blur + hairline carry it */
--e1-radius:  var(--r-lg);   /* 16px */
```

### E2 — resting

Things that sit *inside* chrome: a card, an agent row, a tool-call block, a
message group. Nested in E1 its blur is off (N2), so `--e2-blur` applies only
when an E2 is the outermost glass in its chain.

```css
--e2-fill:    rgba(255, 255, 255, 0.032);
--e2-blur:    15px;                                /* Reflect's card, exactly */
--e2-sat:     100%;
--e2-border:  1px solid rgba(255, 255, 255, 0.08);
--e2-lit:     inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
--e2-shadow:  none;
--e2-radius:  var(--r-md);   /* 12px */
```

### E3 — floating

Modal, sheet, popover, toast, the endpoint menu. Above everything, over a scrim.
This is the one elevation that keeps a real outer shadow, because it is the only
one that genuinely floats — the reference set carries no shadow precisely
because nothing in it floats over its own app.

```css
--e3-fill:    rgba(62, 59, 66, 0.409);   /* same resolution, dim at HIG's 35% */
--e3-blur:    22px;                                /* Reflect's popover */
--e3-sat:     115%;
--e3-border:  1px solid rgba(255, 255, 255, 0.10);
--e3-lit:     inset 0 1px 0 0 rgba(255, 255, 255, 0.16);
--e3-shadow:  0 24px 60px -20px rgba(0, 0, 0, 0.75),
              0 2px 8px -2px rgba(0, 0, 0, 0.4);
--e3-radius:  var(--r-lg);
--e3-scrim:   rgba(7, 4, 12, 0.5);       /* over the page, behind the surface */
```

### The nesting rule — N1 through N4

This is the section that decides whether the result looks intentional or like
mud. It is mechanical, and the guard checks it.

- **N1.** E3 is never a descendant of E1 or E2. Floating surfaces render as a
  direct child of `#main`, over the scrim.
- **N2.** E2 may nest inside E1. When it does, **its `backdrop-filter` is off** —
  it becomes fill + hairline only. Enforced by one rule, not by discipline:
  ```css
  .e1 .e2 { backdrop-filter: none; -webkit-backdrop-filter: none; }
  ```
  A blur behind a blur re-samples an already-blurred layer and returns almost
  no visual difference.

  **This paragraph used to call N2 "the performance rule" and that over-claimed.**
  Measured (Chrome 145 headless-new, real Metal GPU, 1440×900 @ DPR 2, 200
  messages, scroll driven by `Input.synthesizeScrollGesture`, frame *work* from
  a `Tracing` capture — `requestAnimationFrame` deltas are useless in headless,
  which drives a synthetic 60 Hz vsync and returned exactly 16.67 ms for every
  configuration including a deliberately broken one): deleting the N2 block
  costs **+1.3 ms of median frame work and exactly one extra vsync of pipeline
  latency**, reproducibly across three reps with no overlap. Real, and about a
  40% increase — on a number sitting at 12% of budget. It is not what stands
  between this UI and 20fps, and the invariant is fully justified by the
  anti-mud argument alone.

  A second correction from the same measurement: **most of that benefit comes
  from the `.stage .panel` selectors in the block, not from the `.e1 .e2`
  selector this paragraph quotes.** And since `.stage` left the E1 group, those
  selectors are no longer preventing a blur-inside-a-blur at all — they are
  keeping the centre column's cards calm, which is §1's rule, not N2's. The
  block is doing two jobs under one name.
- **N3.** E2 never nests inside E2. A card inside a card is a layout mistake;
  the inner one becomes a plain `--surface-2` block with a `--divider`. The
  list must name the nestings that **actually occur**, not the ones that sound
  likely: the first version said `.panel .panel` and `.e2 .e2` and missed
  `.panel .agent-card` and `.panel .agent-row`, which are on the page, and
  which stacked three translucent layers on a content area for a whole cycle.
  A blind critic found it by walking the rendered DOM. The guard did not,
  because N3 was the one nesting rule nobody wrote an assertion for.
- **N4.** **At most two blurring layers in any ancestor chain**, and the only
  legal pair is E3-over-E1. Everything else is one. Measured by walking up from
  every leaf and counting ancestors whose **blur radius is greater than zero** —
  *not* whose `backdropFilter !== 'none'`, which is what this line said until
  the guard-builder pushed back. On the opaque path `--e1-blur` is re-pointed to
  `0px`, so the computed value there is `blur(0px) saturate(1)`: non-`none`. The
  literal reading would have failed three stacked *nothings* in the plain skin
  and in every reduced-transparency browser. **The material is the radius, not
  the keyword.**

### Body text never sits on a blur

**Invariant G3.** Any element containing a text node longer than 40 characters
must have an opaque ancestor between it and the nearest blurring surface.
Concretely: replies, notes, prompts, and shell output live on `--surface-1`
inside the glass, not on the glass. Labels, headings, counts and single words
may sit on glass, and they carry `font-weight: 500` minimum when they do.

### The opaque path — one code path, three triggers

```css
:root[data-skin="plain"], :root[data-glass="off"]
@supports not (backdrop-filter: blur(1px))
@media (prefers-reduced-transparency: reduce)
```
`[data-glass="off"]` is part C's kill-backdrop-filter toggle, on the same
selector rather than a fourth path.

**These three blocks must be byte-identical, and they were not.** `--e*-lit` was
being zeroed in the plain skin only, so a `prefers-reduced-transparency` user
kept a specular top-edge highlight on a surface with no material under it. "One
code path, three triggers" is a claim this file has to actually honour, and a
critic reading the built CSS caught it while the rendered page looked fine.
Each re-points the same tokens:

```css
--e1-fill: var(--surface-1);  --e1-blur: 0px;  --e1-sat: 100%;
--e2-fill: var(--surface-2);  --e2-blur: 0px;  --e2-sat: 100%;
--e3-fill: var(--surface-3);  --e3-blur: 0px;  --e3-sat: 100%;
--e1-border: 1px solid var(--control);   /* the hairline was decorative;
--e2-border: 1px solid var(--control);      with no material behind it, the
--e3-border: 1px solid var(--control);      border becomes the only boundary
                                            and must clear 3:1 */
--ground-field: linear-gradient(180deg, var(--ground) 0%, var(--ground-deep) 100%);
```

The border swap is the part people forget. With the blur gone, the hairline is
no longer a light catch on a material — it is the only thing drawing the box, so
it is promoted to `--control` at 4.4:1. The existing BOUNDARY assertion in
`scripts/layout-audit.js` already fails on exactly this mistake.

---

## 5. Typography

One family for prose, one for machine values. `--display` is deleted; it was an
alias for `--mono` and added a name without adding a value.

```css
--font: ui-sans-serif, system-ui, -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, "Cascadia Mono", Consolas, monospace;
```

**Five sizes. Three weights. Nothing else may appear in a `font-size`.**

| Role | Token | Size | Line-height | Tracking | Weight | Used for |
|---|---|---|---|---|---|---|
| display | `--t-display` | `clamp(1.375rem, 1.1rem + 1.2vw, 1.75rem)` | 1.15 | `-0.01em` | 600 | the masthead, a modal title |
| heading | `--t-heading` | `1.0625rem` (17px) | 1.3 | `0` | 600 | panel titles, agent names |
| body | `--t-body` | `0.9375rem` (15px) | 1.55 | `0` | 400 | replies, prose, input values |
| label | `--t-label` | `0.8125rem` (13px) | 1.4 | `0.01em` | 500 | metadata, form labels, buttons |
| caption | `--t-caption` | `0.6875rem` (11px) | 1.35 | `0.14em` | 600 | section eyebrows, uppercase only |

```css
--w-normal: 400;  --w-medium: 500;  --w-strong: 600;
```

**On glass, add weight and contrast.** Text on any `.e1`/`.e2`/`.e3` surface is
`--w-medium` minimum (never 400) and must measure **4.5:1 against the rendered
backdrop at the lightest lobe**, not against the fill colour. Caption is never
placed on glass below `--ink-2`.

Going from 13 sizes to 5 kills `0.9rem`, `0.85rem`, `0.82rem`, `0.8rem`,
`.8rem`, `0.75rem`, `0.95rem`, `1rem`, `1.4rem` — nine literals doing the work
of two tokens.

---

## 6. Spacing, layout, radius

**Base unit: 4px.** Eight steps, and no other spacing value ships.

```css
--s-1:  0.25rem;  /*  4 */   --s-5: 1.5rem;   /* 24 */
--s-2:  0.5rem;   /*  8 */   --s-6: 2rem;     /* 32 */
--s-3:  0.75rem;  /* 12 */   --s-7: 3rem;     /* 48 */
--s-4:  1rem;     /* 16 */   --s-8: 4rem;     /* 64 */
```

`--gap` is kept as an alias of `--s-4` because the layout guard and three
scripts reference it by name.

**Glass needs air.** Internal padding minimums, and they are minimums:

| Surface | Padding | Gap between children |
|---|---|---|
| E1 chrome | `--s-4` (16) at ≤768, `--s-5` (24) above | `--s-4` |
| E2 card | `--s-5` (24) block, `--s-6` (32) inline at ≥1024 | `--s-3` |
| E2 dense row (agent row, tool call) | `--s-3` | `--s-2` |
| E3 floating | `--s-5` at ≤768, `--s-6` (32) above | `--s-4` |

The card figure is the reference's, not a guess: Reflect's showcase card measures
`padding: 24px 32px` (`reference/NOTES.md`). My first pass said 16 and would have
shipped cramped glass, which is the thing that reads as a plastic overlay. If a
surface has to choose between one more element and its padding, it loses the
element.

**Radius** — four values:
```css
--r-sm: 8px;    /* inputs, buttons, badges */
--r-md: 12px;   /* E2 cards, rows */
--r-lg: 16px;   /* E1 chrome, E3 floating */
--r-full: 999px;/* pills, dots, avatars */
```
The old `border-radius: 0` overrides in `screen.css` are deleted. The product
has rounded corners; it does not argue with itself about it.

**Grid.** Unchanged from increment 13, because it is measured and correct:

```
≥1100px:  grid-template-columns: auto minmax(0,1fr) auto;
          .nav → col 1   .stage → col 2   .rail → col 3
          max-width: 96rem; margin-inline: auto;
<1100px:  single column, both panels default closed
```

Breakpoints: **320, 375, 768, 1024, 1100, 1440, 1920.** 1100 is the dashboard
fold threshold and is load-bearing; the others are test widths.

Panel widths at ≥1100: nav `13rem`, rail `clamp(21rem, 26vw, 26rem)`. Folding a
panel transfers its width to the stage **to the pixel** — asserted in all four
fold states by `scripts/layout-probe.js`, and that assertion does not get to
regress.

---

## 7. Motion

Glass has mass. It moves slowly and it settles; it does not snap or bounce.

```css
--dur-fast: 120ms;   /* state on an existing element: hover, active, focus */
--dur:      220ms;   /* a surface changing size or position: fold, expand */
--dur-slow: 380ms;   /* something arriving or leaving: modal, toast, sheet */

--ease:     cubic-bezier(0.32, 0.72, 0, 1);   /* the settle — default */
--ease-out: cubic-bezier(0.16, 1, 0.30, 1);   /* entrances */
--ease-in:  cubic-bezier(0.55, 0, 1, 0.45);   /* exits only */
```

**Hard cap 380ms.** Nothing in this product animates longer, including the five
existing loops.

What animates: background-color, border-color, box-shadow, opacity, transform.
**What never animates: `backdrop-filter`, `filter`, `width`, `height`, `top`,
`left`.** Animating a blur radius re-runs the whole composite every frame and is
the fastest way to drop this UI to 20fps.

The four existing state loops (`askk-pulse` on a working agent, `askk-travel` on
the rail tick, `askk-breathe` on a pending message, `askk-arrive` on a new tool
call) are kept: each is bound to a fact in the event log, not to decoration.
`askk-scan` is deleted — it is the only one that corresponds to nothing.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important; scroll-behavior: auto !important;
  }
}
```
Verified by the existing `--force-prefers-reduced-motion` headless run, which
asserts every `animation-name` resolves to `none`.

---

## 8. Components

One implementation each. A screen that hand-rolls one of these is not done.

### Surface / Card
Anatomy: `<section class="card e2">` → optional `<h2 class="card-title">` →
`.card-body`. Variants: `e1` (chrome) · `e2` (default) · `e3` (floating) ·
`flat` (opaque `--surface-1`, for anything holding body text — **G3**).
States: default · `[data-status]` tint via `--tone` · `[hidden]`.
Tokens: `--e{n}-*`, `--r-md`, `--s-4`, `--t-heading`.

### Button
Anatomy: `<button class="btn">` with optional leading glyph span.
Variants: `primary` (accent fill, `--accent-ink` text) · `secondary` (glass fill
+ `--control` border) · `ghost` (no fill, `--control` border) · `danger`.
Sizes: `md` (44px, default) · `sm` (36px — **only** inside a dense row that is
not a primary action, and never as the sole target on touch).
States — **all five defined, non-negotiable**: default · hover (fill +4% alpha,
`--dur-fast`) · `:focus-visible` (see below) · `:active` (`transform: scale(0.98)`,
fill +7%) · `:disabled` (`opacity: 0.55`, `cursor: not-allowed`, no hover).
Minimum target 44×44 including padding.

### Focus ring — the one that survives glass
A single `outline` disappears into a translucent surface. Every focusable
element gets a two-tone ring:
```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--focus-halo);   /* dark halo under the ring */
}
--focus-halo: rgba(11, 6, 17, 0.85);
```
The dark halo is what keeps the ring visible over the lit lobe. It is a token
and it does not get dropped for aesthetics.

### Input / Textarea / Select
Anatomy: `<label class="field-label">` + control. Variants: `text` · `multiline`
· `select` · `mono` (agent editor, shell). States: default · hover · focus ·
invalid (`--danger` border + a message, never colour alone) · disabled ·
readonly. Fill `--surface-1` (opaque — it holds typed text, G3). Border
`--control`. Min height 44px. Placeholder `--ink-3` and never the only label.

### Tab
Anatomy: `<button role="tab">` in a vertical `role="tablist"`.
States: default · hover · `:focus-visible` · `aria-selected="true"` (accent left
edge 3px + `--w-strong` + `--surface-2` fill) · disabled.
Roving tabindex, Arrow Up/Down and Left/Right both move — already implemented in
`tabs.rs`, kept.

### Badge / StatusDot
Anatomy: `<span class="badge" data-status>`; dot + label, **never dot alone**.
Variants map to `--tone`: idle · starting · waiting · working · failed · closed.
The label is the primary channel; colour and motion are secondary. This is an
existing invariant from increment 06's walk and it holds.

### Message
Anatomy: `.msg` → `.speaker` (who, in words) → `.said`.
Variants: user · assistant · tool · pending · error.
**Opaque, `--surface-1`, `flat`** — it holds the longest text in the product.
User messages carry an `--accent` left edge; errors carry `--danger` plus a
sentence, with the typed detail behind a disclosure.

### Disclosure
Anatomy: `<details class="disclose"><summary>` — summary is a 44px target with a
rotating chevron (`--dur-fast`). One implementation replaces the four hand-rolled
`details` blocks.

### EmptyState
Anatomy: glyph → one-line title (`--t-heading`) → one sentence (`--t-body`,
`--ink-2`) → one primary action. **Never a bare "No data".** Every list region
(chat, board, tools, terminal, space) gets one. This is the highest-value new
component: four of the five rail panels are empty on first load today.

### Skeleton
Anatomy: `.skeleton` blocks matching the shape of what is loading, `--surface-2`
with a 1.4s shimmer that stops under reduced motion. Replaces the current
behaviour of an empty box.

### Toast
E3, bottom-right ≥768 / bottom full-width below, `role="status"`, auto-dismiss
6s with a pause on hover/focus, manual dismiss always present.

### Modal / Sheet
E3 over `--e3-scrim`. Focus trapped, `Esc` closes, focus returns to the invoker,
`aria-modal`. Below 768 a modal becomes a bottom sheet. **N1 applies**: rendered
as a child of `#main`, never inside a panel.

### Header
E1, sticky, full width. Anatomy: wordmark · endpoint sentence (`role="status"`)
· `.switches` (two panel toggles + skin toggle). On scroll it gains
`--e1-shadow` and nothing else — no height change, no content swap.

### Nav (left) / Rail (right)
E1 columns. Fold via the `hidden` attribute, which works in both skins because
`[hidden] { display: none !important }` lives in the un-gated layer. Each has a
labelled toggle in the header with `aria-expanded` / `aria-controls`.

### Footer
Currently absent. Added as one E1 strip inside the stage: build id, deploy sha,
isolation state, and a link to the source. Three items, one row, `--t-caption`,
`--ink-2`. It is a status line, not a link dump.

### `/design-system`
A route rendering every component above in every variant and every state, over
the real ground, with a skin toggle and a "kill backdrop-filter" toggle so the
fallback is inspectable side by side. Critics open this first.

---

## 9. The two interactions that must feel good

The repeated actions in this product, counted from the event log's shape:

1. **Send a message.** Type → Enter → see it land. The composer keeps per-agent
   drafts (fixed in increment 13). The sent message must appear **immediately**
   and optimistically, with the pending state on the *reply*, not on your own
   text. Enter sends; Shift+Enter newlines. The composer never moves, never
   resizes under the cursor, and never loses focus after a send.
2. **Switch agents.** Click a tab or Arrow through the list. The stage swaps in
   under `--dur`. The draft, scroll position, and pending state of the agent you
   left are all preserved — you can hold three conversations open and lose none
   of them.

Neither gets an artificial delay, a streak, a badge count, or a nag. "Addictive"
here means the composer is always exactly where you left it.

---

## 10. Pass/fail — what a critic checks

1. Text on glass ≥ **4.5:1 against the rendered backdrop at the lightest lobe**,
   sampled from actual pixels, not computed from the fill colour.
2. Non-text boundaries ≥ **3:1** (WCAG 1.4.11) — and in the opaque path the
   border is the boundary.
3. With `backdrop-filter` disabled **and** with `prefers-reduced-transparency`,
   every surface legible and every boundary readable.
4. **N1–N4 hold.** No chain has more than two blurring layers; no E3 inside E1/E2.
5. **G3 holds.** No body text on a blur.
6. Renders at 320 / 375 / 768 / 1024 / 1440 / 1920 and at 400% zoom with no
   overflow, overlap, clipping, or lost function.
7. Frame time bounded while scrolling a long chat log and while opening a modal.
8. Every target ≥ 44×44 with all five states; focus ring visible on every surface.
9. Full keyboard traversal, sane order, no traps, nothing mouse-only.
10. **Token count down**: ≤5 font sizes, ≤8 spacing values, 0 roles with two
    values, 0 selectors in two files (G1), 0 skin-gated rules (G2).
11. `cargo test`, `scripts/check-layering.py`, `scripts/check-layout.sh` green.
12. A fresh agent shown a screen cold says what it is for within five seconds.

---

## Changelog

- **2026-08-12** — created. Replaces the eight-file skin-gated stylesheet with a
  seven-file token-swap system. `--accent` `#b98cff` → `#c9a4ff` (7.8:1 → 10.4:1)
  because the old value failed 4.5:1 on glass over the lit lobe. `--display`
  deleted (alias of `--mono`). `--bg`/`--surface` collapsed from two values each
  to one role each.
- **2026-08-12, second pass** — §4 recalibrated against `reference/NOTES.md`
  after the reference captures came back with measured values. Six numbers I had
  guessed were wrong in the same direction — too much material: blur E1 28→20 and
  E3 40→22 (nothing in the reference set exceeds 22px); saturation 170/185% →
  110/115% (saturate appears only on Apple's *light* chrome, never on a dark
  ground); E1 and E2 outer shadows deleted (three of four references carry the
  whole effect on blur + hairline alone); hairline alphas pulled to the measured
  0.08–0.10 band; top-edge light catch retuned 0.18→0.14. Added `--e3-dim` at
  Apple's published 35% for clear glass over bright content. §6 card padding
  16→24/32 to match Reflect's measured card.
- **2026-08-12, third pass** — reconciled with what shipped after the first
  blind critique. The ground was rewritten from three spread lobes to two
  concentrated beams (its brightest rendered pixel had been 55/255, under the
  glass 32); `--e1-fill`/`--e3-fill` collapsed fill+dim into one resolved rgba
  and `--e1-dim`/`--e3-dim` were deleted; `--control` `#8b7aa8`→`#c0b3d4` after
  it measured 1.81:1 on lit chrome; `.stage` removed from E1, resolving a
  contradiction between §1 and §4 in §1's favour; N3's selector list completed;
  N4 restated in terms of blur radius rather than the `none` keyword; the three
  fallback blocks made byte-identical.
