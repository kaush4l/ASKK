# DESIGN — the design law

> Increment 6.1. This document answers to `docs/NORTH-STAR.md`; where they
> disagree, NORTH-STAR wins. It is law for everything the interface renders.
> Reconciled with `docs/ARCHITECTURE.md` §10.2, which rules the six points
> below: **DESIGN rules what surfaces exist, what they show, and what they look
> like; ARCHITECTURE rules where files live and what crosses the wire.**
>
> **One file declares every value: `src/ui/tokens.css`.** Nothing else under
> `src/ui/` or `src/app/` may write a colour, a size, a radius, a shadow, or a
> duration. A surface that needs a new value adds it here first, with its
> measured contrast.

---

## 1. THE DIRECTION

**Build the agent's workbench as a numbered tape running down a warm graphite
page: the machine's work printed in mono against a fixed measurement gutter,
achromatic except for one amber mark on whatever is happening right now.**

"Workshop, not chat window" is a claim about *what is on screen*, not about
mood. A chat window shows two speakers. A workshop shows a machine mid-job:
what it is reasoning through, which tool it reached for, what came back, what it
now believes, and what it cost. Those five things are the content. Everything
else on the page is scaffolding for them.

Concretely that means three commitments:

- **The prompt is visible.** The one thing this system does that most harnesses
  never expose is show the operator the literal bytes the model receives.
  That is two first-class surfaces (§4.3 Prompt, §4.4 Context), not a debug
  drawer behind a developer flag.
- **A turn is a sequence of observable events, not a message.** Model text,
  tool calls, tool returns, retries, token cost — each is a row on the same
  spine, each with a step number and an elapsed time.
- **Dense where information lives, quiet where it does not.** The working
  surface earns no decoration at all. The cold open earns exactly one
  expressive gesture, because a front door that says nothing means the operator
  never gets to the middle.

### 1.1 The amendment, written down so it is not re-litigated

The previous tree's design law refused decoration on principle for eight
rounds. The result was a page that shipped its decorative layer *inert* — the
CSS existed, the skin attribute said `plain`, and nobody noticed because the
law had made "no decoration" a virtue. It was fixed by amending the law to
**commanding front door, quiet working middle**.

This document adopts that amendment as its starting position and adds the check
that was missing: `scripts/browser/frontdoor.ts` measures the *computed* style
of the front door's expressive layer in the built export and fails if it
resolves to the inert fallback (§9). A law that permits an element but cannot prove it
rendered will eventually permit nothing.

The reverse overcorrection is refused just as hard: the front door's expressive
budget is **one element, bounded by token, on one surface** (§4.1 — the Door,
and only the Door). It does not travel to the Workbench.

---

## 2. THE IDENTITY TEST

Beside three generic dark dashboards, four things identify this page. Each is
stated so that a builder can violate it and be shown the violation.

**A. The tape spine (layout rhythm).** Every event on a working surface is a
row hanging off one continuous 1px vertical rule at `--rail-step` (96px) from
the content's left edge. Left of the rule: step number and elapsed time, mono,
tabular figures, right-aligned. Right of it: the body. The rule is *continuous
down the whole scroll*, not per-card. Model text, a tool call, a tool return, a
retry and the cost line are all the same row shape.
*Violation:* a speech bubble, an avatar, a message that does not hang off the
spine, a second gutter width anywhere in the app.

**B. Display is mono; if the model sees it, it is mono (type pairing).** Two
voices from one superfamily. **IBM Plex Sans** is chrome — navigation, labels,
controls, prose about the system. **IBM Plex Mono** is bytes — the prompt, the
transcript, tool arguments, paths, hashes, counts — *and* the display size on
the front door. A machine's own typeface at poster size is the masthead.
*Violation:* the masthead set in sans; a model-facing string set in sans; a
count or a hash set in sans.

**C. Warm graphite, achromatic at rest, one hue budget (colour discipline).**
The neutrals are warm (hue ≈ 30°, chroma near zero). Blue-black is the house
style of every other dark dashboard and is a violation here. The interface
carries **no chroma at all while nothing is happening**. Colour is spent only on
four meanings (§3.3), and at rest, with no turn running, a viewport may contain
**at most one** chromatic element.
*Violation:* a `#0b0f1a`-family background; a coloured icon set; a chart with a
categorical palette; three accents visible with the machine idle.

