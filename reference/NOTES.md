# Liquid-glass reference captures — measured values

Captured 2026-08-12, headless Chromium, viewport 1440x900, DPR 1, macOS.
All CSS values are `getComputedStyle()` output read off the live page, verbatim.
Luminance figures are WCAG relative luminance computed from mean sRGB of a sampled
rectangle in the PNG (ffmpeg crop -> mean -> sRGB linearization).

---

## apple-macos-hero.png — apple.com/os/macos (top of page)

The only real CSS glass at the top is the localnav pill row. Each active pill is
`span.all-access-pass__background` with `backdrop-filter: blur(10.0738px)` (no saturate)
and fill `rgba(42, 42, 45, 0.843)` — a nearly-opaque dark fill, so the blur contributes
very little; the translucency reads as tint, not see-through. There is no border of any
kind (`border-*: 0px none`), no `box-shadow`, `border-radius: 28px` on a 57px-tall pill
(fully rounded, radius ≈ height/2), padding is `0px` on the background span itself
(the label sits in a sibling). Text on the pill is `rgb(245, 245, 247)`. The full-viewport
`div.globalnav-curtain` behind the nav is `backdrop-filter: blur(20px)` over
`rgba(0, 0, 0, 0.4)`. Page ground behind everything measures mean sRGB (32,32,34),
relLum 0.014 — near-black. Note: the device screens in the hero are baked bitmaps,
not live glass; do not measure them.

## apple-macos-spotlight-glass.png — apple.com/os/macos (scrollY 1400)

This is the strongest "liquid glass over photography" frame in the set: the macOS 27
Spotlight/"Search or Ask" capsule floating over the beige-and-lilac wallpaper. It is a
video/bitmap composite, so there is no CSS to read; measured from pixels instead. The
capsule interior samples mean sRGB (69,63,58), relLum **0.051**. The wallpaper immediately
below the capsule samples (168,150,138), relLum **0.318**. So the material is darkening
its backdrop by roughly 6x in relative luminance while still letting the wallpaper's
warm hue through (the interior stays warm-biased R>G>B, matching the backdrop's hue
rather than going neutral grey). The capsule is a full-round-end pill (radius = height/2),
about 720x100 CSS px, with a visible bright specular edge along the top-left arc and a
darker edge along the bottom-right — the top edge is treated differently from the rest,
which is the single most copyable detail here. Placeholder text and mic glyph are
near-white on that 0.051 backdrop.

## hig-liquid-glass-guidance.png — developer.apple.com/design/.../materials (Liquid Glass section)

No glass on the page itself; the docs chrome is flat. The one glass surface is
`div.nav__background`: `backdrop-filter: saturate(1.8) blur(20px)` over
`rgba(255, 255, 255, 0.7)`, no border, no shadow, radius 0, height 52px. That
`saturate(1.8) blur(20px)` pair is Apple's own web recipe and appears identically on
apple.com's `.ac-ln-background` (see visionOS note) — treat it as the canonical
light-mode chrome material. The value of this capture is the text, which pins the rules:
Liquid Glass is a *functional* layer for controls and navigation only, never the content
layer; two variants exist, `regular` (blurs and adjusts luminosity of the backdrop to
protect legibility, used by most system components) and `clear` (highly translucent, only
for components over visually rich backgrounds). `developer.apple.com/design/human-interface-guidelines/liquid-glass`
is not a separate page — the material lives as a section inside `/materials`.

## hig-liquid-glass-variants.png — same page, the specimen images

Apple's own side-by-side specimens, measured off the pixels. **Regular on dark
background:** circle interior (26,29,43) relLum **0.013** vs surrounding starfield
(9,8,11) relLum **0.003** — the material *lifts* a dark backdrop about 4x and shifts it
cool/blue. **Regular on light background:** circle interior (217,213,199) relLum
**0.665** — on a bright beach photo it stays bright but flattens all detail to a
near-uniform warm grey. **Clear on brick:** interior (103,69,57) relLum **0.074** vs
brick outside (88,47,34) relLum **0.042** — barely lighter, hue fully preserved, the
brick pattern is still legible through it. So: regular ≈ heavy luminosity normalization
toward mid, clear ≈ blur only. The accompanying text gives the one hard number Apple
publishes: for clear Liquid Glass over bright content, add **a dark dimming layer at 35%
opacity** behind the component; over sufficiently dark content, none. Every circle here
has a hairline rim that is brighter at the top-left arc and fades to nothing at the
bottom — again, top edge ≠ rest.

