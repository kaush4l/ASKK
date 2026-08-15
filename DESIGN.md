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
| `layout.css` | the dashboard shell: three regions, the fold, breakpoints | 200 |
| `chrome.css` | header, nav, rail, the stage head — the persistent furniture | 200 |
| `strip.css` | the status strip: its pills, its three breakpoints, its scrollport | 200 |
| `surfaces.css` | card, message, row, tool-call, disclosure, empty state, skeleton | 200 |
| `controls.css` | button, input, textarea, select, tab, badge, toggle | 200 |
| `workspace.css` | what is inside the Linux: the folder listing, one file's contents | 200 |
| `mission.css` | the Dashboard's fleet surface: the tile strip, and the board's deck | 200 |

`mission.css` is the tenth (increment 27). It owns two things and they are one
region: the strip of tiles across the top of the Dashboard, and the deck the
agent board became underneath it — `.board`'s own `display` and gap, moved here
whole from `surfaces.css` under G1, plus the column treatment that turns a row
into a card and the rule that keeps the rail's compact copy a list. The
alternative was more of `surfaces.css`, which was at its 200-line ceiling and
which owns *what a surface is* — a card, a message, a row, a tool call. A tile
is not one of those: it is a **fold rendered as a fact**, four words over a
number, and the only thing it has in common with a card is that it is opaque.
The board's deck follows it here for the reason the file split exists at all —
one home per property. What did **not** come with it is `.agent-row` itself,
which stays in `surfaces.css`: it is a row wherever it is rendered, and what
27 changed is the deck around it.

Two rules in this file are worth naming because they are refusals. `.tile` has
one surface and no gradient — the reference screenshot this was built from
gives every tile its own orange/violet/teal wash, and in a product where
`--danger`, `--warning` and `--success` already carry meaning on a card, a
decorative wash beside them is how a red state stops reading as red (G2: the
skin re-points tokens and never restyles elements). And the only tinted state
is `[data-status="failed"]`: there is no green tile, because this product
reports a failure and never infers a success from the absence of one.

`strip.css` is the ninth (24-walk). The strip is five pills, three breakpoints and one horizontal scrollport, and `chrome.css` — which also carries the nav, the rail and the banner — was at its 200-line ceiling when the walk found the endpoint pill unreadable at 390. Splitting on the ELEMENT rather than trimming the reasons is the rule this table already keeps. It is linked after `chrome.css`, so cascade order is unchanged, and `header`'s own properties stay in `chrome.css` — the strip's sheet says only what the strip does.

`workspace.css` is the eighth, added with the Workspace view (15G). The
alternative was more of `surfaces.css`, which was at its 200-line ceiling, and
"what the machine has on disk" is not a card, a message or a row — it is the
one surface in the product whose content comes from outside the browser. A new
file needs a reason like that one; `check-selectors.py` holds the list.

The order is `index.html`'s link order and it is dependency order: geometry and
furniture before the things that compose over them. This table used to list
surfaces and controls above layout and chrome; the code has always shipped the
order above, and since link order decides which of two same-specificity rules
wins, the table is not decoration and gets corrected to the code.

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
--lobe-cool:     rgba(168, 140, 255, 0.30);
--lobe-warm:     rgba(226, 138, 226, 0.16);

--ground-field:
  radial-gradient(30rem 30rem at  6% 46%, var(--lobe-accent), transparent 62%),
  radial-gradient(26rem 26rem at 97% 34%, var(--lobe-cool),   transparent 62%),
  radial-gradient(34rem 24rem at 55% 96%, var(--lobe-warm),   transparent 62%),
  linear-gradient(180deg, var(--ground) 0%, var(--ground-deep) 100%);
```

**Concentrated is not enough; it also has to be PLACED, and this document
lagged the code by one whole correction on that.** The block above used to read
`at 14% 2%` / `92% 82%` / `62% 40%`, which is what shipped in the third pass and
was then measured and moved — every pixel over relLum 0.15 landed in one 186×89
patch above y=98, which no panel ever covers, and 42% of it sat under the opaque
endpoint pill, which crushed 0.228 to 0.006. Light nothing can transmit is not
light. The shipped beams sit at the vertical middle of the side panels (whose
span is y 98–884), and `tokens.css` has carried that since; this file is being
corrected to it, not the other way round.

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

**AND IT IS OPT-IN NOW (R5-C).** The two beams were the only ornament in this
product and the one thing dating it — *"the thing most likely to read as 'AI
app, 2024'. Tellingly, `Plain background: on` looks better — cleaner, more
expensive, more focused."* That verdict came from a critic arguing for more
ornament, not less, and it agrees with §1: this is a control surface, and its
job is to let you read what a machine is doing at 2am. So `data-skin="plain"`
is what the page carries unless a stored preference says otherwise, the stored
value is now `glow`, and the ABSENCE of a choice is the plain ground.

Three consequences worth stating. The product's default and its no-JS,
no-storage, no-`backdrop-filter`, `prefers-reduced-transparency` fallback are
now **the same picture**, which is the strongest form of §2's G2. Both skins
stay reachable (Settings → Appearance) and both are still audited —
`scripts/check-layout.sh` runs every width in `machine` and `plain`, and
`scripts/layout-probe.js` still selects with `?skin=plain`, untouched. And the
lit-lobe contrast measurements above are still the ones that bind: they are the
worst case, the glow can be switched on at any time, and a token that fails
there fails.

**AND IT IS ONE IDENTITY (R8-GLOW).** The skin was kept and re-tuned rather
than deleted, and the argument for keeping it is that the finding against it was
not "ornament" — it was *wrong colour*. `--lobe-cool` was
`rgba(126, 172, 255, 0.52)`: a blue-cyan wash across the top right of a violet
product, the one hue on the page that belonged to nothing else on it, bright
enough to be the first thing seen on a screen whose subject is the panel under
it. A second skin has to be the same identity in a different register or it is a
second product. So all three lobes are steps of the accent now, the cool one is
the coolest violet rather than a blue, and the warm one is dimmer.

The other half of that finding was that the glow *softened the panel edges*,
which are this design's best asset — and it was right, because in the glow path
the panel border is `--hairline` while the plain path promotes it to `--control`.
`--hairline` is `0.15` rather than `0.10`, and `--e2-line`/`--e3-line` moved with
it, so a panel keeps its boundary with the light on. Deleting the skin was the
alternative and it was rejected on cost, not taste: it would take
`scripts/check-layout.sh`'s two-skin matrix, `layout-probe.js`'s `?skin=plain`
selection, `skin.rs`, the `data-skin` contract and this section with it — a large
deliberate change to the gate, to remove something three token values fixed.

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
| `--hairline-lit` | `rgba(255,255,255,0.30)` | — | the top edge light-catch |
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
| **The top edge is a separate treatment in every high-craft example.** Linear adds a second inset white at 4%; Apple paints a specular arc; Reflect skips it *and its cards read flatter* | Linear `rgba(255,255,255,0.04) 0 1px 0 0 inset` | kept; E1 reads `--hairline-lit` at **0.30**, E2 0.06, E3 0.16 |
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
--e1-line:    var(--hairline);                    /* 1px @ .10 — a COLOUR */
--e1-lit:     inset 0 1px 0 0 var(--hairline-lit);/* the separate top edge */
--e1-shadow:  0 0 0 0 transparent;       /* blur + hairline carry it */
--e1-radius:  var(--r-lg);   /* 16px */
```

Two shapes in that block are corrections to this document, not to the code.
`--e*-border` was specified as a whole `1px solid …` shorthand and shipped as
`--e*-line`, a **colour**, because `glass.css` writes the width and style once
(`border: 1px solid var(--e1-line)`) and the opaque path swaps only the colour —
a shorthand token would have made the swap re-declare the width three times. And
`--e1-shadow` cannot be `none`: it is composed as `box-shadow: var(--e1-lit),
var(--e1-shadow)`, where `none` in a list is invalid CSS and silently drops the
top-edge light with it. `0 0 0 0 transparent` is the same picture and composes.

### E2 — resting

Things that sit *inside* chrome: a card, an agent row, a tool-call block, a
message group. Nested in E1 its blur is off (N2), so `--e2-blur` applies only
when an E2 is the outermost glass in its chain.

```css
--e2-fill:    rgba(255, 255, 255, 0.032);
--e2-blur:    15px;                                /* Reflect's card, exactly */
--e2-sat:     100%;
--e2-line:    rgba(255, 255, 255, 0.08);
--e2-lit:     inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
--e2-shadow:  0 0 0 0 transparent;
--e2-radius:  var(--r-md);   /* 12px */
```

