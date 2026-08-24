# UPLIFT — the director's findings, measured before the fleet reported

2026-08-23. Written against the LIVE page (`https://kaush4l.github.io/ASKK/`,
deploy `2afbfde` of `da032a5`) so that the round's design work can be checked
against numbers rather than against taste. Every figure here was read out of the
running page or out of `tokens.css`, and the command that produced it is named.

The owner's verdict was **"the current UI looks like a cheap imitation of a
webpage."** The purpose of this document is to say precisely WHY, in a form the
next round can attack.

---

## F1 — THE SHIPPED PAGE RUNS THE FALLBACK SKIN. This is the headline.

Read off the live page:

```
data-skin  = "plain"
--e1-blur  = 0px
--ground-field = linear-gradient(180deg, #0b0611 0%, #070409 100%)
```

There is no glass on the shipped page and there is no light on it. The
three-lobe light field in `tokens.css:34-38` and the entire material system in
`web/glass.css` (6,771 bytes) are **inert in the default configuration**. What a
visitor sees is a flat two-stop near-black gradient.

This is not a bug. It is a ruling: `web/index.html:120-128` sets `data-skin=plain`
unless `localStorage["askk.skin"] === "glow"`, and `crates/ui/src/shell/skin.rs:1-12`
records the reasoning — R5-C found the plain ground "cleaner and more focused"
in every side-by-side, so the glow became opt-in and the DEFAULT and the
FALLBACK became the same picture.

**That ruling optimised for "clean" and arrived at "inert."** The product ships
its own degradation path as its front door. Turning the light on is one line and
is trivially reversible, which is why it is the first thing the next round
should test rather than debate.

## F2 — THERE IS ALMOST NO TYPOGRAPHIC HIERARCHY. 2.91:1.

Counted over rendered leaf nodes with text, at 1280px:

| size | nodes |
|-----:|------:|
| 11px | 6  |
| 14px | 30 |
| 16px | 9  |
| 18px | 6  |
| 20px | 3  |
| 32px | 1  |

**Largest ÷ smallest = 2.91:1** (at 390px it is 2.18:1, because `--t-display`
clamps down). A page that reads as cinematic normally runs somewhere between
6:1 and 12:1. 30 of 55 nodes sit on one size.

`DESIGN.md:1402` §10 item 13 already asserts "the ramp is USED" and
`DESIGN.md:1402` §10 item 13 already asserts "the ramp is USED" — and
`layout-audit.js:24` prints `INFO SIZES` and then **stops**. There is no
`say()`. Nothing in the gate has ever been able to fail on it, which makes §10
item 13 a pass/fail criterion the gate cannot execute (I17).

### CORRECTION — F2 was measured on the best route in the product

The figures above are the DASHBOARD's, and the Dashboard is the only screen
with a masthead on it. `scripts/ramp-audit.js`, added this round, measures all
three routes at nine widths:

| route | steps | span | range | top step |
|-------|------:|------|------:|---------:|
| dash  | 6 | 11–32px | 2.91:1 | 14px @ 65% |
| chat  | 5 | 11–20px | 1.82:1 | 14px @ 72% |
| deck  | 4 | 11–18px | 1.64:1 | 14px @ 72% |

**Chat and Deck carry no display type at all**, and on both of them a single
14px step holds nearly three quarters of the rendered text. The real worst case
is 1.64:1, not 2.91:1. Any redesign that fixes only the Dashboard's first
screen will leave the two routes a user actually spends time in untouched.

## F3 — THE MASTHEAD DOES NOT DOMINATE ANYTHING.

`h1` "HARNESS" renders at **32px** (`--t-display` caps at `2rem`). Directly
beneath it, `p.tagline` is **170 words, 18px, 403px tall**, starting at y=264 —
so it occupies the rest of the first screen on a 900px-tall window.

The masthead is **1.78×** the paragraph it is supposed to command. At 390px the
same paragraph becomes a ~25-line wall that fills the first screen and overruns
it, and nothing above it is large enough to be the thing you look at first.

This is the single worst element on the page and every proposed direction has to
answer for it.

## F4 — THE HEADER STRIP CLIPS MID-WORD ON A PHONE.