**D. Stillness plus one moving mark (motion signature).** Arriving tokens do not
fade, slide, or shimmer. They appear. The only thing that moves during a turn is
a solid amber block caret trailing the last glyph, and the elapsed clock in the
gutter ticking at 100ms in tabular figures. When the stream stalls past 1.5s the
caret starts blinking at 1s — a blink is *information*, not life.
*Violation:* a skeleton loader; a per-token fade-in; a spinner anywhere a real
elapsed number exists.

---

## 3. TOKENS

All values below live in `src/ui/tokens.css` and nowhere else. Contrast figures
are computed WCAG 2.1 relative-luminance ratios, recorded here at authoring time
and re-measured against the rendered page by `scripts/browser/contrast.ts` (§9).

### 3.1 Theme policy

Both themes are real. `prefers-color-scheme` chooses the default;
`[data-theme="dark"|"light"]` on `<html>` overrides it and is persisted. Dark is
the tuned theme. **Light is drawn, not inverted** — it is warm paper with
graphite ink and its own darker chromatic values, because the dark hues are
unreadable on paper. Both themes are measured and both appear in the ratchet.

### 3.2 Neutrals

| Token | Dark | Light | Job |
|---|---|---|---|
| `--bg` | `#131211` | `#F5F1EA` | the page |
| `--surface` | `#1A1917` | `#FCFAF6` | a panel on the page |
| `--surface-2` | `#221F1D` | `#EBE5DA` | a band inside a panel |
| `--line` | `#332F2B` | `#D6CEC1` | hairline separators, 1px, always |
| `--line-strong` | `#726B63` | `#867E72` | control borders, the tape spine |
| `--ink` | `#F4F1EC` | `#1A1815` | primary text |
| `--ink-2` | `#B9B3AA` | `#4A453D` | secondary text |
| `--ink-3` | `#9A9289` | `#635C51` | metadata: counts, hashes, timings |

Measured, worst case across the three backgrounds it may sit on:

| Pair | Dark | Light |
|---|---|---|
| `--ink` on `--surface-2` | **14.54:1** | **14.13:1** |
| `--ink-2` on `--surface-2` | **7.87:1** | **7.58:1** |
| `--ink-3` on `--surface-2` | **5.34:1** | **5.27:1** |
| `--line-strong` on `--surface-2` | **3.12:1** | **3.20:1** |

`--line` is decorative separation only (1.23:1 dark / 1.24:1 light) and may
never be the sole indicator of an interactive boundary — that is
`--line-strong`, which clears the 3:1 non-text floor.

### 3.3 The four hues, and what each one means

There are four. Each has one sentence, and a token with no sentence is not a
token.

| Token | Dark | Light | Means |
|---|---|---|---|
| `--live` | `#F0A32E` | `#8A5A00` | the machine is doing this **right now** |
| `--ok` | `#7FB56F` | `#2F6B2A` | a check passed, a tool returned clean |
| `--fail` | `#F0655C` | `#B32219` | a tool threw, a turn died, a probe refused |
| `--attn` | `#7FB0E0` | `#1F5C93` | it stopped and **the next move is yours** |

Measured, worst case across the three backgrounds:

| Pair | Dark | Light |
|---|---|---|
| `--live` | **7.79:1** | **4.73:1** |
| `--ok` | **6.82:1** | **5.14:1** |
| `--fail` | **5.24:1** | **5.30:1** |
| `--attn` | **7.17:1** | **5.56:1** |

`--live` doubles as the focus ring (8.90:1 dark / 5.26:1 light against `--bg`,
clearing the 3:1 non-text floor with room). Two tinted fills exist for chips,
and nothing else is tinted:

| Token | Dark | Light | `--ink` on it |
|---|---|---|---|
| `--live-fill` | `#3A2A10` | `#F6E4C0` | 12.27:1 / 14.15:1 |

Discipline, stated as a rule: **`--ok` and `--attn` never appear during a turn;
`--live` never appears after one.** Idle and waiting are both "not busy" — the
difference is who speaks next, and that distinction exists in the core, so the
interface must not flatten it.

### 3.4 Type