`--e2-line` is also the border of every `.panel`, which is the surface class the
product actually uses everywhere content lives. That was `--divider` and it was
wrong: `--divider` is a rule *inside* a surface and may be faint, but on the
opaque path `--e1-fill` and the panel's own fill both resolve to `--surface-1`,
so a panel sitting in the rail was its own colour with a 7% line around it —
**1.2:1, in the one skin where the border is the only boundary there is**. §10.2
is the assertion it failed, and it failed it in the plain skin only, which is
exactly where this repo has always failed things.

### E3 — floating

Modal, sheet, popover, toast, the endpoint menu. Above everything, over a scrim.
This is the one elevation that keeps a real outer shadow, because it is the only
one that genuinely floats — the reference set carries no shadow precisely
because nothing in it floats over its own app.

```css
--e3-fill:    rgba(62, 59, 66, 0.409);   /* same resolution, dim at HIG's 35% */
--e3-blur:    22px;                                /* Reflect's popover */
--e3-sat:     115%;
--e3-line:    rgba(255, 255, 255, 0.10);
--e3-lit:     inset 0 1px 0 0 rgba(255, 255, 255, 0.16);
--e3-shadow:  0 24px 60px -20px rgba(0, 0, 0, 0.75),
              0 2px 8px -2px rgba(0, 0, 0, 0.4);
--e3-radius:  var(--r-lg);
--e3-scrim:   rgba(7, 4, 12, 0.5);       /* over the page, behind the surface */
--e3-dim:     rgba(7, 4, 12, 0.35);      /* HIG's 35%, defined and UNUSED */
```

The third pass said `--e1-dim`/`--e3-dim` were deleted when fill and dim were
composited into one rgba. `--e1-dim` was; `--e3-dim` is still in `tokens.css`
and nothing reads it, and so are `--e3-scrim` and `.scrim`, because **no E3
surface is rendered anywhere in the product** — the only instance of the E3
material on the page is the gallery's swatch. See §8 on Toast and Modal.

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
--e1-line: var(--control);   /* the hairline was decorative; with no material
--e2-line: var(--control);      behind it the border becomes the only boundary
--e3-line: var(--control);      and must clear 3:1. `.panel` borders with
                                --e2-line, so it swaps here too. */
--e1-lit: none; --e2-lit: none; --e3-lit: none;
--ground-field: linear-gradient(180deg, var(--ground) 0%, var(--ground-deep) 100%);
```

The border swap is the part people forget. With the blur gone, the hairline is
no longer a light catch on a material — it is the only thing drawing the box, so
it is promoted to `--control` at 4.4:1. The existing BOUNDARY assertion in
`scripts/layout-audit.js` already fails on exactly this mistake.

---

## 5. Typography

**Three families. Six sizes. Three weights. Nothing else may appear in a
`font-size`.**

### The families (R5-B)

```css
--font: Inter, "SF Pro Text", -apple-system, "Segoe UI Variable Text",
        "Segoe UI", ui-sans-serif, system-ui, sans-serif;
--display: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua",
           Georgia, ui-serif, serif;
--mono: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono",
        "Cascadia Mono", Menlo, Consolas, monospace;
```

`--display` was deleted in the first pass of this document for being an alias
of `--mono` — a name with no value. It is back as a **real third family**, and
the argument is the one a blind critic made: *"a product with a violet-and-void
palette this specific and copy this carefully written has clearly had someone's
attention — and then shipped in the OS default font."* Everything was
`ui-sans-serif`, which on the machines this is developed and demoed on resolves
to SF Pro: the operating system, not a choice.

**No font FILE ships, and that is a constraint, not a shortcut.** This build is
offline-first and self-contained: Trunk copies `web/` into `dist/`, `sw.js`
precaches it, and `publish.sh` gates on there being no origin-absolute
reference in the output. A webfont is a network dependency, another gate, and
40–80KB of payload for one aesthetic decision. So the identity comes from a
family every target platform already has and almost nobody uses for chrome — a
transitional serif — applied to **three elements only**: the masthead `h1`, the
`.tagline` lede, and the `HARNESS` wordmark. Three instances, not three
hundred, is what keeps a serif on a dark console reading as a decision rather
than as a theme. `--font` leads with Inter because it is on most machines this
runs on and is a better UI grotesque than the system default; where it is
absent the stack falls through SF Pro Text and Segoe UI Variable Text, which is
honest — on a stock Mac the UI face is what it always was, and the identity is
carried by `--display`.

`--mono` is a deliberate stack too, not an accident: `ui-monospace` first, then
the three faces a developer machine actually has. Two rules in `workspace.css`
were reaching for `--font-mono`, **which is not declared anywhere**, so every
file name and every editor line in the product rendered in the browser's
default `monospace` — and the same two rules asked for `--r-1`, also
undeclared, so their radius resolved to nothing. Both are fixed.

### The ramp (R5-A)

| Role | Token | Size | Line-height | Tracking | Weight | Used for |
|---|---|---|---|---|---|---|
| display | `--t-display` | `clamp(1.5rem, 1.15rem + 1.4vw, 2rem)` | 1.15 | `-0.01em` | 600 | the masthead. `--display` family |
| subhead | `--t-subhead` | `1.25rem` (20px) | 1.25 | `0` | 600 | **a `h2` in the stage** — a panel's title, sentence case |
| heading | `--t-heading` | `1.125rem` (18px) | 1.35 | `0` | 600 | `h3`, an empty state's title, the lede |
| body | `--t-body` | `1rem` (16px) | **1.6** | `0` | 400 | replies, `.note`, every explainer, input values |
| label | `--t-label` | `0.875rem` (14px) | 1.4 | `0.01em` | 500 | buttons, form labels, metadata, machine values |
| caption | `--t-caption` | `0.6875rem` (11px) | 1.35 | `0.14em` | 600 | view eyebrows, speakers, badges, origin marks |

**The sixth size is why `check-selectors.py`'s ceiling moved from 5 to 6, and
the move is recorded in the checker itself.** Counted over every rendered leaf
node on the Dashboard, the five-size product measured **42 elements at 14px, 5
at 18px, 2 at 32px, 1 at 11px**. Explanatory prose, button labels, nav items,
status strings, file names and code results were all one size, so every panel
read as a single undifferentiated slab, and the 32 → 18 → 14 jump left no
subhead register at all: `h2` sat at 18px, the same step as the `h3` agent
names *inside* it, so a region's title and its contents spoke in one voice.

Two changes carry the fix. `h2` becomes `--t-subhead` — with the tracking
pulled from `0.14em` to `0.06em`, because 0.14em is an 11px eyebrow's letter
spacing and at 20px it reads as a banner. And `.note`, which is what every
explainer in this product is, moves from `--t-label`/`--lh-label` to
`--t-body`/`--lh-body`.

**AND `h2` IS NOT UPPERCASE, AND A RAIL `h2` IS A STEP DOWN (R11).** R5-A kept
the caps and only pulled the tracking. What that produced, once every region had
a title, was `RUN A TASK · MAIN` over `AGENTS AND WHAT THEY ARE DOING` over
`PROCESSES · 1 RUNNING` over `WORKSPACE ARTIFACTS` over `TOOL TRACE · MAIN` —
five tracked banners in one column, *"shouting in unison"*, with nothing in the
stack louder than anything else. **Uppercase belongs to `--t-caption` alone** —
the view eyebrow, the rail's `.rail-who`, `.proc-meta`, the speaker marks — and a
register spent at two sizes marks nothing at either. `h2` is sentence case at
`0` tracking, `--tr-subhead` is deleted from `tokens.css`, and the eye gets its
hierarchy back from SIZE: the stage's `h2` keeps `--t-subhead` (20px), a `.rail
.panel > h2` takes `--t-heading` (18px), because the rail is what you look at
*while* reading the middle (§6) and a companion column speaks one step down. No
new size: `--t-heading` is the `h3` step this product already had.

**A label's leading is not a paragraph's leading.** Body copy ran 14px/19.6px —
1.40 — over five- and seven-line teaching paragraphs. That is a control's
rhythm applied to the app's main teaching surface, and it is what made Settings
and the shared-space explainer read as documentation dumped into a card.
`--lh-body` is 1.6 and `p` carries it by default; labels, buttons and dense
rows keep 1.4.

**One size per element, in every state.** A status is a status channel — the
word, `--tone`, the badge — never a jump in the type scale.

**A dense row keeps ONE size**, and that survives this pass: `.agent-row h3` and
`.agent-status` are both `--t-label`. A board row is scanned as a row, not read
as a heading over a caption.

```css
--w-normal: 400;  --w-medium: 500;  --w-strong: 600;
```

**Three weights means `strong` is pinned (R6-14).** The UA style for `<strong>`
is `font-weight: bolder`, which is *relative*: CSS's bolder table maps an
inherited 600 to **900**, so `<strong>main</strong>` inside the selected agent
tab was the only 900 in a product whose ramp stops at 600, and the same tag
inside a 400 paragraph landed on 700. Two weights outside the ramp, from a tag
nobody wrote a rule for. `base.css` gives `strong, b` `--w-strong` and the
census is back to three: measured over rendered leaves on the Dashboard,
**400×125 · 500×18 · 600×76, and nothing else.**

**On glass, add weight and contrast.** Text on any `.e1`/`.e2`/`.e3` surface is
`--w-medium` minimum (never 400) and must measure **4.5:1 against the rendered
backdrop at the lightest lobe**, not against the fill colour.

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
| E1 chrome (header, nav, rail) | `--s-3` (12), all widths | `--s-3` |
| E2 card (`.panel`) | `--s-4` (16); `--s-5` (24) block / `--s-6` (32) inline at ≥1024 | `--s-3` |
| E2 dense row (agent row, tool call, terminal run) | `--s-3` | `--s-2` |
| E3 floating | `--s-5` at ≤768, `--s-6` (32) above | `--s-4` |

**The E1 row said `--s-4`/`--s-5` and the code has always shipped `--s-3`, and
the code is right.** E1 chrome in this product is not a content surface: it is a
container of `.panel`s that already pad themselves 24/32, so the specified 24
would have put 56px between the rail's edge and its first word on a 374px rail.
The rule the table was reaching for is that padding accumulates — the *outermost*
surface holding text pays the card figure, and a frame around padded cards pays
one step.

The same rule is why an `EmptyState` has `padding: var(--s-4) 0` and not
`var(--s-4)`: it is always the sole child of a panel that has already paid the
inline padding, and paying it twice put the empty state's glyph and title 16px
to the right of its own panel's title, in all five panels that have one.
`#terminal` and `.term-run` were the other place this drifted — they ran at
`--s-2` while `.chat-log` and `.tool-call` ran at `--s-3`, so the rail changed
rhythm between the Tools panel and the Workspace panel directly beneath it. Both
are `--s-3` now.

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