At 390px the status strip renders `calls g…` — cut inside a word. The strip is a
deliberate scrollport with a mask fade (measured in an earlier round:
`scrollWidth === innerWidth === 375`, no overflow), so this is not a layout
overflow bug. It is a LEGIBILITY bug: the fade reads as damage rather than as an
affordance, which was already queued as a `strip.css` increment and is now
promoted into this round.

## F5 — THE DESIGN CONSTITUTION IS WHAT MAKES IT PLAIN.

`DESIGN.md:11-33` §1 refuses, in writing: decoration that carries no
information, depth used to decorate, and "prettier at the cost of readable." It
requires that "the middle stays calm."

Every one of those refusals is defensible for a control surface, and together
they are why the page looks like a cheap imitation: eight rounds of critique
removed each source of visual interest one at a time, each time correctly by the
constitution's own standard. **The page is not cheap by accident. It is cheap by
policy.**

So a cinematic uplift is not a CSS change. It is an amendment to §1 — and it has
to be one that keeps the refusals that were right (no blur under body text, no
ornament posing as data, no unreadable contrast) while dropping the assumption
that CALM and INERT are the same thing. A control surface can have a
commanding front door and a quiet working middle; the constitution currently
does not distinguish between them, and that is the sentence to rewrite.

---

## F6 — THE RAMP NOW HAS A GATE, AND IT IS A RATCHET.

`scripts/ramp-audit.js` (78 lines, its own file because `layout-audit.js` is
already 245 and its header records being split at the 200-line rule) asserts
two things §10 item 13 only ever claimed: RAMPRANGE and RAMPDOMINANCE. It is
wired into `scripts/layout-probe.html:525` before `layout-audit.js`, which
writes `#report` last, and into `scripts/check-layout.sh:21`.

The floors are the measured WORST CASE across all routes — `MIN_RANGE = 1.6`,
`MAX_DOMINANCE = 0.75` — so it passes today and can only be raised. The round's
exit criterion is raising them to **6.0** and **0.45**.

Positive control: `MIN_RANGE` 1.6 → 3.0 produces `LAYOUT CHECK FAILED: 54`;
restored, `LAYOUT CHECK OK`.

---

## What this document does NOT claim

- It does not say the glass skin is good. It says the glass skin is UNSEEN, and
  that shipping the fallback as the default is a decision worth re-testing.
- It does not measure contrast for any proposed design. Every number above is
  about the page as it ships today.
- It does not evaluate any view other than the Dashboard's first screen.

---

## F7 — THE NAMEPLATE OVERHANGS ITS OWN RULE ON A PHONE (open, with the arithmetic)

Measured on the LIVE page at 375px, deploy `8508789` of `1e3a061`:

```
.plate box   right = 347.8
.plate glyphs right = 356.1     err = +8.3px
scrollWidth 328 vs clientWidth 320   over = 8px
```

The rules above and below the word end at 347.8; the word ends at 356.1. It
reads as the nameplate breaking out of its own frame, which is the kind of
detail that reads as a mistake rather than as an optical bleed.

**The cause is a knee the fit does not model.** `--tr-nameplate` solves the
letter-spacing that makes HARNESS span the column exactly:

```
tr = (column - 4.74em * size) / 6        (7 glyphs, 6 inter-letter gaps)
```

`--t-display` is itself a clamp with a `4.25rem` floor, so **below ~400px the
word stops growing while the column keeps shrinking**, and the relation between
`tr` and `vw` changes slope. The shipped term `-1.734rem + 7.61vw` was fitted on
the growing side. On the pinned side it over-tracks by 1.34px per gap at 375 —
which is 6 × 1.34 ≈ the 8px measured.

| vw | true fit | shipped |
|---:|---------:|--------:|
| 375 | −0.55 | **+0.79** |
| 390 | +1.95 | +1.94 |
| 500 | +11.59 | +10.31 |

### WHY IT IS NOT FIXED HERE

A two-line form — `min(16.667vw - 3.94rem, <the original term>)` — fixes 375 to
+0.3px. It was written, measured and **reverted**, for two reasons that are
worth more than the fix:

1. **A first attempt broke the desktop.** Re-deriving the upper line as
   `7.977vw - 1.768rem` pushed 1440 into the `5.2rem` cap and overhung by
   8.3px — trading a phone defect for a desktop one.