Self-hosted `woff2` subsets under `src/ui/fonts/`, **imported from source so the
bundler rewrites the URL with the basePath applied** — not served from
`public/`, where a `url()` resolves against the emitted stylesheet's path and
this repo has been bricked before (ARCHITECTURE §10.2 ruling 2). `font-display:
swap`. **No CDN `@import`** — it fails the airplane test, and cross-origin
subresources are the exact thing a COOP/COEP header silently kills. Both halves
are held by one assertion: zero 404s and zero cross-origin requests in the built
export's network log, served at a subpath (§9).

```
--font-chrome: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif
--font-bytes:  "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace
```

Seven steps. There are no others, and nothing is below 11px.

| Token | Size / line-height | Family | Weight | Use |
|---|---|---|---|---|
| `--t-display` | 40px / 44px | bytes | 600, `-0.02em` | front door masthead, once, on the Door only |
| `--t-title` | 24px / 30px | chrome | 600 | destination title, once per surface |
| `--t-head` | 16px / 22px | chrome | 600 | panel heads |
| `--t-body` | 14px / 21px | chrome | 400 | prose, labels, controls |
| `--t-bytes` | 13px / 20px | bytes | 400 | prompt, transcript, tool args, model text |
| `--t-meta` | 12px / 16px | bytes | 500, tabular | gutter, byte counts, hashes, timings |
| `--t-micro` | 11px / 14px | chrome | 600, `0.06em`, uppercase | slot numbers, status badges |

`--t-meta` and `--t-display` set `font-variant-numeric: tabular-nums`. A clock
whose digits change width is a moving decoration.

### 3.5 Space, radius, elevation

4px base, eight steps, nothing between them, plus one structural constant:

```
--s-1 4px   --s-2 8px   --s-3 12px  --s-4 16px
--s-5 24px  --s-6 32px  --s-7 48px  --s-8 64px
--rail-step 96px        the tape gutter, identical on every surface
```

```
--r-0 0     --r-1 2px   --r-2 4px   --r-3 8px
```

**A working surface uses `--r-0` and `--r-1` only.** `--r-2` is for controls,
`--r-3` for overlays and the front-door card. Rounded cards floating on a tinted
field are the generic-dashboard tell.

```
--e-0 none                                    working surfaces: separation is
                                              1px line + background step, never shadow
--e-1 0 2px 8px  rgb(0 0 0 / .35 | .12)       popovers, menus
--e-2 0 12px 32px rgb(0 0 0 / .50 | .16)      modals, the front-door card
```

### 3.6 Motion

```
--m-instant 90ms    control state: hover, press, focus
--m-quick   160ms   disclosure: a band expanding, a panel swapping
--m-settle  260ms   overlay and front-door entrance only
--m-tick    1000ms  the stalled-stream caret blink
--ease-out    cubic-bezier(.2,.8,.3,1)
--ease-inout  cubic-bezier(.4,0,.2,1)
```

Under `prefers-reduced-motion: reduce` every `--m-*` becomes `0.01ms` — not
`0ms`, because a zero-duration transition may never fire `transitionend` and
code that waits on it deadlocks. The caret stops blinking entirely and becomes a
static filled block.

---

## 4. THE SURFACES

**Six surfaces, one address each.** They do not nest. Five of them are
destinations listed in the rail — Workbench, Prompt, Context, Tools, Setup. The
sixth, the Door, is not in the rail: it exists only before configuration and is
replaced by the Workbench the moment an endpoint resolves. **A seventh surface
is a design change, not a feature.** Everything else is an overlay on one of the
six.

**A surface is an address, not a URL path.** There is one HTML document; each
surface is reached by `?panel=<id>`, declared on its `src/ui/shell/surfaces.ts`
entry (ARCHITECTURE §10.2 ruling 4). Six route segments would have meant six
prerendered documents, six hydration boundaries, and six chances for a
basePath-relative asset to resolve differently, in exchange for nothing this
product needs.

Two conditions make an address a measurable substitute for a route, and both
are law here because the measurements in §7 depend on them:

1. **The address is honoured on load**, not only by clicking the rail.
   `contrast.ts` and `geometry.ts` measure a surface *at rest*, and a surface
   whose empty state depends on configuration cannot be reached by driving the
   UI to it.
2. **Readiness is an attribute, never a delay.** Under static export the
   document is prerendered with no panel selected, so the addressed surface
   first paints after hydration. `Shell.tsx` sets `data-panel-ready="<id>"` when
   it has rendered, and every browser check waits on that. A timing-based wait
   is a check that passes on a fast machine and fails on a loaded one, which is
   a check that gets weakened until it is decorative.