**The horizontal system (R6-LAYOUT).** Measured inside a single card at 1440
there were **three content widths — prose 544, textarea 960, panel 1136** — and
about 40% of every panel was empty on the right, on every view. The Dashboard
read as a narrow column of text floating in a very wide box, and the right-hand
void was exactly where the running state and the ending of a run should have
gone. Two rules fix it, and neither of them is "make everything narrower":

1. **A panel's width is for a READING COLUMN plus a COMPANION.** The reading
   column is `--measure` and holds everything a person reads *or types* —
   which is why `.grows` (the task field and the composer) is capped there too;
   a card whose prose is 544 and whose input is 960 has two rhythms. The
   companion takes what is left and holds what you look at *while* reading.
2. **The gutter is `--s-6`, the same step the card pays inside its own edge.**
   One value sets the space between two columns and the space around one, so
   `--column: calc(var(--measure) + 2 * var(--s-6))` is the width of the
   surface that holds a reading column. `--column` sizes a card in a deck;
   `--measure` sizes a split *inside* a card whose padding is already paid.

Expressed as two classes in `layout.css`, `.dash-grid` and `.split`, switched
by a **container query** on `.view-panel` and not a media query: folding the
side panel hands 374px to the centre without the window moving, and a media
query would have left a one-column card standing in a 1136px stage. Below the
threshold there is one track and the companion falls under the column in DOM
order.

3. **The companion is CLAMPED, and the surplus is gutter (R7-5).** The first
   version left the second track at `1fr`, so every pixel the folded sidebar
   handed back went to the SECONDARY column: at 1440 with the nav hidden the
   reading column stayed 608 while the agent board grew to **704 — 16% wider
   than "Run a task", the primary action on the page**. A pair of columns has
   a `max-width` of `2 × reading + gutter`, so the companion may equal the
   reading column and can never beat it. Measured after: nav shown 608 / 496,
   nav hidden 608 / 608 with 128px returned to the right gutter.
4. **It stacks before it squeezes (R7-17).** The threshold was 60rem of stage,
   which put the companion's floor at 322px — and at 1100 it measured 364,
   with `TOOL TRACE · RESEARCHER` and the board rows each wrapping to two
   lines, for a whole 100px band before the stack ever came. The threshold is
   **66rem**, which is `--column` + the gutter + **26rem** — and 26rem is
   `.rail`'s own maximum, this product's existing answer to how wide a
   permanent companion has to be. Measured at the floor (416px): every board
   row back on one line. One residual, stated rather than hidden: the board's
   own `h2`, *Agents and what they are doing*, needs 470px and still takes two
   lines in the 416–470 band. The fix for that is the heading, not the grid.

**Two more shapes, so that the system covers every view (R7-6b).** A container
query that fires on four views out of six is a suggestion, not a system:
`#/agents` stood every card at 1136px round a 544px text column — 592px of
dead space each, repeated down a long page — and Settings' Appearance card did
the same round 494px of text with an empty right half.

5. **`.card-deck` — a LIST of cards is not a reading column with a companion.**
   It is a deck: each card capped at `--column`, `repeat(auto-fit, minmax(min(
   100%, 24rem), 1fr))` across. The track's max is `1fr` and not `--column`
   because `auto-fit` counts repetitions off a *definite* max and resolved to
   one 606px track in a 1072px panel. Measured after: the roster is 2×2 at
   1440, cards 529 wide holding 503 of prose.
6. **`.panel.reading` — a card that holds ONLY a reading column stops at one.**
   Appearance has nothing to put beside itself, so it is `--column` wide and
   looks like a card sized to its content rather than a wide card with a hole
   in it. Measured after: 608.

What it is used for today. The Dashboard's launcher is the reading column and
the agent board is the companion beside it — **which supersedes R3-20's "it
takes the row"**. The Settings form is a reading column with the endpoint's
health and the trust note beside it (544 / 494). The Agents view takes the same
shape: the roster is a deck above, and the editor — which is what that view is
*for* — is the reading column with the task launcher as its companion (608 /
496). Measured after: the launcher card 606 with prose 542, and no third width
in any card.

**Grid.** Unchanged from increment 13, because it is measured and correct:

```
≥1100px:  grid-template-columns: auto minmax(0,1fr) auto;
          .nav → col 1   .stage → col 2   .rail → col 3
          max-width: 96rem; margin-inline: auto;
<1100px:  single column, both panels default closed
```

Breakpoints: **320, 375, 768, 1024, 1100, 1440, 1920.** 1100 is the dashboard
fold threshold and is load-bearing; the others are test widths.

**The header collapses by PRIORITY, and it never cuts (R5-7, R6-4).** R5-7
deleted a 2rem `mask-image` and put a sideways **scrollport** in its place with
`scrollbar-width: none`, and that is the same picture: at 390 a 213px port over
725px of content ended mid-word (`Agent: summari`), at 800 one letter of the
model line sat behind the side panel's switch, and at 1440 with the failure
banner up the meter read `Tokens, tin` and the model line read `This`. A shorn
glyph with no scrollbar does not degrade, it breaks.

So **nothing scrolls and nothing clips: the strip drops items WHOLE, lowest
priority first.** The DOM order is the priority order and `chrome.css` takes it
from the bottom:

```
model line → tokens → sandbox → running → agent
```

**This replaces R4-15's "re-arrange, never delete".** That rule was written
against a header that deleted facts to fit, with nothing saying which; ordering
is not deletion, and each dropped item is still reachable — the model line is
the Settings card's whole subject, the sandbox state the Workspace view's, the
spend a fold of a log that is not going anywhere. **The agent never drops:**
every "run this" on the page is addressed to it. **The wordmark does**, below
30rem: it is the only thing in that bar which is not news, and the page's own
`<h1>` carries identity.

**A dropped fact has somewhere to go, and two facts never drop at all
(R7-12).** The order above was a priority order with no destination: below
~1000px the sandbox pill, the token meter and the endpoint pill were all
`display: none`, so on a phone you could not find out whether the Linux was
ready, which model you were calling, or what you had spent. Two changes.
**The sandbox state is kept at every width** — it is the single most
load-bearing status in the product, because it decides whether the agent can
do anything at all — by SHRINKING rather than dropping: the subject and the
noun are a `.pill-label` that goes at 48rem and the state word stays, so a
phone reads `● ready` (measured: 242px at 1440, 77px at 390). It moves up the
order accordingly, and the order is now
`model line → tokens → running → sandbox → agent` (the failure left the strip
entirely in R8-2, below). And the two that
still drop are **written out in prose at the foot of the nav** — `StatusFold`,
a `<details>` the header's first control reaches at every width.