## visionos-glass-panel.png — apple.com/apple-vision-pro (scrollY 4200)

The floating video player panel over the darkened airplane-cabin plate. Baked bitmap,
measured from pixels: panel interior (52,58,59) relLum **0.041**, surrounding cabin
(3,10,19) relLum **0.003** — same signature as HIG's "regular on dark": the panel is
~13x brighter than its backdrop, so on dark grounds visionOS glass *adds* light rather
than subtracting it. Corner radius is large and continuous (roughly 24-28px on a ~350px
wide panel), the transport bar below the video is a separate, more translucent capsule
with its own hairline. The page's own CSS glass is nav chrome only:
`div.ac-ln-background` = `backdrop-filter: saturate(1.8) blur(20px)` over
`rgba(250, 250, 252, 0.8)`, padding `44px 0 0`, no border, no shadow, radius 0; and
`div.globalnav-curtain` = `blur(20px)` over `rgba(232, 232, 237, 0.4)`. Text color on
that light chrome is `rgb(29, 29, 31)`.

## reflect-hero.png / reflect-glass-card.png — reflect.app

The best *readable CSS* dark-glass system in this set, and the one worth cloning. The
primary card `div.ai-showcase-inner` is 560x122 with
`backdrop-filter: blur(15px)`, fill `rgba(4, 1, 21, 0.1)` (a 10%-alpha near-black violet,
so it is genuinely see-through), border `1px solid rgba(255, 255, 255, 0.1)` — uniform on
all four sides, no top-edge special-casing, `box-shadow: none`, `border-radius: 16px`,
padding `24px 32px`, text `rgb(255, 255, 255)`. Measured: card interior (33,26,63) relLum
**0.014**; the page ground just outside it (3,0,20) relLum **0.001**; the purple glow that
passes *behind* the card center (119,79,200) relLum **0.137**. So the card sits on a
backdrop whose luminance varies 100x across its own width, and the 10% fill barely
touches it — legibility here comes from white text, not from the material.
Secondary surfaces in the same family: `.ai-showcase-animation-menu` and
`.ai-showcase-animation-answer` use a stronger `blur(22px)` over `rgba(3, 0, 20, 0.2)`,
same `1px solid rgba(255,255,255,0.1)` border, `border-radius: 12px`, plus
`box-shadow: rgba(255, 255, 255, 0.08) 0px 0px 12px 0px inset` — an inner white glow, no
outer shadow. The header is `blur(16px)` over `rgba(3, 0, 20, 0.08)`. Badges
(`.hero-badge`, `.section-header-badge`) are `blur(6px)` over a **fully transparent**
`rgba(0,0,0,0)` fill with `border-radius: 32px` and
`box-shadow: rgba(164, 143, 255, 0.12) 0px -7px 11px 0px inset` — a violet glow pushed up
from the bottom edge, which is how they get a lit rim without a border. The one card that
does use an outer shadow, `.connected-card-record-circle-blur` (152px circle,
`blur(11.5px)`, fill `rgba(255,255,255,0.01)`), uses
`rgba(3, 0, 20, 0.5) 32px 36px 32px 0px` — a large, heavily offset, fully colored-to-the-
background-hue drop shadow.

## linear-glass-header.png — linear.app

