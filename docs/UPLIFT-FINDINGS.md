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
`layout-audit.js` prints `INFO SIZES` for exactly this — so the system has the
instrument and passes the check while the page has no hierarchy. **The check
tests for a majority on one size; it does not test for RANGE.** That is the gap.

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

## What this document does NOT claim

- It does not say the glass skin is good. It says the glass skin is UNSEEN, and
  that shipping the fallback as the default is a decision worth re-testing.
- It does not measure contrast for any proposed design. Every number above is
  about the page as it ships today.
- It does not evaluate any view other than the Dashboard's first screen.