**And the pills' explanations are not mouse-only (R7-13).** They carried real
teaching text in a `title` on elements that were not in the tab order — 22 tab
stops, not one of them a pill — so keyboard and screen-reader users got the
number and never the meaning. The same fold carries those sentences as visible
prose behind a `<summary>`, which is a 44px target and *is* in the tab order
(measured: tab stop 9 of 23). The `title` stays for the pointer. One trade
stated: in the ≥1100 grid the nav is 13rem, so the open fold's prose runs
~182px; at the widths where it carries a dropped fact the nav is a full-width
drawer and it runs 340px, which is where it has to read well.

**Exactly one item shrinks rather than dropping — the endpoint pill — and it
carries a real `text-overflow: ellipsis`.**

**AND IT NEVER DROPS AT ALL NOW (R11-10).** `header .chat-endpoint { display:
none }` below 75rem meant that at 800 and at 390 no line on the page named the
model or the address the next turn was about to spend tokens against — *"on a
phone you can spend tokens against an endpoint you were never shown"*. The pill
takes the shape the workspace pill already has: `.pill-label` (`The next turn
calls local — `) and `.pill-tail` (` at http://…, with no key.`) drop at 75rem,
`.pill-short` (`calls `) takes their place, and `.pill-subject` — **the model
id** — never leaves and only ellipsises. The priority order loses its first
item: it is now **wordmark → spend → nothing**, and the spend still has
`StatusFold` to go to. Three widths moved with it: the strip WRAPS rather than
clipping below 64rem (a sixth item in the bar costs a row of height, never a
shorn glyph), and both the workspace pill's shrink and the wordmark's exit move
from 48rem to 64rem so the band where things give way is one band and not three.
Measured after: header 70px at 1024 and above, 109 at 800, 153 at 390 — against
70 / 70 / 105 before, which is the price of never hiding the model id again.

**THE FAILURE IS NOT IN THAT ORDER ANY MORE (R8-2).** It was a pill in the
strip, ~400px with two controls in it, and it could only fit by evicting its
neighbours — the model line first, then the spend. That is the priority order
applied to the one state where it is wrong: a person told *the endpoint was
unreachable* then had no line on the page naming WHICH endpoint, and none
naming what had been spent reaching for it. **An error state may add a row; it
may never subtract a fact.** The banner is a sibling of `<header>` now
(`.banner.problem`, `main.rs`), the full width of the page, wrapping rather
than ellipsising, capped at `30vh` so a long reason cannot eat a phone screen.
Every `:has(.problem)` eviction rule is deleted. Measured at 1440 with the
banner up: header 70px, banner 60px, `The next turn calls local — …:8873/v1`
and `Tokens, every agent 8,436` both on screen (both strings were renamed in
R8-8 and R8-9; the measurement is unchanged).

**Two rows at 30rem, banner or no banner (R8-1).** The two switches take 252 of
a 366px bar, which left the strip 71px: `Agent: main` was painted from x=152 and
clipped at 224, with the side-panel switch starting at 232 — the name and a
control in the same eight pixels. Nothing in that bar can be given up (the
sandbox and the agent never drop), so the strip takes the row under the
switches, by `order` and not by DOM order, so the tab order is unchanged.
Measured after, at 390: header 105.6px with and without a banner, `Agent: main`
whole at x=25..128 on its own row, the side-panel switch at x=232..365 on the
row above.

**A drawer does not survive a resize (R11-11).** `follow_width` lets the width
lead until the person presses a switch and resets that on crossing 1100, which
is right for a COLUMN. Below 1100 the nav is not a column, it is an overlay on
top of the page: opening it at 390 and dragging out to 800 left it covering
`Run a task · main` whole, with `✕ Close` the only way to reach anything.
Choosing to cover *this* viewport is not choosing to cover the next one, so the
sheet closes on any real width change, ahead of the `chosen` guard — and only on
a real WIDTH change, because a mobile browser fires `resize` every time its URL
bar slides.

**The nav drawer is a drawer (R5-8).** Below 1100 the nav is a sheet over the
page. It had E1's hairline and nothing else: no scrim, no close control, no
dismiss on outside tap (Escape worked), so at 390px it began around y=480
through the middle of a task card and read as a rendering fault. It now carries
`--e3-shadow` — it is the one thing in the product that genuinely floats over
its own app, which is what §4's E3 shadow is for — over a `.nav-scrim` at
`--e3-scrim` that dismisses on click, with a `Close` control in the sheet. Both
the scrim and the close are `display: none` at ≥1100, so no Rust knows the
width: the rule that makes the sheet is the rule that turns them on. This is
also the first RENDERED use of `--e3-scrim`; §4 and §8 recorded it as defined
and unused.

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

**Hard cap 380ms on any transition or entrance.** An idle loop that communicates
"this region has not answered yet" is not an entrance and is exempt — there is
exactly one, `askk-shimmer` at 1.4s on `.skeleton` (§8), and §8 has always
specified it at that duration while this section forbade it. §8 wins; §7 is
corrected.

What animates: background-color, border-color, box-shadow, opacity, transform.
**What never animates: `backdrop-filter`, `filter`, `width`, `height`, `top`,
`left`.** Animating a blur radius re-runs the whole composite every frame and is
the fastest way to drop this UI to 20fps.

**The four state loops this section said were "kept" do not exist.**
`askk-pulse`, `askk-travel`, `askk-breathe` and `askk-arrive` were in the old
stylesheet and did not survive the seven-file rewrite; `askk-shimmer` is the only
`@keyframes` in `web/`. The document has been claiming four animations the page
has never run since the rewrite, which is worse than having none, because a
critic reading it looks for motion that is not there and concludes the page is
broken. If they come back, each must be bound to a fact in the event log rather
than to decoration — that part of the old paragraph was right and is why
`askk-scan` was deleted.

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

**And the guard measures the states the pointer puts things in (R11-6).** A
transition is why it could not before: `getComputedStyle` reports the value a
transition is CURRENTLY at, so a fill read in the same frame the state is
applied answers with the OLD colour. `layout-audit.js` disables transitions
while it measures, copies every `:hover` / `:active` rule with the pseudo-class
rewritten to a real class of the same specificity, and lets the browser's own
cascade answer. `check-layout.sh` inlines the built stylesheets rather than
`<link>`ing them, because a `file://` stylesheet is opaque to CSSOM.

---

## 8. Components

One implementation each. A screen that hand-rolls one of these is not done.

**What is built, and what is only specified.** This section used to read as a
manifest of things that exist. Six of them do not, and a source of truth that
lists unbuilt work beside shipped work is a source of truth for nothing:

| Component | State |
|---|---|
| Card, Button, Focus ring, Input/Textarea/Select, Tab, Message, Disclosure, EmptyState, Skeleton, Header, Nav, Rail | shipped, one implementation each, all rendered in `#design-system` |
| Badge | **built, zero call sites.** `crates/ui/src/ui/badge.rs` exists and only the gallery renders it; the board says a status in prose with a `--tone` left edge instead |
| Stage head, Toggle | shipped (R5-6, R5-16); specified below |
| Toast · Modal / Sheet | **not built.** No component, no CSS, no specimen. Nothing in the product currently interrupts or floats, which is why `.e3`, `.scrim`, `--e3-scrim` and `--e3-dim` have no instance |
| Footer | **not built, and no longer half-styled.** `chrome.css` used to carry 17 lines against no element; they are DELETED. A stylesheet that dresses an element nobody renders is a second product nobody is looking at. Part **E** of `checklist.md` writes them against a real element when it starts |
| Button size `sm` (36px) | **not built,** and should stay that way — every control in the product clears the 44px floor, and the one exception this document carved out (`.wait-clock button`) turned out to be the sole enabled target mid-turn |
| Header scroll shadow | **not built.** `header` carries `transition: box-shadow` and no rule ever changes it |

An integrator does not invent a toast, a modal, a footer's build id or a scroll
threshold — those are values this file does not carry. They are named here so
the next builder picks them up as work rather than assuming they shipped.

### Surface / Card
Anatomy: `<section class="panel">` → optional `<h2>` (a caption eyebrow, §5) →
children. Variants: `e1` (chrome) · `e2` (default) · `e3` (floating) ·
`flat` (opaque `--surface-1` at `--e2-radius`, for anything holding body text —
**G3**). The class is `panel`, not `card`, and there is no `.card-title` or
`.card-body`: the layout guard and six stylesheet rules key off `panel`, and
renaming a region was never what this run was doing.