Included for its border technique, which is the most sophisticated in the set. The header
is `backdrop-filter: blur(20px)` over a **fully transparent** background
(`rgba(0,0,0,0)`), with `border-bottom: 1px solid rgba(255, 255, 255, 0.08)` and nothing
on the other three sides — measured strip luminance (11,11,12) relLum **0.003**, i.e. the
chrome is pure blur, zero tint. The secondary pill buttons (`Log in`, 85x32 and 144x44)
are `backdrop-filter: blur(4px)` over `rgba(255, 255, 255, 0.05)`, `border-radius: 9999px`,
padding `0 12px` / `0 20px`, text `rgb(247, 248, 248)`, **no CSS border at all** — the
edge is built entirely out of four stacked shadows:
`rgba(255,255,255,0.03) 0 0 0 1px inset, rgba(255,255,255,0.04) 0 1px 0 0 inset, rgba(0,0,0,0.6) 0 0 0 1px, rgba(0,0,0,0.1) 0 4px 4px 0`.
Read that in order: a uniform 1px inner white ring at 3%, then a second inset white line
on the **top edge only** at 4% (the specular highlight), then a 1px outer black ring at
60% to separate the pill from whatever is behind it, then a soft 4px drop shadow. That
top-edge-only inset line is the same trick Apple's capsules use, done in pure CSS.
The white `Sign up` pill is solid, not glass: (199,199,200) relLum **0.569**.

---

## Sites that did not deliver

**tomorrow.io** — no usable glass. The header carries `backdrop-filter: blur(25px)` over
a fully transparent background while at the top of the page, but on scroll it swaps to
class `scrolled` and becomes `blur(0px)` over solid `rgb(255,255,255)` with a
`1px solid rgb(235,235,235)` bottom border. Every "card" over imagery further down is a
1px outline on a flat dark panel with no backdrop-filter anywhere. Two attempts (initial
load and after cookie-banner dismissal + three scroll positions); nothing worth
screenshotting, so `linear.app` was substituted as the sixth source.

**developer.apple.com/design/human-interface-guidelines/liquid-glass** — not a real URL;
the material is a section of `/materials`, already captured.

---

## Measured value table