2. **The measurement rig cannot settle it.** The numbers above the phone band
   were taken against `scripts/layout-probe.html`, whose column widths are not
   the app's, and whose non-Dashboard plate is the word "main" — four letters,
   not seven — so the 4.74em constant does not apply to it at all. A fit
   verified on that fixture is not a fit verified on the product. The desktop
   critic's zero-error result at seven widths from 1024 to 2560 was taken
   against the real app, and that is the bar.

**So the fix needs the real app at a range of widths, not the probe.**

### CLOSED — and the class of fix was wrong, not the constants

Run on the app by `scripts/measure-app.sh`, glyph extent against the element's
own box, the shipped clamp was exact at exactly the two widths it was fitted at:

| vw | 320 | 360 | 375 | 390 | 400 | 500 | 768 | 1024 | 1280 | 1440 | 1920 |
|---:|----:|----:|----:|----:|----:|----:|----:|-----:|-----:|-----:|-----:|
| err | -9.7 | +16.5 | +8.3 | **+0.2** | -5.3 | -7.4 | -13.2 | -21.8 | **+87.1** | **+0.1** | -87.7 |

A third linear term would have been a third point-fit, so the class ended
instead. The plate is an inline `<svg>` whose `<text>` carries
`textLength="100%"` with `lengthAdjust="spacing"`: it spans its box by
construction, at every width and for a word of any length, with no constant, no
clamp, no cap, no font file and no script. The same eleven widths now read
**0.0 on all eleven, on the Dashboard's HARNESS and on the head's four-letter
`main` alike** — the half the constant never had, since 4.74em was HARNESS's
seven glyphs. `--tr-nameplate` is deleted (0 readers), and with it the 22rem
`--tr-display: -0.08em` condense and three break-out media blocks that existed
only to give an overflowing word somewhere to go.

`core::builtins::nameplate`, `crates/ui/src/centre/plate.rs` and
`scripts/layout-probe.html` are three spellings of one shape; Chrome's
accessibility tree reads `heading "HARNESS" → img "HARNESS"`.

### THE RIG NOW EXISTS, AND THE ANSWER IS WORSE THAN F7 ASSUMED

`scripts/measure-app.sh` serves `dist/` and drives the actual Wasm build.
Measured on the real app — glyph extent against the element's own box, both
skins identical because geometry is skin-independent:

| vw | 320 | 360 | 375 | 390 | 400 | 500 | 768 | 1024 | 1280 | 1440 | 1920 |
|----|----|----|----|----|----|----|----|----|----|----|----|
| err px | −9.7 | **+16.5** | **+8.3** | +0.2 | −5.3 | −7.4 | −13.2 | −21.8 | **+87.1** | +0.1 | −87.7 |
| overflow | 0 | 16 | 8 | 0 | 0 | 0 | 0 | 0 | **87** | 0 | 0 |

**The fit is exact at two of eleven widths — 390 and 1440 — and nowhere else.**
It overhangs its own rule at 360, 375 and, worst, by 87px at 1280, which is one
of the most common laptop widths there is.

**This corrects a claim this round was partly judged on.** The desktop critic
reported "measured last-glyph right edge vs column right edge: 1024 → 996.0/
996.0 … 2560 → 2000.0/2000.0. Zero error at seven widths. That is craft. Do not
touch it." On the real app 1024 is −21.8, 1280 is +87.1 and 1920 is −87.7. The
two widths that do solve are the two the term was fitted at. The judge scored
EDITORIAL's craft partly on that claim, and the direction still wins on the
other evidence — but the claim itself does not hold.

### WHY ARITHMETIC IS THE WRONG TOOL HERE

`tr = (column - 4.74em * size) / 6` assumes `column` is a smooth function of
`vw`. It is not: the nav and the rail appear and disappear at breakpoints, so
the column steps. A single clamp cannot model a stepped function, which is why
adding a second line fixed the phone and left 1280 at +87. Any further term is
another point-fit at another width.

The fix is to stop solving it and let the renderer fit the word — an
`<svg><text textLength="100%" lengthAdjust="spacing">` spans its box exactly by
construction at every width, needs no constant, no clamp and no cap, ships no
font file and runs no script. That is the shape of the next change; it touches
markup and needs an accessible-name check, so it is chartered rather than
improvised.

Until then the shipped term stays, because reverting to no tracking loses the
span entirely and the two widths it does solve are the two most common. What
does NOT stay is the claim that it is solved.