`flat` needed `.panel .flat` to hold it. `.panel .panel` — the N3 rule that
turns a card inside a card into a `--surface-2` row — is (0,2,0) and beat
`.flat` at (0,1,0), so the gallery's one specimen of the `flat` variant
rendered as a row, at the wrong fill and the wrong radius. The one artifact
whose job is to catch drift was the drift.
States: default · `[data-status]` tint via `--tone` · `[hidden]`.
Tokens: `--e{n}-*`, `--r-md`, `--s-4`, `--t-heading`.

### Button
Anatomy: `<button class="btn">` with optional leading glyph span.
Variants: `primary` (accent fill, `--accent-ink` text) · `secondary` (glass fill
+ `--control` border) · `ghost` (no fill, `--control` border) · `danger`.
Sizes: `md` (44px) — the only one. See the table at the top of this section.
States — **all five defined, non-negotiable**: default · hover (fill +4% alpha,
`--dur-fast`) · `:focus-visible` (see below) · `:active` (`transform: scale(0.98)`,
fill +7%) · `:disabled` (`opacity: 0.55`, `cursor: not-allowed`, no hover).
Minimum target 44×44 including padding.

**Every button in the product carries its variant class (R7-10).** `None`
painting as a primary is a convenience for the gallery, not a licence: `Send
the message again` — the one control on the page a person reaches for when a
turn has just failed — carried no class at all, so `controls.css`'s bare
`button` fill painted it `rgb(201,164,255)` on `rgb(26,15,43)` while every
other primary is `btn-primary` at `rgba(201,164,255,0.886)` on
`rgb(39,28,57)`. Near-identical, measurably different, and the only drift a
critic hunting for drift could find in the whole product. It is
`variant: "primary"` now.

**An arm states its cost ABOVE the buttons, and counts it (R11-7).** The engine
card's confirm read `Yes — reload and lose that` / `Cancel`, with the only
explanation BELOW both — *"container2wasm keeps its filesystem in memory, so
this reload deletes every file in the workspace and stops anything running in
it"* — so the reader met a pronoun before its antecedent, and the sentence would
not say what the app already knew: one running process (`ticker`) and three
files. The consequence comes first, it is COUNTED off the projections the
Workspace view already reads, and the button names the loss
(`Yes — reload and delete 3 files and stop 1 process`).

**And the arm protects the state that has something to lose, not the state you
are moving to (R11-8).** The gate was `chosen().keeps_files()` — the engine the
page is about to run — so switching TO container2wasm confirmed and switching
AWAY from it reloaded on one press, which is precisely the reload that destroys
an in-memory filesystem. What a reload costs is a fact about the engine
**running now**.

**A destructive action is `danger` AND it arms (R6-5).** Settings' "Reset every
endpoint to the shipped list" deletes every saved key and every address override
in this browser; it was a `btn-secondary` peer of "Save this endpoint", at the
same height, one press away, and it reported the loss *afterwards* — while the
Agents editor two views over already painted its Delete `btn-danger`. Both
halves are the rule now: the `danger` variant, and a **two-press arm** whose
label says which press you are about to make (`Yes — reset every endpoint`) with
the consequence stated **before** it happens, on its own row under the button.
Anything that destroys stored state owes both.

**An arm owes a visible retreat, and a status region holds one message
(R8-16).** Armed, it stayed armed: the only stated way back was *"leave this
card"*, which is not a control, and the red warning appeared directly under
whatever the last save had said — `Saved. The next turn calls…` reading as the
first line of a destructive warning. So the arm renders its own `Cancel`, and
arming clears the pane's status line.

### Focus ring — the one that survives glass
A single `outline` disappears into a translucent surface. Every focusable
element gets a two-tone ring:
```css
:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--focus-halo);   /* dark halo under the ring */
}
--focus-halo: rgba(11, 6, 17, 0.85);
```
The dark halo is what keeps the ring visible over the lit lobe. It is a token
and it does not get dropped for aesthetics.

**AND IT IS NOT `--accent` (R8-12).** The ring was purple, and purple is what
SELECTION is made of in this design — the nav's left bar, the strip's edge, the
selected fill. A rounded purple outline on a nav item was, at a glance, the same
claim as the purple bar on the item beside it, so a keyboard user walking the
list could not tell where they *are* from what is *chosen*. Two states cannot
share one hue. `--ink` is the brightest value in the palette, it carries no
other state anywhere, and over the halo it clears 1.4.11 on every surface in
both skins.

### Input / Textarea / Select
Anatomy: `<label class="field-label">` + control. Variants: `text` · `multiline`
· `select` · `mono` (agent editor, shell). States: default · hover · focus ·
invalid (`--danger` border + a message, never colour alone) · disabled ·
readonly. Fill `--surface-1` (opaque — it holds typed text, G3). Border
`--control`. Min height 44px. Placeholder `--ink-3` and never the only label.

### Tab
Anatomy: `<button role="tab">` in a `role="tablist"`.
States: default · hover · `:focus-visible` · `aria-selected="true"` · disabled.
Roving tabindex, Arrow Up/Down and Left/Right both move — already implemented in
`tabs.rs`, kept.

**ONE SELECTION LANGUAGE, AND THE NAV IS THE OTHER HALF OF IT (R8-12).**
Selection is three things and the same three in both lists: an `--accent` edge
3px (left for the nav's column, bottom for the strip's row), `--surface-2` fill,
`--w-strong`. Nothing else. The tab used to add `border-color: --accent` on top,
so two lists forty pixels apart said "this one" two different ways and one of
them spent the accent on a boundary — the channel `--control` owns everywhere
else. A control's border is not a state.

### Process row
Anatomy: `<div class="proc-row" data-state>` → a full-width `<button
class="file-entry proc-open">` (name · machine line · command) → `Stop`, when it
is running. Pressing the row opens that process's log in the Files pane above;
there is no second editor in the view.

**It looks pressable, and the states do not look alike (R11-12, R11).** The row
was drawn as plain text with a 3px edge, and the only thing saying it could be
pressed was a sentence inside a collapsed fold; it carries a `--surface-1` fill
and a `--control` boundary now, like everything else on this page that can be
pressed. And `STOPPED` and `GONE` were the same grey caption in the same weight:
`stopped` is a thing you chose, `gone` is work a reload destroyed, and the more
alarming state may not be the quieter-looking one. `gone` takes `--warning` on
its edge and its meta line, plus a `⚠` mark, because colour is never the only
channel (§8, Badge).

**And the log it opens is READ-ONLY.** It is a machine record — captured output
of something that may still be printing into it — and it opened in a live
`<textarea>` under `Save to the workspace`, so a keystroke and a press
overwrote a running process's own record. `fileedit::is_record` decides;
`Editing` becomes `Reading` and the Save row becomes a sentence.

### Badge / StatusDot
Anatomy: `<span class="badge" data-status>`; dot + label, **never dot alone**.
Variants map to `--tone`: idle · starting · waiting · working · failed · closed.
The label is the primary channel; colour and motion are secondary. This is an
existing invariant from increment 06's walk and it holds.

### Message
Anatomy: `.msg` → `.speaker` (who, in words) → `.said`.
Five class variants — user · assistant · tool · pending · error — and **THREE
TREATMENTS (R8-14)**, because there are three kinds of row and not five:

| kind | classes | treatment |
|---|---|---|
| speech | `user`, `assistant` | `--surface-2` fill; yours adds the `--accent` left edge |
| machinery | `tool`, `pending` | no fill, dotted edge, `--ink-2`, **the same size as speech** |
| failure | `error` | 2px `--danger` edge, `⚠ Error` in words |