| Surface | backdrop-filter | fill (bg rgba) | border | box-shadow | radius | text | backdrop relLum | padding |
|---|---|---|---|---|---|---|---|---|
| apple.com localnav pill (`.all-access-pass__background`) | `blur(10.0738px)` | `rgba(42,42,45,0.843)` | none (`0px none`) | none | `28px` | `rgb(245,245,247)` | 0.014 (page ground) | `0px` |
| apple.com globalnav curtain (macOS, dark) | `blur(20px)` | `rgba(0,0,0,0.4)` | none | none | `0px` | `rgb(29,29,31)` | 0.014 | `0px` |
| apple.com localnav wrapper (macOS, dark) | `blur(20px)` | `rgba(0,0,0,0.6)` | none | none | `0px` | `rgb(29,29,31)` | 0.014 | `0px` |
| macOS Spotlight capsule (bitmap) | n/a (rendered) | interior relLum 0.051 | bright top-left arc, dark bottom-right | n/a | height/2 (full pill) | near-white | 0.318 (wallpaper) | n/a |
| HIG docs nav (`.nav__background`) | `saturate(1.8) blur(20px)` | `rgba(255,255,255,0.7)` | none | none | `0px` | `rgb(29,29,31)` | ~0.9 (white page) | `0px` |
| HIG *regular* variant on dark (specimen) | n/a | interior relLum 0.013 | hairline, top-arc brighter | n/a | circle | n/a | 0.003 | n/a |
| HIG *regular* variant on light (specimen) | n/a | interior relLum 0.665 | hairline, top-arc brighter | n/a | circle | n/a | ~0.55 (beach) | n/a |
| HIG *clear* variant on brick (specimen) | n/a | interior relLum 0.074 | hairline | n/a | circle | n/a | 0.042 | n/a |
| apple.com localnav (Vision Pro, light) `.ac-ln-background` | `saturate(1.8) blur(20px)` | `rgba(250,250,252,0.8)` | none | none | `0px` | `rgb(29,29,31)` | ~0.9 | `44px 0px 0px` |
| apple.com globalnav curtain (Vision Pro, light) | `blur(20px)` | `rgba(232,232,237,0.4)` | none | none | `0px` | `rgb(29,29,31)` | ~0.9 | `0px` |
| visionOS video panel (bitmap) | n/a | interior relLum 0.041 | bright hairline all round | n/a | ~24-28px continuous | white | 0.003 (cabin) | n/a |
| reflect.app card `.ai-showcase-inner` | `blur(15px)` | `rgba(4,1,21,0.1)` | `1px solid rgba(255,255,255,0.1)` all sides | none | `16px` | `rgb(255,255,255)` | 0.001–0.137 (glow gradient) | `24px 32px` |
| reflect.app menu/answer popovers | `blur(22px)` | `rgba(3,0,20,0.2)` | `1px solid rgba(255,255,255,0.1)` all sides | `rgba(255,255,255,0.08) 0 0 12px 0 inset` | `12px` | `rgb(255,255,255)` | 0.001 | `6px 0 12px` / `0px` |
| reflect.app header | `blur(16px)` | `rgba(3,0,20,0.08)` | none | none | `0px` | `rgb(255,255,255)` | 0.001 | `0px 20px` |
| reflect.app badge `.section-header-badge` | `blur(6px)` | `rgba(0,0,0,0)` | none | `rgba(164,143,255,0.12) 0 -7px 11px 0 inset` | `32px` | `rgb(255,255,255)` | 0.001 | `6px 14px 6px 15px` |
| reflect.app circle `.connected-card-record-circle-blur` | `blur(11.5px)` | `rgba(255,255,255,0.01)` | `1px solid rgba(255,255,255,0.1)` | `rgba(3,0,20,0.5) 32px 36px 32px 0` | `50%` | `rgb(255,255,255)` | 0.001 | `0px` |
| linear.app header | `blur(20px)` | `rgba(0,0,0,0)` | `1px solid rgba(255,255,255,0.08)` **bottom only** | none | `0px` | `rgb(247,248,248)` | 0.003 | `0px` |
| linear.app secondary pill | `blur(4px)` | `rgba(255,255,255,0.05)` | none | `rgba(255,255,255,0.03) 0 0 0 1px inset, rgba(255,255,255,0.04) 0 1px 0 0 inset, rgba(0,0,0,0.6) 0 0 0 1px, rgba(0,0,0,0.1) 0 4px 4px 0` | `9999px` | `rgb(247,248,248)` | 0.003 | `0px 12px` (sm) / `0px 20px` (lg) |
| tomorrow.io header (scrolled) | `blur(0px)` | `rgb(255,255,255)` (opaque) | `1px solid rgb(235,235,235)` bottom | `rgba(0,0,0,0.05) 0 4px 10px 0` | `0px` | `rgb(23,21,46)` | n/a | `0px` |

### Patterns that repeat across all four real systems

1. **Blur radius clusters at 15-22px for cards and 20px for full-width chrome.** Small
   controls use much less (4-11px). Nobody uses 40px+.
2. **Saturation boost only appears on Apple's light-mode chrome** (`saturate(1.8)`), never
   on any dark surface measured.
3. **Fill alpha splits into two families:** genuinely translucent cards sit at
   0.05-0.20 alpha (reflect, linear), while opaque-ish chrome sits at 0.4-0.85 (apple).
   The 0.843 apple pill is effectively a solid.
4. **Hairline is `rgba(255,255,255,0.08-0.10)` at exactly 1px** wherever a border exists.
5. **The top edge is treated separately in every high-craft example** — Linear does it with
   a second `0 1px 0 0 inset` white shadow at 4%, Apple's bitmaps do it with a brighter
   specular arc. Reflect is the exception and its cards look flatter for it.
6. **Outer drop shadows are rare.** Three of four systems use `box-shadow: none` on their
   glass and rely on the blur + hairline alone; where a shadow exists it is either an inner
   glow or a heavily offset shadow tinted to the page background hue, never neutral black.
7. **Radius is 12-16px for cards, height/2 for controls.** No 8px cards, no 24px pills.
