# ADE — what HARNESS is, and the four surfaces you can choose between

Written 2026-08-23, against the owner's ruling that eight rounds of type and
spacing work "uplifted nothing". It is not a style document. UPLIFT-FINDINGS F8
established that the defect is the information architecture, so this one starts
from what the product IS and derives the screens from that.

Everything here is written to be measured. §6 is the exit criteria and every
line of it is a number a command can read off the running page.

---

## 1. The product, in one sentence

**HARNESS is an agent development environment: you give an assistant work, you
watch it do the work, and you shape the assistant that does it — all three in a
browser tab, against a model endpoint you own.**

Three verbs. ASK, WATCH, SHAPE. That sentence is the whole IA and everything in
§3 falls out of it.

The end state the owner named is "a better Jarvis". Jarvis is not a chat window.
Jarvis is a thing you *talk to*, that *goes and does something*, and that *shows
you what it did* without being asked. The distance between that and what ships
today is not decoration:

- you cannot talk to it without first finding a composer three scrolls down
- what it did is split across three sibling navigations
- the one act it exists for is below the fold at both sizes (F8)

## 2. What is wrong, restated as structure

| today | the defect |
|---|---|
| 7 flat nav entries, 2 of them builder instrumentation | no rank; a user and the person building the product get the same map |
| Chat, Tool trace and Debug are siblings | ONE run is one continuous event, shown as three destinations |
| Dashboard is identity + tagline + stat table | the front door spends its whole first screen on prose |
| voice lives inside the composer, below the fold | the Jarvis affordance is the hardest control to reach |
| speech out has no representation in the UI | the assistant can talk and the interface never shows it talking |

## 3. The three surfaces

Every screen in the product is one of three things. This replaces the seven.

### ASK — the front door
The task field is the first interactive thing on the first screen, at every
width, with nothing above it but the agent's identity and its state. Voice is a
peer of the keyboard here, not a sub-control of it. Below the field: what is
running right now, and what ran last. Nothing else.

### WATCH — one run, one surface
The conversation, the stages of the loop, the tool calls, the shell output and
the files a turn wrote are ONE timeline, interleaved in the order they happened.
A tool call is an inline frame in the transcript, not a separate destination you
have to correlate by timestamp. Chat + Tool trace + Debug collapse into this.

### SHAPE — the ADE proper
The agent's own file, the roster, the endpoint, the space, the appearance. This
is where the environment part of "agent development environment" lives: you edit
what the agent IS, and WATCH shows you the effect.

Debug and Design system stop being nav entries and become what they are: reached
by URL, linked from where they are relevant.

## 4. The four themes

The owner asked for three or four directions to choose between on **feel,
functionality and look**. A token swap only answers "look", so a theme here is
allowed to change composition and emphasis too. The three surfaces of §3 do NOT
change between themes — that is the ground-up fix and it is not a matter of
taste. What changes is what an assistant that works LOOKS and FEELS like.

| theme | reference | ASK is | WATCH is | primary input | density |
|---|---|---|---|---|---|
| **Halo** | ambient assistant / Jarvis | one orb, one field, centred | a column rising under the orb | voice | airy |
| **Console** | Hermes, ops dashboards, tmux | the log, with a prompt at its foot | interleaved log, inline tool frames | keyboard | dense, monospace |
| **Gallery** | Google AI Edge Gallery | a hero task card over agent cards | expandable cards and chips | touch | roomy, rounded |
| **Atelier** | editorial ADE, split-pane coding agents | a field beside the agent's source | side by side: source left, run right | keyboard | editorial |

Each is reachable at `?theme=<slug>`, stored per device, and applied before the
first paint. Themes are additive: the default remains what ships today until the
owner picks, so choosing costs nothing and reverting costs nothing.

## 5. Rules a theme must not break

A theme may change layout, order and emphasis. It may not change these:

1. **The seam.** All UI interaction still goes through `handle(Request)`.
2. **The three surfaces.** A theme cannot invent a fourth destination or drop one.
3. **Every gate.** Contrast, tap target, reduced motion, keyboard order, the
   six font sizes, the spacing scale, the 200-line ceiling.
4. **Offline.** No webfont, no CDN, no JS library, no network for chrome.
5. **One file.** A theme's rules live in exactly one stylesheet whose every
   selector is prefixed with its own attribute, so G1 cannot be broken by adding
   a theme.

## 6. Exit criteria — the numbers this round is judged on

Measured with `scripts/measure-app.sh` on the real build, at 390x844 and
1440x900, in every theme:

| # | claim | measure |
|---|---|---|
| E1 | the task field is on the first screen | top of the task input < viewport height, both widths |
| E2 | it is the FIRST interactive thing | no `button`/`input`/`a` painted above it except identity and state |
| E3 | voice is on the first screen | the dictation control's top < viewport height |
| E4 | one run is one surface | the tool calls of a turn are in the same scroll container as the turn |
| E5 | the map is short | nav entries <= 3 |
| E6 | speech out is visible | while speaking, a live region says so |
| E7 | thumb reach on a phone | primary controls' centre y > 55% of viewport at 390x844 |
| E8 | every theme passes every existing gate | the six checks, in each theme |

An unexecuted claim is not a verified claim (I17), so each row above becomes an
assertion in the probe before the round can close.