The count matters beyond tidiness. The contrast ratchet (§7) is keyed *per
surface address*, so six addresses means six recorded floors, and
`scripts/browser/{contrast,geometry}.ts` iterate that same registry. A surface
added without a ratchet entry is a surface nothing measures.

Every surface handles five named states. **The empty state is designed first**;
it is what a stranger sees, and a state designed last is a state that ships as a
framework default.

### 4.0 The shell

A left rail (destination labels, `--t-micro`, no icons), a content column, and
on the Workbench a right column for the live prompt. Under 900px the rail
becomes a top strip and the right column becomes a bottom sheet. There is no
other breakpoint; this is a workbench, not a marketing site.

`Shell.tsx` resolves `?panel=<id>` on its first client render and sets
`data-panel-ready="<id>"` once the addressed surface has painted. That attribute
is the only synchronisation point the browser checks are allowed to use.

Persistent, in the rail's footer at `--t-meta`: endpoint host, model name, and
the session's cumulative token count. Those three facts answer "is it even
connected" without a click, and their absence is the most common first-run
confusion.

### 4.1 Door — the cold open (`?panel=door`, pre-configuration only)

**Job:** turn a stranger into someone with a running turn. It is the only
commanding surface in the product.

**Hierarchy:** (1) masthead at `--t-display` in mono; (2) one endpoint field
with its probe result; (3) the Connect action; (4) one line naming the
bring-your-own-key alternative. Nothing else.

**States**
- *Empty* — never truly empty: the field is prefilled with
  `http://localhost:11434/v1` and a probe has already fired. Prose above the
  fold is capped at **22 words**.
- *Loading* — the probe is in flight; the button reads `probing…` with the
  elapsed ms beside it, `--t-meta`. No spinner.
- *Resolved* — the button becomes `Connect to <model> at <host>` and the field
  gains a `--ok` hairline. This is the moment the wall stops being a wall.
- *Error* — **the important state.** Connection-refused and CORS-blocked are
  different failures with different remedies and are never collapsed into
  "could not connect". The engine hands the surface a closed `ProbeOutcome` —
  `ok · refused · cors · http · timeout` — with `elapsedMs`, so each remedy is
  selected by a case rather than by parsing an error string. CORS shows the exact `OLLAMA_ORIGINS` line with a copy
  button. Refused shows the host it tried. Both keep the field editable and the
  key alternative one click away.
- *Dense* — n/a; this surface has one job.

**Expressive budget:** the masthead, plus a single drafting-grid layer of
`--line` hairlines at ≤ 0.04 alpha. One element, one surface, bounded by token.
It does not appear on any other surface.

### 4.2 Workbench — watch a turn happen (`?panel=workbench`)

**Job:** the whole product. The tape, the composer, and the live prompt beside
it.

**Hierarchy:** (1) the tape — the sequence of events; (2) the composer, pinned;
(3) the live prompt column; (4) the turn's cost line.

Row kinds, all on the same spine: `you`, `thinking`, `tool →`, `tool ←`,
`observation`, `answer`, `retry`, `cost`. The kind is a `--t-micro` label in the
gutter under the step number, never an icon, never a colour alone.

**States**
- *Empty* — three starter prompts as one-click chips, and one line naming what
  the agent can currently reach (its declared tools, by name). A first-time
  operator learns the tool surface from the empty state rather than from docs.
- *Loading* — the request is out but no byte has returned: one row, step
  number, elapsed clock ticking, the word `inferring`. Never a spinner where a
  real elapsed number exists.
- *Streaming* — bytes append into the row with no per-token animation; the
  amber block caret trails the last glyph; the clock ticks; the composer stays
  live so the operator can steer mid-flight.
- *Error* — the failing row turns its spine segment `--fail` and carries the
  literal error text the tool or transport produced, verbatim, in mono. The
  session stays alive; a failed tool is a recoverable turn, not a dead page.
- *Dense* — a long turn collapses `thinking` and `tool ←` bodies to their first
  line with a byte count; the spine, steps and clocks stay. Collapsing hides
  bodies, never events.

### 4.3 Prompt — the inspector (`?panel=prompt`)

