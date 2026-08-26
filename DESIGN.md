# DESIGN.md — the design law

One file declares every value: `app/tokens.css`. Nothing else may write a
colour, a size, or a duration. A component that needs a new value adds it here
first.

---

## 1. What this thing is

An **instrument**, not a chat app.

The application's one claim is that it constructs a good prompt. Every other
agent interface in existence hides the prompt behind a speech bubble. This one
puts it on screen, live, in pieces, and lets you watch the cache stay warm. If a
visitor learns one thing from the page it should be *how the prompt is built* —
that is the product, and the interface is the only place it is visible.

So: dense, honest, quiet. The screen of someone who is working, not the landing
page of someone who is selling.

## 2. The reject list

Written first, because it is the part that gets ignored.

- No rounded-rectangle cards floating on a tinted background.
- No purple-to-blue gradient. No gradient text. No glow.
- No emoji as iconography.
- No animated skeleton loaders. If it is loading, say what it is loading.
- No centred hero paragraph explaining the app to a user who is already in it.
- No speech bubbles. A transcript is a transcript; it is tagged `[USER]:` and
  `[ASSISTANT]:` in the actual prompt, and that is how it reads best on screen.
- No spinner where a real progress fact exists. "inferring, 4.2s" beats a spinner.
- No modal dialogs for anything that is not destructive.
- No component library. No framework. Zero runtime dependencies, in the
  interface exactly as in the core.

## 3. The four destinations

| Destination | What it is for | The one thing it must show |
|---|---|---|
| **Converse** | talking to the agent | the transcript, and the prompt inspector beside it |
| **Flow** | watching a run happen | which phase is live, and the session blackboard filling in |
| **Roster** | who is loaded and what they may call | the state table, one row per agent, updating |
| **Bench** | configuration | models, agents, skills, the space, the schedule — editable in place |

Four, and they do not nest. A fifth destination is a design change, not a
feature.

## 4. The signature view: the prompt inspector

It is always beside the conversation, never behind a toggle.

The assembled prompt, rendered as **stacked bands in slot order** — soul, system,
context, skills, phase, history, tools, response. Each band carries:

- its slot number (`0`, `10`, `20`…) — the number *is* the order, so show it
- its component class name
- the first eight characters of its `key()`
- whether this render came from the memo or was recomputed
- the byte count

Click a band to see its exact text, monospace, unwrapped, selectable. The
CONTEXT band is marked as never-cached, because that is a fact about the
architecture worth teaching.

Under the stack: the total byte count, and the memo hit ratio for this turn.
Those two numbers are the only "metrics" the interface has, and they are the
two that mean something.

## 5. Type

Two families, and a strict rule about which is which:

- **Chrome** — labels, navigation, controls, prose. A grotesque with real
  weights. `Inter Tight`, falling back to `system-ui, -apple-system, Segoe UI,
  sans-serif`.
- **Bytes** — the prompt, the transcript, every model-facing string, every path,
  every key hash. A monospace. `JetBrains Mono`, falling back to
  `ui-monospace, SFMono-Regular, Menlo, monospace`.

That split is load-bearing and not decorative: **if the model sees it, it is set
in mono.** A reader can tell at a glance which bytes are the product.

Ramp — six sizes, no others:

```
--type-display  2.0rem / 1.1   600   the destination title, once per screen
--type-heading  1.25rem / 1.25 600   section heads
--type-body     0.9375rem/1.5  400   prose and labels
--type-mono     0.8125rem/1.55 400   prompt bytes, transcript, paths
--type-small    0.75rem / 1.4  500   band metadata, state rows
--type-micro    0.6875rem/1.3  600   slot numbers, badges; uppercase, tracked
```

## 6. Space

One scale, powers of a 4px base, and nothing between the steps:

```
--space-1  4px    --space-2  8px    --space-3  12px
--space-4  16px   --space-5  24px   --space-6  32px
--space-7  48px   --space-8  64px
```

Layout is a three-column grid on wide screens — rail, centre, inspector — and it
collapses to a single column with the inspector as a bottom sheet under 900px.
Nothing else is responsive; this is a workbench.

## 7. Colour

Dark first, because that is where this work happens, and light supported
properly rather than as an inversion. Both are declared in `app/tokens.css`
under `:root` and `@media (prefers-color-scheme: light)`, with a
`[data-theme]` override that wins in both directions.

Roles, not names — a component names the role and never the hex:

```
--bg          the page
--surface     a panel on the page
--surface-2   a band inside a panel
--line        hairline borders — 1px, always
--ink         primary text
--ink-2       secondary text
--ink-3       metadata
--accent      the live thing: the running phase, the focused band
--warn        a degraded state: a skipped skill, a missed job
--fail        a failed tool, a failed verify, a dead worker
--ok          a passed check
```

One accent. Not a palette of six. The accent means *this is the thing happening
right now*, and if three things are accented at once the design has failed.

Every foreground/background pair ships at **4.5:1 or better**, measured, and
the measurement is a gate — see §10.

## 8. State, honestly rendered

The state table has six statuses and they must read differently at a glance
without relying on colour alone:

```
starting   its worker exists, its agent is still being built
idle       loaded and doing nothing
working    inside a turn — inferring, or running a tool, or summarising
waiting    it answered, and the next move is yours
failed     it did not load, or its last turn threw
closed     its worker is stopped
```

`idle` and `waiting` are both "not busy"; the difference is who speaks next.
That distinction exists in the core and the interface must not flatten it.

## 9. Motion

Motion exists to show *that something moved*, never to decorate.

- 120ms for a state change on a control.
- 200ms for a band expanding.
- Nothing else animates. The transcript does not fade in. The phase graph does
  not draw itself.
- `@media (prefers-reduced-motion: reduce)` sets every duration to 0ms, and that
  is checked.

## 10. The gates this file is subject to

A design law that is not executed is a preference.

- **contrast** — every foreground/background pair on every destination, in both
  themes, measured against 4.5:1 with a ratchet that only goes up.
- **tokens** — no colour, size or duration literal anywhere in `app/` except
  `tokens.css`. Grepped.
- **the ramp** — no `font-size` outside the six declared steps. Grepped.
- **reduced motion** — every declared duration has a zeroed counterpart.

`bun run gate` runs all four.