Five consecutive rows used to carry five boxes: a filled `you` with an accent
bar, a tool line unfilled at `--t-caption` with a stray rule, a filled answer
with no bar, a system note italic inside a dashed border **with no speaker at
all**, and an error in red. A reader had to learn five things to read one
column. 11px and italic were extra signals doing the job `--ink-2` already does,
so they are gone; opaque still holds (`.msg` is in glass.css's flat list) and it
is still the longest text in the product.

**Every row is labelled.** `core::failure::compaction_failed` was the one that
was not — the page's own aside, unattributed, in a column where everything else
says who is talking. It wears `Note:` (`fold::NOTICE`) like the rest.

**`error` carries no `.speaker` and no `.said`** — a `<p>` directly, so the card
inherits `--danger` rather than having `.said` repaint it `--ink`. It is the
harness talking, and naming an agent as the speaker of "the endpoint could not
be reached" attributes the failure to it.

### Disclosure
Anatomy: `<details class="disclose"><summary>` — summary is a 44px target with a
rotating chevron (`--dur-fast`). One implementation replaces the four hand-rolled
`details` blocks. **A summary is Inter, always (R6-14):** the workspace note's
carried `.space-path`, which is `--mono`, and was the one monospace `<summary>`
among thirteen — a path *value* is machine text, a control's label is not.

### One product, one voice about loss (R11-9)
On container2wasm the Files pane said *"There is nothing in `.` yet — nothing
has written to it"* two inches above Processes' *"pulse_logger and ticker were
started here, and nothing is left of them"* — and Files had held `pulse.log` and
`tick.log` moments earlier. A pane that HELD the thing says so, in the words the
pane beside it already uses: `filegone::empty_said` reports what was written and
that the reload took it, gated on `!ctx.durable` **and** on the write having
happened before `ctx.booted` — the same test `scrollrows` uses for an answer
that describes a Linux since rebuilt, and the only condition under which "the
reload took it" is a claim this projection can make.

And **`.` never reaches user copy**: it is the shell's name for the folder a
command starts in, it was the one piece of raw shell left in the product's
sentences, and the pane knows what it is browsing — `the workspace folder`.

### Machine output — one component, one rendering rule (R6-9)
`.tool-call pre` set `white-space: pre` while `base.css` gives every other `pre`
`pre-wrap`, so the **same** Tool trace wrapped cleanly in the stage and was
shorn at the edge in the 254px rail (clientWidth 254 against scrollWidth 454)
behind an overlay scrollbar nobody sees until they are already scrolling. The
override is deleted: a tool result wraps, in both places. The exception is a
**shell row** — `.term-run pre` in `workspace.css` — where the columns of
`ls -la` are the content and the block scrolls sideways instead. Two components,
two rules, stated; not one component with two.

### EmptyState
Anatomy: one-line title (`--t-heading`) → **one** sentence (`--t-body`,
`--ink-2`) → one primary action, at `padding: var(--s-4) 0` (§6).

**AND AN EMPTY PANEL CARRIES NO DISCLOSURE (R11).** A cold Workspace rail stood
three cards deep — Files, Processes, Artifacts — each with a heading, an empty
state and a `<details>`, about 700 vertical pixels saying *"nothing has happened
yet"* three different ways. *"The empty-state writing is excellent; there is
simply too much of it at once."* The empty state's one sentence says what the
region is for; the fold explains a mechanism, and a mechanism is worth reading
once there is something on screen to read it against. So `Processes`,
`Artifacts` and `ToolTrace` render their disclosure only when they have rows.
**Never a bare "No data".** Every list region (chat, board, tools, terminal,
space) gets one.

**NO GLYPH (R8-18).** It used to open on one — `◈ ✉ ▮ ⚙ ▤ ◇`, one per panel, at
`--t-display` in Inter. Six characters from six unrelated Unicode blocks, at
32px, with six different optical weights and baselines, standing in for an icon
set nobody drew, in the exact spot the eye lands first on a panel that has
nothing to say. Drawing a real set is six inline SVGs to maintain for decoration
the headline already carries; the cheaper and better answer was to delete the
row. The `.empty-glyph` rule is gone with the prop.

**ONE SENTENCE, NOT A PARAGRAPH (R8-EMPTY).** These reached sixty words, and the
shared space's repeated its own disclosure — *"How the shared space is read and
written"*, four lines below it — almost verbatim. This is the place with the
least to say and it held the longest prose in the product. The sentence says
what the region is for; the panel's disclosure, which every one of these panels
already has, says how it works.

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
E1, full width, one row at every state. Anatomy: the views toggle · one
`.status-strip` of pills in PRIORITY order (§6) · `.switches`. On scroll it
gains `--e1-shadow` and nothing else — no height change, no content swap.

### Stage head
One band at the top of `.stage`, above whatever view is routed. Anatomy: a
`--t-caption` eyebrow naming the view, then the agent strip when the view is
agent-scoped (`View::scoped`).

It exists because of two findings that turned out to be one. The agent strip
was on the Dashboard and Chat only, while Workspace and Tool trace titled
themselves `· MAIN` with no way on those screens to change which agent that
was (R5-6); and six views named themselves while Tool trace did not, so a
heading that appears on six screens and not the seventh reads as a missing
element rather than as a style (R5-misc). Both are "the stage needs a head".

**One instance, the existing component.** `tabs::AgentTabs` is unchanged;
`stage.rs` renders it once and `View::picker` supplies the `aria-controls` and
the accessible name per view, because one accessible name for five different
jobs is R4-10's mistake five-way. A second picker, or a second copy of this
one, would put two elements with every `tab-{name}` id in the document.

### Toggle
A `<button aria-pressed>` with a switch track drawn by `::after`: the knob is
on the side the state is on, the track takes `--accent` when pressed, and a
`--ink-2` state word sits beside it. The label is a stable noun.

`Plain background: off` was a full-width, centre-aligned button whose entire
visible state was its own label — a noun phrase that changes meaning as you
press it, in a shape no other control in the product has, over an
`aria-pressed` that was correct underneath and carried none of it to anyone
looking (R5-16). **A control's state belongs beside it, never inside its
label**, and the same rule fixed the workspace editor's Save (R5-15), which at
rest read `Saved` and was disabled — a primary action whose label was a
condition, on the one control in the product that overwrites a real file.
Buttons are verbs.

### Nav (left) / Rail (right)
E1 columns. Fold via the `hidden` attribute, which works in both skins because
`[hidden] { display: none !important }` lives in the un-gated layer. Each has a
labelled toggle in the header with `aria-expanded` / `aria-controls`.

### Footer
Currently absent, and now absent from the stylesheet too. When built: one E1
strip inside the stage — build id, deploy sha, isolation state, a link to the
source. Three items, one row, `--t-caption`, `--ink-2`. A status line, not a
link dump.

### `#design-system`
Every **built** component above, in every variant and every state, over the real
ground, with a skin toggle and a "kill backdrop-filter" toggle so the fallback is
inspectable side by side. Critics open this first.

**It is a region, not a route, and calling it one misled every critic who tried
to open it.** The app has no URL router — it routes by the `hidden` attribute
between regions — so this is a fourth stage surface toggled by the header's
"Design system" switch, rendered *below* whatever else the stage is showing, and
`gallery::wanted()` reads `#design-system` from the hash **once, at boot**.
Appending the hash to an already-loaded page does nothing; a critic has to load
it with the hash, or press the switch. That is the shipped mechanism and it is
fine; the word "route" was the defect.

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
7. Frame time bounded while scrolling a long chat log. (There is no modal to
   open — §8.)
8. Every target ≥ 44×44 with all five states; focus ring visible on every surface.
9. Full keyboard traversal, sane order, no traps, nothing mouse-only.
10. **Token count down**: ≤6 font sizes (§5 — raised from 5 in R5-A, once, in
    writing), ≤8 spacing values, 0 roles with two values, 0 (selector,
    property) pairs in two files (G1), 0 skin-gated rules (G2).
13. **The ramp is USED.** Counted over rendered leaf nodes, no single size may
    hold the overwhelming majority of the text on a screen, prose sits on
    `--t-body` at `--lh-body`, and `--t-caption` is never a single orphan
    instance. `layout-audit.js` prints `INFO SIZES` for exactly this.
11. `cargo test`, `scripts/check-layering.py`, `scripts/check-size.py`,
    `scripts/check-layout.sh` green.
12. A fresh agent shown a screen cold says what it is for within five seconds.

---

## 11. Naming, actors and history — three rules the LOOK depends on

Three findings in R6 were not about pixels and are here because a critic reading
the screen cannot tell the difference.

**One relationship, one wording (R6-12).** The selected agent was `Agent: author`
in the header, `RUN A TASK · AUTHOR` on a card, `CHAT WITH AUTHOR` on another,
and *"Chat is pointed at author"* in the editor: four phrasings for one fact, so
a reader has to work out each time whether they name the same thing. **The header
names the concept once (`Agent: {name}`) and every agent-scoped card wears the
dot** — `Run a task · main`, `Chat · main`, `Tool trace · main`,
`Shared space · main`, `workspace files · main`. Prose refers to it as *the page
is pointed at {name}*.

**A region is named for what is IN it (R8-7).** The rail wore `Side panel · main`
and the header's switch said `Hide side panel` — a region named after itself,
which tells a reader nothing they cannot already see, and the fourth name one
place had: the nav says `Workspace`, the centre card says `Commands`, the rail
card says `Files`, and the rail said `Side panel`. The place is the **Workspace**
and its halves are **Commands** and **Files**; the rail says what it is holding
(`View::rail_noun` — `workspace files`, `agent activity`) on both the heading and
the switch, from one string.

**One event, one name (R8-8).** A failed turn was `main's last turn failed` in
the header, `failed` on the board row and `main could not finish` on the launch
card. The board row's word is the one the projection writes, so it is the one
that survives: the card reads `main's turn failed`. The same rule settled two
more pairs — the header said `This turn calls …` for a turn nobody had started
while the save confirmation said `The next turn calls …` about the identical
fact (both say *the next turn* now), and Settings claimed Chrome 142+ **blocks**
a page from calling a local address while the chat failure said it **asks
permission**. Local Network Access ships as a permission; a block is what a
denial produces. Both places say the permission. And the editor's `Folder name` is now `Agent name — what you
will call it everywhere else`: the field held an identity and was labelled after
the storage under it, with a placeholder that looked exactly like a roster name.

**`you` means the person (R6-10).** The trace's `you` / `{agent}` split is the
one channel answering "who did this", and rows read `you ran list_files path=.`
for listings the Workspace file pane made on mount and after every status
change. A pane's housekeeping is not a gesture, so it has **its own actor name,
`the file pane`**. A typed shell command and a pressed Save are still `you`; the
read-back a save triggers is the pane's.

**History stays true after new events land (R6-11).** The note explaining an
abandoned turn was rendered as the transcript's *tail*, so it was kept only for
the most recent turn: send one more message and it vanished, leaving an orphaned
`YOU:` in the log for ever with no reply and no reason. A turn is abandoned the
moment a later one starts over it, and that never stops being true, so the note
is written **at that point in the log** (`fold::abandoned`). A projection that
only explains its own last row un-explains itself.

**One concept, one name; one destination, one label (R7-7).** Three phrasings
for one idea — `Shipped in this deploy` on an agent card, *"shipped with this
site"* in a system-prompt disclosure, *"the shipped list"* on Settings' reset —
are now all **shipped with this site**, and "deploy" leaves the product: it is
a word for the person who published the page, not for the person reading it.
The failure banner's `Check Settings` and the failed turn's `Open Settings` go
to the same place and are now both **Open Settings**. And the Workspace was
three things with one name — `Workspace` in the nav, `Workspace terminal` as a
heading, `Workspace files` in the companion — *and it is not a terminal*: the
VIEW is **Workspace**, and its two halves are **Commands · {agent}** and
**Files**. `written here` is glossed where it is explained rather than where it
is stamped: the Agents card's own sentence says *written here means you saved
it in this browser, and the rest are shipped with this site*.

**And the first interactive label is not inverted (R7-BOOT).** The boot screen
rendered `☰ Hide views` while no views were on the page: `nav_open` starts at
the width's default and the nav itself waits for the core, so the switch
described the state it would be in rather than the one it was. It is gated on
the same `ready` binding the nav is, which is the R6-BOOT rule below applied to
a control rather than a status — a switch for a region that is not on the page
is R2-12's defect wearing a menu. The two background glows are *not* part of
this finding any more: since R5-C the glow is opt-in and `data-skin="plain"` is
what a fresh browser carries, so the boot screen is the plain ground and the
lock-screen reading does not reproduce (verified with storage cleared).

**And the first sentence is not jargon (R6-BOOT).** `booting the core…` — "the
core" is a word out of this repository's architecture doc. It is *"Starting up —
reading the agents and the history this browser has stored."* now. In the same
finding: the header rendered `Agent: main` and a sandbox state **while the core
was still booting**, asserting two things it could not know — it had not read
the roster, so it did not know `main` was on it, and it had not read that
agent's file, so it did not know whether it has a workspace at all. At 138ms
nobody catches it; a cold CheerpX boot holds it for seconds. **A status the app
does not have yet is not rendered.** The wordmark is the one thing true before
anything loads, and the wordmark is what shows.

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
- **2026-08-12, integration pass** — one agent who built none of this walked
  every screen on the deployed page and reconciled this file with it. Six
  inconsistencies fixed in code: `.panel` bordered with `--divider`, which is
  1.2:1 in the plain skin where it is the only boundary (now `--e2-line`); the
  gallery's `flat` specimen losing to `.panel .panel` and documenting the wrong
  fill and radius; the gallery's `.msg.error` carrying a speaker and `--ink`
  where the app's carries neither and `--danger`; `.wait-clock button` at
  `--t-caption`, alone among buttons and on uppercase-only type; `.agent-row h3`
  jumping to `--t-heading` on `data-status="working"`; and `.empty`,
  `#terminal`, `.term-run` each paying a padding step out of rhythm with the
  region around them. Ten corrections to this document, every one of them a case
  of the file being wrong and the code being right: the ground field's beam
  placement (still at the third pass's coordinates here, moved in `tokens.css`
  two critiques ago), `--hairline-lit` 0.18→0.30, `--e*-border`→`--e*-line` (a
  colour, not a shorthand), `--e*-shadow: none`→`0 0 0 0 transparent` (`none` in
  a `box-shadow` list is invalid and drops the top-edge light with it), §2's file
  order, panel titles being caption eyebrows rather than headings, E1 chrome
  padding `--s-3` rather than `--s-4`/`--s-5`, the four state loops §7 claimed
  were "kept" and which no longer exist, `.card-title`/`.card-body`/`sm` buttons
  which never shipped, and `/design-system` being a region rather than a route.
  Toast, Modal/Sheet, the footer and the header's scroll shadow are recorded in
  §8 as specified-and-unbuilt rather than quietly listed as components.
- **2026-08-12, third pass** — reconciled with what shipped after the first
  blind critique. The ground was rewritten from three spread lobes to two
  concentrated beams (its brightest rendered pixel had been 55/255, under the
  glass 32); `--e1-fill`/`--e3-fill` collapsed fill+dim into one resolved rgba
  and `--e1-dim`/`--e3-dim` were deleted; `--control` `#8b7aa8`→`#c0b3d4` after
  it measured 1.81:1 on lit chrome; `.stage` removed from E1, resolving a
  contradiction between §1 and §4 in §1's favour; N3's selector list completed;
  N4 restated in terms of blur radius rather than the `none` keyword; the three
  fallback blocks made byte-identical.
- **2026-08-13, R5** — the fifth UX round, and the first that was about how the
  product LOOKS rather than what it says. §5 rewritten: three families where
  there was one (`--display` restored as a real transitional serif on the
  masthead, the lede and the wordmark; `--mono` made deliberate and actually
  reachable — two `workspace.css` rules were asking for an undeclared
  `--font-mono` and an undeclared `--r-1`), and six sizes where there were
  five. The sixth, `--t-subhead` at 20px, is `h2`'s: the page measured 42
  rendered nodes at 14px against 5 at 18, 2 at 32 and 1 at 11, with a panel's
  title at the same step as the names inside it. `.note` — every explainer in
  the product — moved from 14px/1.40 to 16px/1.60, because a label's leading
  applied to seven-line teaching prose is what made the app's main teaching
  surface skim-proof. `check-selectors.py`'s ceiling moved 5 → 6, deliberately
  and once, with the argument written into the checker. §3: the tinted ground
  became OPT-IN and the plain ground the default, which makes the product's
  default and its whole fallback path the same picture; both skins stay
  reachable and both are still audited at every width. §6 gained the header's
  priority-ordered collapse (the `mask-image` that cut a token count through
  the number is deleted; one child shrinks, with a real ellipsis) and the nav
  drawer's scrim, shadow and close control — the first rendered use of
  `--e3-scrim`. §8 gained the Stage head (one agent strip and one view eyebrow
  above every routed view, replacing two per-view copies) and the Toggle, and
  recorded the footer's seventeen dead rules as deleted rather than pending.
  §10 gained an assertion that the ramp is used, not merely declared.
- **2026-08-13, R6** — the sixth round, and the verdict was *"the typography says
  'product'; the layout rhythm and the self-shredding header say 'internal'."*
  §6 gained **the horizontal system**: `--column`, the `.split` / `.dash-grid`
  pair, and a CONTAINER query on `.view-panel` rather than a media query,
  because folding the side panel changes the stage's width without the window
  moving. One card at 1440 held three content widths — prose 544, textarea 960,
  panel 1136 — with ~40% of every panel empty on the right; it now holds one
  (542), with the agent board and the endpoint's health living in the space that
  was empty. `.grows` joins `.note` under `--measure`, and R3-20's "the launcher
  takes the row" is superseded by it. §6 also replaced R5-7's scrollport with a
  **stated priority order** the header drops WHOLE items in — model line →
  tokens → sandbox → running → agent — which supersedes R4-15's "re-arrange,
  never delete"; the wordmark is droppable, the agent is not. (The failure
  banner was in that order behind a `:has(.problem)` rule until R8-2 moved it
  out of the strip and off the order altogether.) §5 pinned
  `strong`/`b` to `--w-strong` after `bolder` resolved to 900 inside a 600
  parent — one node, the only weight outside the ramp in the product. §8 gained
  the **destructive-action rule** (danger variant + two-press arm + the
  consequence stated before it happens, from Settings' one-press endpoint reset)
  and the **one rendering rule for machine output** (`.tool-call pre` wrapped in
  the stage and was shorn in the rail). A new §11 records the three findings that
  are legibility rather than pixels: one wording for the selected agent, `you`
  meaning the person rather than a pane's housekeeping, and an abandoned turn's
  explanation surviving the next message.
- **2026-08-13, R7** — the seventh round finished the horizontal system, whose
  verdict was that it *"is not yet a system, because three things escape it"*.
  §6 gained the COMPANION CLAMP (`max-width: 2 × reading + gutter`; hiding the
  sidebar had been handing every reclaimed pixel to the secondary column, which
  reached 704 against the primary's 608), a stack threshold moved 60rem → 66rem
  so the companion stacks at a 26rem floor instead of squeezing to 322, and two
  new shapes so the system reaches all six views rather than four: `.card-deck`
  for the Agents roster (2×2 at 1440, cards 529 round 503 of prose, against one
  1136px card round 544) and `.panel.reading` for Settings' Appearance (608).
  §6 also gained the rule that a dropped header fact has somewhere to go: the
  sandbox state and the agent NEVER drop — the sandbox shrinks to `● ready` —
  and the spend and the model line are written out in `StatusFold` at the foot
  of the nav, which is also the answer to the pills' explanations having lived
  in a mouse-only `title` on elements outside the tab order. §8 gained "every
  button carries its variant class" (`Send the message again` was the one
  control in the product with none) and block padding on the failure banner,
  whose `0px` vertical made a 44px Dismiss the full height of the pill. §11
  gained one-name-per-concept: *shipped with this site* everywhere, *Open
  Settings* everywhere, and Workspace → Commands + Files. The boot screen no
  longer offers `Hide views` with no views on the page.
- **2026-08-13, R8** — the eighth round's verdict was that *"the header and side
  panel are laid out for the success case only: every P1 is one composition
  breaking under a state its author didn't lay out for"*. Six, all of them a
  state rather than a width. §6 records the two header ones: the strip takes its
  own row at 30rem because `Agent: main` was being clipped to `Agent: m` under
  the side-panel switch (R8-1), and the failure banner leaves the strip for a
  row of its own because it could only fit there by evicting the endpoint and
  the spend — *an error state may add a row; it may never subtract a fact*
  (R8-2). With that banner up at 390 the conversation had measured 24px of
  client height over 1306 of transcript, so `.chat-log` has a floor and the
  panel scrolls when the column runs out (R8-3, 192px minimum, 202 measured).
  The banner also has to describe the present: a save in Settings answers the
  failure standing against the OLD address, a dismissal is stored in this
  browser, and both are keyed on `x-failed-turn` rather than the status
  timestamp, which is re-created on every reload (R8-4). In the rail, an
  unbroken tool argument was laid out at full width and dragged the panel to
  `scrollWidth 1063` against `clientWidth 372` — `.tool-args` wraps `anywhere`
  now — and the trace's *show me the newest call* scrolled the RAIL rather than
  the list, which is why entering Chat began 257px down with the first heading
  cut off; `#tool-trace` is a scrollport of its own in the rail and `show_last`
  scrolls the list when the list can scroll (R8-5). And the run receipt is
  derived instead of remembered: `receipt::last_run` rebuilds *main finished
  “…”* from `/board` and the transcript's `x-last-said`, so it survives
  navigation and a reload — no run history was added (R8-6).

- **2026-08-13, R8 (second pass)** — the same critic, having decided the visual
  design was finally worth paying for, filed twelve findings about what the
  words and the states do. Four were one defect wearing four hats: **one place
  had four names** (nav `Workspace`, card `Commands`, rail card `Files`, rail
  `Side panel`), **one event had three** (`last turn failed` / `failed` / `could
  not finish`), **one browser fact had two contradictory claims** (Chrome 142+
  *blocks* in Settings against *asks permission* in the chat error — the
  permission is the true one), and `This turn calls` fought `The next turn
  calls` over the same sentence. §11 records all four and the rule that settles
  them: a region is named for what is in it, and the projection's own word wins.
  `Tokens, all time` was relabelled `Tokens, every agent` rather than scoped to
  the selection — it sat beside `Agent: author` on zero turns and read as
  author's spend, but it is the page's figure and must not reset when you switch
  tab (R8-9). `.".` — a double full stop in every run-status string — was fixed
  in the CONSTRUCTION (`ui::quoted`, one terminal mark, one test) and not in the
  two instances (R8-11). The failure card that said *"the conversation says
  why"* now offers the conversation (R8-13), and `Technical detail for failure
  1` / `failure 2` — identical labels differing by an ordinal the product has no
  concept of — are named for what went wrong instead (R8-15).
  §8 records the rest: three message treatments instead of five with the
  page's own aside finally labelled (R8-14), one selection language across the
  nav and the strip with the focus ring moved off `--accent` so focus cannot
  read as selection (R8-12), the empty state cut to one sentence with its glyph
  deleted (R8-EMPTY, R8-18), and the destructive arm given a `Cancel` and one
  status region (R8-16). Two were layout under a state: a capped `.grows`
  clipped a line through its middle at 3,603 characters and now scrolls
  (R8-17), and the task card deleted its three examples on the FIRST keystroke,
  collapsing ~330px under the cursor — the examples stay until there is a run to
  report (R8-EX). §3 records the glow decision: kept and brought into the
  palette rather than removed, because the finding against it was *wrong
  colour*, not *ornament* (R8-GLOW).

- **2026-08-13, R11 (second pass)** — the eleventh critic's remaining findings,
  and the round where the AESTHETIC verdict outweighed the list. §5: **`h2` is
  no longer uppercase**, `--tr-subhead` is deleted, and a `.rail .panel > h2`
  drops to `--t-heading` — five tracked-caps banners in one column *"shout in
  unison and flatten hierarchy"*, and uppercase now belongs to `--t-caption`
  alone. §8: an EMPTY panel renders no disclosure, which takes ~700px of "nothing
  has happened yet" out of a cold rail; the process row gets a fill and a
  boundary so it reads as pressable, `gone` gets `--warning` and a `⚠` so the
  destroyed state is not the quieter-looking one, and the log it opens is
  READ-ONLY (`fileedit.rs`) rather than a live `<textarea>` over a running
  process's own record. §8 also records the arm rule the engine card broke twice:
  the cost goes ABOVE the buttons and is COUNTED (`enginecost.rs`, *"the 3 files
  in the workspace"*), and the arm is gated on the engine **running** rather than
  the one chosen — switching AWAY from container2wasm was the one-press reload
  that actually destroys an in-memory filesystem. §8 gains "one product, one
  voice about loss": the Files pane admits what a reload took instead of claiming
  nothing was ever written (`filegone.rs`), and `.` stops being the one piece of
  raw shell in user copy. §6: **the endpoint pill never drops** — `.pill-label` /
  `.pill-tail` give way to `.pill-short` and the MODEL ID stays at every width,
  because on a phone you could spend tokens against an endpoint you had never
  been shown — and the nav SHEET no longer survives a resize, since choosing to
  cover one viewport is not choosing to cover the next. §7: the guard learned to
  measure `:hover` and `:active`, which is how R11-6 shipped — a pressed row at
  `rgb(198,186,216)` on `rgb(203,168,255)`, 1.1:1, from `button:not(:disabled):
  active` at (0,1,1) outranking a class rule written without one. Three things
  had to change for the probe to see it: `check-layout.sh` inlines the built CSS
  (a `file://` stylesheet is opaque to CSSOM), the audit copies state rules onto
  real classes rather than re-implementing specificity, and it turns transitions
  off first, because `getComputedStyle` truthfully reports the colour a
  transition has not yet reached. Two copy fixes: the base-URL message says *"It
  must start with"* rather than asserting it of the value it just refused, and
  the scrollback stopped claiming the first command boots the Linux — the page
  prewarms it, so that sentence sat under a header that had read `ready` for
  minutes, and boot is the header pill's job.