**Job:** show *how* the prompt was built. First-class, and on the Workbench it
is permanently beside the tape rather than behind a toggle.

The assembled prompt as stacked bands in slot order. Each band carries: its slot
number (the number *is* the order, so it is shown), the component name, eight
characters of its digest, whether this render came from the memo or was
recomputed, and its byte count. Click a band for its exact text — mono,
unwrapped, selectable. Foot of the stack: total bytes and the memo hit ratio,
the only two metrics this interface has and the two that mean something.

**States**
- *Empty* — the stack renders with zero turns: slot numbers and component names
  present, bodies empty, marked `not yet assembled`. The architecture is legible
  before the first turn.
- *Loading* — assembly is synchronous; there is no loading state, and inventing
  one would be a lie.
- *Streaming* — during a turn the band that was recomputed for this turn carries
  a `--live` left rule. Exactly one band at a time.
- *Error* — an assembler invariant failure renders as a band in `--fail` with
  the raised message verbatim. The assembler raises rather than repairs, and the
  interface must show the raise.
- *Dense* — bands collapse to one line each (slot · name · digest · bytes).

### 4.4 Context — the bytes on the wire (`?panel=context`)

**Job:** show *what was sent*. The Prompt surface is architecture; this is
evidence. Keeping them apart is deliberate: one can be right while the other is
wrong, and only this surface can prove what left the tab.

The body arrives as `turn/request { turnId, request }`, produced by
`Inference.describeRequest()`, so what this surface renders is the transport's
own account of what it sent rather than the interface's reconstruction of it.

The literal request body for the last call, as serialized — the messages array,
the tool declarations, the sampling parameters — in mono, unwrapped, selectable,
with a byte count per message and a total. What was elided by compaction is
shown as an explicit elision row with the count of what it replaced, never as a
silent gap.

**Above the body: the request line and every header, redacted.** Method, URL,
then one row per header in send order — name always in full, value only for the
declared-safe set, everything else as `<redacted, N bytes>`, and
`Authorization` as its scheme plus a byte count. The rule and its reasoning are
`ARCHITECTURE.md` §5.2; the design consequence is that **this surface answers
"was a key sent at all" without ever displaying one.**

Headers are here because a surface whose job is proving what left the tab, and
which shows only the body, is honest about the half it shows and silent about
the half that produces a 401. A byte count distinguishes the three cases an
operator actually faces — no header, an empty one, a plausible one — and the
distinction is the same one §4.1 refuses to collapse for the probe.

**The stated limit of this surface.** It shows the request as the *transport
describes it*, not as the socket saw it. A header the browser adds after
`fetch()` is called — `Origin`, `Referer`, `User-Agent`, `Content-Length`,
anything a service worker injects — does not appear here and **cannot**: the
page has no access to the final wire form. This surface therefore proves what
the harness *asked* to be sent. It cannot prove what the network stack sent, and
saying so here is the difference between a documented blind spot and an
undocumented one.

**States**
- *Empty* — `no request has been made from this tab yet`, plus the request
  *shape* that would be sent, so the surface teaches before it has data.
- *Loading* / *Streaming* — the body is fixed at send time; the response side
  fills in with its own byte counter.
- *Error* — a non-2xx shows the status line and the response body verbatim,
  untruncated, above the request that produced it.
- *Dense* — per-message collapse to role · byte count; total always visible.

### 4.5 Tools — what it may call (`?panel=tools`)

**Job:** the declaration is authoritative, so it must be visible. One row per
declared tool: name, the description in the model's own words, its parameters,
and its call count this session. Fed by `tools/list → tools/listed`, rendering
`Tool.declaration()` — the same declaration the model is shown. A tool that is not listed cannot be called.

**States:** *empty* — `this agent declares no tools` and where to declare them,
which is a legitimate configuration, not a failure · *loading* — n/a, the
declaration is static · *streaming* — the tool being executed carries the
`--live` rule · *error* — a tool whose last call failed carries `--fail` and its
last error text · *dense* — descriptions collapse to first line.

### 4.6 Setup — configuration (`?panel=setup`)

**Job:** endpoint and credential, model choice, the agent identity file, and
storage. Edited in place; no modal for anything non-destructive.

The identity file is edited as text in `--font-bytes`, because the model reads
it verbatim and the operator should see it the way the model does.

