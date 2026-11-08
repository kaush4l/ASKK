# Glass — the design language

Askk's look is glassmorphism done the way the platform references do it: a vivid wall, content on calm panes,
and only what floats made of frosted glass. This file states the principles (with sources) and how each one maps to
our tokens (`design/tokens.json`) and primitives. Rules that bind are in `docs/design-rules.md`; this is the why.

## Principles

1. **Layering: wall → content → what floats.** Glass reads as depth only over something vivid and fixed. Apple's
   Liquid Glass is a functional layer for controls and navigation that floats *above* content; Microsoft keeps its
   blurred Acrylic to transient, light-dismiss surfaces (menus, flyouts) and puts long-lived windows on the opaque
   Mica. → `Background` (wall fields `wall-a..d`, wash, ripple) · `.pane` (content: tint at `glass.card`, no blur) ·
   `.glass` (floating: tint at `glass.alpha`, `blur(glass.blur) saturate(180%)`).
2. **The recipe: backdrop, blur, tint, edge, noise.** Fluent's Acrylic is background → blur → exclusion blend →
   tint → noise; Liquid Glass adds a specular, light-catching edge. → `.glass` = blur + saturate, a tint at
   `glass.alpha`, a 1 px edge at 55 % of `edge`, an inner top highlight (the specular line), a deep soft shadow
   (`--elev`); the wall's ripple is our grain.
3. **Never glass on glass.** Stacked blurs turn to mud and cost frames. → a floating layer's children are panes or
   opaque surfaces (the composer's menu is opaque; the expanded card sits as a pane on the frosted scrim).
4. **Legibility first.** Translucency lowers text contrast; text must stay ≥ 4.5:1 (large ≥ 3:1) over the worst
   backdrop. Apple dialled back transparency during the iOS 26 betas and added a Tinted option for this reason.
   → `glass.card` 72 %, `glass.deep` 34 % only behind large type in the immersive scene with a vignette
   (`.deep`) under it; text never sits on the raw wall.
5. **Respect the user's settings.** Reduce Transparency / Increase Contrast replace glass with a solid fill (NN/g);
   Reduce Motion removes fluid effects. → `prefers-reduced-transparency: reduce` sets every alpha to 100 %, blur 0,
   no wall filter; `prefers-reduced-motion: reduce` sets every duration to 0 (no morph, no zoom, no pulse).
6. **Concentric shapes.** Liquid Glass nests corner radii concentrically. → floating glass `radius-lg + space-1`
   around `radius-lg` cards around `radius-md` rows.
7. **Morph, don't cut.** Elements change shape in place (Dynamic Island, widget → app expansion, visionOS windows
   growing into volumes): the thing you touched becomes the bigger thing. → medium grows from the card's own rect
   into the content area (FLIP, `motion.calm`, `ease.calm`); large zooms the card into the full-screen scene with
   the View Transitions API (one `view-transition-name`, a plain swap without it).
8. **Immersive = the room, not a bigger window.** visionOS goes from window → volume → full space; the backdrop
   becomes the experience. → `/focus?id=…`: the page's own wall, saturated and brightened, a vignette, one sheet
   of deep glass, the object's `large` tree laid out by its `scene` (conversation, meters, gallery, pipeline,
   reader, spatial). Escape, Close or Back return.

## The four sizes in this language

| size | where | material |
| --- | --- | --- |
| icon | 2×2 tile in the widget grid (`span.icon`) | transparent tile, the avatar (`widget.avatar`) is the object; controls inside, on hover / focus / long press |
| small | 4×3 card (`span.small`) | pane: header, focus line, own body, activity list (scrolls) |
| medium | expanded into the content area | pane on a frosted scrim (`glass.scrim`) that dims and blurs the rest |
| large | full viewport, `/focus?id=` | deep glass (`glass.deep`) over the intensified wall |

## Sources

- Apple, *Liquid Glass* (WWDC 2025) and HIG *Materials*: <https://developer.apple.com/design/human-interface-guidelines/materials>,
  overview <https://en.wikipedia.org/wiki/Liquid_Glass>
- Legibility changes during the betas: <https://victorwynne.com/liquid-glass-beta-3/>,
  <https://mobilesyrup.com/2025/06/10/how-apple-is-making-sure-liquid-glass-as-legible-as-possible/>,
  Tinted option <https://tidbits.com/2025/10/21/ios-26-1-to-add-optional-opacity-to-liquid-glass/>,
  Reduce Transparency <https://www.macrumors.com/how-to/ios-reduce-transparency-liquid-glass-effect/>
- Microsoft Fluent, *Acrylic material* <https://learn.microsoft.com/windows/apps/design/style/acrylic> and
  *Materials* (Mica) <https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials>,
  Fluent 2 *Material* <https://fluent2.microsoft.design/material>
- NN/g, *Glassmorphism* <https://www.nngroup.com/articles/glassmorphism/>; Axess Lab, *Glassmorphism meets
  accessibility* <https://axesslab.com/?p=5111>
- visionOS windows, volumes and spaces: <https://developer.apple.com/design/human-interface-guidelines/spatial-layout>
- View Transitions API: <https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>