**States:** *empty* — same prefilled-and-probed pattern as the Door · *loading*
— probes show elapsed ms · *error* — same CORS/refused distinction, same
remedies · *dense* — sections collapse · *destructive* — clearing storage is the
one place a modal is permitted, and it is two-step.

---

## 5. THE COLD-OPEN JOURNEY

No server, no account. The user's own endpoint or key is the first step of
setup, and it must read as step one rather than as a gate.

**Local endpoint path (the default):**
1. Page loads at `/`. A probe against the prefilled `http://localhost:11434/v1`
   has already fired; the button resolves to `Connect to <model> at localhost`.
2. **Click 1** — Connect. Lands on `/work`, composer focused, tape empty, three
   starter chips.
3. **Click 2** — a starter chip. It fills *and* submits. Tokens begin arriving.

**Budget: 2 clicks, 0 typed characters, to a streaming assistant token.**

**Bring-your-own-key path:**
1. **Click 1** — "use a hosted key instead". The field swaps and takes focus.
2. Paste (⌘V — one paste, not a click). Provider is inferred from the key
   prefix; no provider dropdown.
3. **Click 2** — Connect.
4. **Click 3** — a starter chip.

**Budget: 3 clicks, 1 paste, 0 typed characters.**

These are ceilings, not observations. `scripts/browser/coldopen.ts` drives the
built export served at a subpath, waits on `data-panel-ready="door"`, and fails
if either count is exceeded (§9). If a future
feature needs a fourth click on the local path, it is a design change and needs
a ruling.

---

## 6. MOTION

Motion exists to show that something moved, or to report a fact. It never
decorates.

- **Streaming is the signature moment and it is deliberately still.** Text
  appends with no animation. Animating arriving tokens costs a reflow per token
  and reads as instability at exactly the moment the operator is reading
  fastest. The one moving mark is the caret: a solid `--live` block, `0.5ch` ×
  `1em`, trailing the last glyph, steady while bytes flow. The gutter clock
  ticks at 100ms in tabular figures.
- **The stall blink carries information.** If no byte arrives for 1.5s the caret
  begins blinking at `--m-tick`. That blink is the answer to "is it hung", which
  is otherwise unanswerable without a network panel.
- **Controls** change state over `--m-instant`, `--ease-out`.
- **Disclosure** — a prompt band expanding, a dense row uncollapsing — over
  `--m-quick`.
- **Entrances** at `--m-settle` exist only on the Door and on overlays. The tape
  does not fade in. A new row appears.
- **Nothing else animates.** No skeletons, no shimmer, no progress bars, no
  spinners where an elapsed number exists.
- **`prefers-reduced-motion: reduce`** sets every `--m-*` to `0.01ms` and makes
  the caret static. It is checked (§9), because a reduced-motion policy nobody
  measures is a comment.

---

## 7. ACCESSIBILITY FLOOR

Non-negotiable:

- **4.5:1** for all text against its actual resolved background, in both themes,
  on every surface address, at rest and focused. Transparency resolves up the ancestor
  chain; a measurement against the intended background is not a measurement.
- **3:1** for interactive boundaries and focus indicators (`--line-strong`,
  `--live`).
- **Colour is never the only channel.** Every status carries a text label. The
  eight tape row kinds are readable in greyscale.
- **Visible focus everywhere**, keyboard reachable in DOM order, with a skip
  link to the tape.
- **Minimum 11px**, and 11px only uppercase and tracked.
- **`prefers-reduced-motion` honoured** as §6.
- Live regions: arriving tokens are `aria-live="off"` with a per-row polite
  announcement on completion. Announcing every token is unusable.

**The ratchet.** `scripts/browser/contrast-ratchet.json` records the worst
measured ratio per surface address, per theme, and the pair that produced it —
beside its check, in the same idiom as `checks/lines.json`.
`scripts/browser/contrast.ts` measures the rendered build, navigating by
`?panel=<id>` and waiting on `data-panel-ready`, and fails if any surface
regresses below its recorded worst. **The file only ever goes up.** Lowering a
number is a design change requiring a ruling, and the diff makes it visible.
Seeding happens on the first green measurement of increment 6.2; until then
every surface's floor is the 4.5:1 hard minimum. Six entries, one per
`surfaces.ts` address; an entry with no surface and a surface with no entry are
both failures.

---

## 8. WHAT THIS DESIGN REFUSES

- **Decoration with no informational job.** Every mark answers a question an
  operator actually has. A gradient answers none.
- **A loud front door with a loud middle.** If the Workbench also shouts, the
  Door's shout carries no signal. The middle is quiet so the front door can mean
  something. *(And the inverse, per §1.1: a middle so austere the front door was
  never built.)*
- **Happy-path-only states.** Empty and error are designed before streaming.
  A surface whose error state is "an alert()" is unfinished.
- **Framework default aesthetics by inaction.** Adopting a component library's
  look because nobody chose one is still a choice, and it is this project's
  worst available outcome given that legibility is the product.
- **Speech bubbles, avatars and chat affordances.** They model two people
  talking. This is one person watching a machine.
- **Spinners and skeletons.** A real elapsed number and a named operation
  (`inferring · 4.2s`, `web_search · 0.8s`) is strictly more information for
  strictly less motion.
- **Glassmorphism.** Blur costs a compositor pass per frame, drops resolved
  contrast below what any static measurement predicts, and is the single most
  copied dark-dashboard look in existence. It fails the identity test by
  construction.
- **A component library, and runtime dependencies in the interface.** Zero, as
  in the core.
- **Modals for anything non-destructive.**
- **CDN fonts.** They fail the airplane test and die under COEP.
- **Emoji as iconography.**

---

## 9. THE CHECKS

A rule the build cannot execute is a rule that will quietly stop applying. For
each rule: the check, the **target it names**, or an honest admission that there
is none.

### 9.0 A path change is a check change

Recorded because this document produced the defect and nearly shipped it.
`check-tokens.js` was written to grep `app/`. Tokens then moved to `src/ui/`,
and that check would have scanned a directory containing no tokens and **passed
with every colour literal in the tree** — LESSONS defect 7, a test that cannot
fail, inside the enforcement section of the document whose whole thesis is that
an unexecutable rule stops applying.

Two consequences are law here:

- **Every row below names its target.** A check with no stated target cannot be
  audited when files move, and files move.
- **`checks/design.ts` takes its scan roots from one exported constant**
  (`SCAN_ROOTS`), covering **both** `src/ui/**` and `src/app/**` with
  `src/ui/tokens.css` as the sole exemption. Both, because `src/app/globals.css`
  and `src/app/layout.tsx` are interface files too and a scan of `src/ui/` alone
  reintroduces the same hole one directory over.

Per ARCHITECTURE §10.2 ruling 3 the static checks are named sub-checks of
`scripts/checks/design.ts`, **each with its own failure message** — a gate that
fails with `design check failed` is not actionable, and a check nobody can act
on gets disabled. The four browser checks are separately invocable and are
**not** in `bun run gate`; they need a build and a real browser and run in the
deploy path beside the smoke check.

### 9.1 Enforced

| Rule | Check (sub-check) | Target it names |
|---|---|---|
| Tokens are the only literals | `checks/design.ts` · `tokens` — hex, `rgb(`, `hsl(`, bare `px`/`ms` | `SCAN_ROOTS`, exempting `src/ui/tokens.css` |
| Seven type steps, no others | `checks/design.ts` · `ramp` — `font-size`/`line-height`/`font-family` must resolve to a `--t-*` or a family token | `SCAN_ROOTS` |
| Reduced motion zeroes every duration | `checks/design.ts` · `motion` — **two targets**: every `--m-*` has a `prefers-reduced-motion` counterpart, *and* no literal duration in `transition`/`animation` | `src/ui/tokens.css` for the override block; `SCAN_ROOTS` for the literals |
| Door prose ≤ 22 words above the fold | `checks/design.ts` · `frontdoor-copy` | `src/ui/surfaces/Door.tsx` |
| Fonts are imported from source, never `/`-absolute | `checks/design.ts` · `fonts` — every `@font-face` `src:` is a bundler-rewritten import | `src/ui/fonts/`, referenced from `src/ui/tokens.css` |
| Every surface is addressable and its address is unique | `checks/design.ts` · `addresses` | `src/ui/shell/surfaces.ts` |
| Contrast 4.5:1 text / 3:1 non-text, both themes, every surface | `scripts/browser/contrast.ts` — rendered build, transparency resolved up the ancestor chain, at rest and focused | six `?panel=<id>` addresses, gated on `data-panel-ready` |
| The ratchet only goes up | same, vs `scripts/browser/contrast-ratchet.json` | one entry per address, six today |
| Working surfaces use `--r-0`/`--r-1` and `--e-0` only | `scripts/browser/geometry.ts` — computed `border-radius`, `box-shadow` | the five non-Door addresses |
| At most one chromatic element at rest | `scripts/browser/geometry.ts` | all six addresses, no turn running |
| Model-facing bytes are set in mono | `scripts/browser/geometry.ts` — every `[data-bytes]` element's computed `font-family` is `--font-bytes` | all six addresses |
| Cold open ≤ 2 clicks local / ≤ 3 BYOK | `scripts/browser/coldopen.ts` — counts clicks to a rendered assistant token | `?panel=door` on a served subpath |
| **The front door's expressive layer actually renders** | `scripts/browser/frontdoor.ts` — computed style of the masthead and grid layer is not the inert fallback | `?panel=door` in the built export |
| Zero 404s and zero cross-origin requests | `scripts/browser/frontdoor.ts` — network log of the built export **served at a subpath** | the whole document; this is what holds §3.4's font ruling either way |

### 9.2 Unenforced, stated plainly

| Rule | Why not, and what would fix it |
|---|---|
| Every surface renders all five named states | Reviewed by the ui-director per surface. A state-gallery address (`?panel=states`) would make it enforceable and is a candidate for 6.2 — it would be a seventh entry in `surfaces.ts` and therefore needs a ruling under §4 |
| That a model-facing render remembered `data-bytes` | The check proves the attribute's styling, not its application. A render that forgets the attribute is invisible to it |
| The identity test (§2) | **Unenforced by construction.** A human puts a screenshot beside three dashboards. Named so it is not mistaken for covered |
| Information hierarchy and empty-state copy quality | Judgement |

## REPORT

**DIRECTION:** Build the agent's workbench as a numbered tape running down a
warm graphite page — the machine's work printed in mono against a fixed
measurement gutter, achromatic except for one amber mark on whatever is
happening right now.

**TOKENS:** `src/ui/tokens.css` is the sole literal store. Warm-graphite neutrals
(dark `#131211`/`#1A1917`/`#221F1D`, light `#F5F1EA`/`#FCFAF6`/`#EBE5DA`) with
three inks each; four hues with one sentence apiece (`--live` amber, `--ok`
moss, `--fail` red, `--attn` slate-blue) plus one tinted fill; IBM Plex Sans for
chrome and IBM Plex Mono for bytes and display, seven steps 40/24/16/14/13/12/11;
4px space scale plus `--rail-step: 96px`; radii 0/2/4/8 with working surfaces
capped at 2px; three elevations with `--e-0: none` on working surfaces; three
durations 90/160/260ms plus a 1s stall tick, all `0.01ms` under reduced motion.

**SCREENS:** Door (cold open, the one commanding surface) · Workbench (the tape,
composer, live prompt) · Prompt (the inspector — how it was built) · Context
(the wire bytes — what was sent) · Tools (the authoritative declaration) ·
Setup. **Six surfaces in one document**, addressed `?panel=<id>`, five of them
in the rail; the Door is pre-configuration only. Five states each, empty
designed first.

**MEASURED:** Worst text pair `--ink-3` on `--surface-2` — **5.34:1 dark /
5.27:1 light**, against a 4.5:1 floor. Worst non-text `--line-strong` on
`--surface-2` — **3.12:1 dark / 3.20:1 light**, against a 3:1 floor. Focus ring
`--live` on `--bg` — **8.90:1 / 5.26:1**. Cold open — **2 clicks, 0
keystrokes** local; **3 clicks, 1 paste** BYOK. Door prose above the fold —
**≤ 22 words**. Surfaces — **6** (5 in the rail + the Door), one address each.
Type steps — **7**. Hues — **4**.
Chromatic elements visible at rest — **≤ 1**.

**VERDICT:** `UI: NOT YET — the ratchet file has no measurements in it.` Every
number above is computed from the palette, which is the right way to author it,
but nothing here has been measured against a rendered page. The law is
shippable; the proof is not. It clears when 6.2 renders the primitives and
`scripts/browser/contrast.ts` seeds `scripts/browser/contrast-ratchet.json` with
six entries from a real build served at a subpath.
