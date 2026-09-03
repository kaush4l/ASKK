# The interface

What is on the screen, why it is there, and what it is allowed to look like.

`ARCHITECTURE.md` says how the app is built and `CAPABILITIES.md` says what it
can do. Neither says what a person meets when they open it, and for eight waves
that question was answered incidentally — by whichever slice last touched
`page.jsx`. This page is the answer written down, so that a change to the
interface can be argued with before it ships rather than after.

## The subject

A personal agent that runs entirely inside a browser tab. It brings no model. It
can search the web, run real commands in a Linux guest compiled to wasm, read
and write its own files, hand a question to a second agent, listen, and speak.
There is no server anywhere: what is deployed is a directory of static files.

The person opening it is technically literate and wants an agent they own and
can inspect. They are not a mass-market chat user, and the interface must not
pretend they are — but neither are they willing to read a manual, and every
version of this page so far has required one.

**The job, in one sentence: ask something, watch it work, and be able to check
what it did.**

## The three registers

Everything on screen belongs to exactly one of these, and the register decides
how it is set.

| | what it is | how it reads |
|---|---|---|
| **Conversation** | what was said, by either party | generous, quiet, proportional type, one column at reading measure |
| **Work** | what the agent DID on the way to an answer | a sentence per step, in the transcript, with the machine's own words folded underneath |
| **Evidence** | the prompt, the run, the files, the schedule, the agent | dense, monospaced, gridded, behind one control |

The old page had two registers and put the third's contents in the second's
clothing: a run step appeared as a raw `shell({"command": "uname -a"})` inside
the transcript, which is evidence wearing a conversation's position. Work is now
its own register — a readable line that says what happened, with the verbatim
call and its result one press away.

## What the top of the screen is for

Three zones and no more. The old rail had six controls of equal weight — `new`,
`settings`, `prompt`, `run`, `files`, `schedule` — which is six things to choose
between where there are three kinds of thing.

    ┌───────────────────────────────────────────────────────────────┐
    │  ASKK  ·  Chat ▾            ● working · 12s          ⧉    ⚙   │
    └───────────────────────────────────────────────────────────────┘
       identity   which           what is happening      evidence  settings
                  conversation    RIGHT NOW

- **Left** is identity and place: the wordmark, and the conversation you are in.
  The conversation name is a control, because `rename` and `remove` exist in the
  backend and nothing has ever called either. `list` IS called — it is how the
  app finds `conversations[0]`, which is the only conversation it has ever
  opened, for every wave of its life.
- **Middle** is one line, present tense, in words. Not a row of chips. The
  status rail used to render up to nine of them at once and a reader could not
  tell which one they were waiting for.
- **Right** is two controls. One opens the evidence drawer; one opens settings.

## What a first visit meets

The empty state is the most-read screen in this app and it was a paragraph.

A first visit has exactly one problem — **there is no model** — and the interface
now says so as a task rather than as prose, with the control that solves it
attached. Under it, three example questions that fill the composer when pressed.
They are there for recognition over recall: they are the only place a newcomer
learns that this thing can run a command or hand work to a second agent, and a
capability nobody can find is a capability nobody has.

    no model yet
    This app brings no model. Point it at one and it can answer.

    [ Connect a model ]

    Or try:  “run uname -a in the sandbox”
             “search for what changed in Safari 26”
             “write today's plan to plan.md”

When a model IS reachable the same three examples stay, under a single line
saying what the agent can do. An empty screen is an invitation to act.

## The step, which is the centrepiece

Now that `EventName.OBSERVATION` exists, a tool call has both halves and the
transcript can say what happened in a sentence.

    ●  Ran a command in the Linux guest                      1.2s   ⌄
       $ uname -a
       Linux localhost 6.1.0 … x86_64 Linux

The verb comes from the tool's NAME and nothing else — never from re-reading its
arguments. `Toolbox.parse` is the one thing in this application that decides
what a call is, and a second parser in the page would agree with it until the
day it did not, and on that day the page would draw a call that never ran. The
name is taken from the text before the first `(`; the argument text is shown
verbatim, exactly as `RunPanel` already shows it, and never interpreted.

Collapsed by default, because the answer is what was asked for. Expanded on
press, and expanded automatically for the step that is running, because the one
thing a person wants while waiting is evidence that something is happening.

## The evidence drawer

One control opens it. Inside, five sections on a segmented control:

    Run · Prompt · Files · Schedule · Agent

`Run`, `Prompt`, `Files` and `Schedule` are the existing panels. `Agent` is new
and needs no backend: `agents.get` has existed since `AgentService` was written
and had no caller. It shows the agent's instructions, its tools, its
budget and its MCP servers — which is the only place any of that has ever been
visible, and MCP has had no user surface at all.

On a screen wide enough it docks beside the conversation. Below that it is an
overlay with a shadow; on a phone it is a sheet from the bottom with a handle.
It is closed on a first visit. The machinery is the reason someone opened this
app, but not the first thing they need.

## The composer

    ┌──────────────────────────────────────────────────────────────┐
    │  ⊕   Ask anything                              ⏺        ↑    │
    └──────────────────────────────────────────────────────────────┘
      attach                                        speak     send

- **Attach** is new and wires the capability `CAPABILITIES.md` named as the
  standing example of built-and-never-connected. What is attached is read into a
  data URL in the page and shown as a chip above the field.
- **Speak** is the existing toggle. While it is on, the words appear in the
  field as they are revised, and a level meter under the button says the
  microphone is hearing something — an interface that says "listening" while the
  microphone is muted is the commonest way dictation is broken.
- **Send** becomes **Stop** while a turn is in flight, as it already does.

## Type

Two families and no third.

| role | face | why |
|---|---|---|
| interface, conversation | **Archivo** | an industrial grotesque with tight apertures and a real weight axis. It reads as an instrument rather than as a website, and it holds up at 12px, which is where most of the second register lives |
| every number, every label, every piece of the prompt | **JetBrains Mono** | tabular figures. A token count that shifts sideways as it changes is a readout nobody can read at a glance |

Scale, in px: `12 · 13 · 15 · 18 · 21 · 27`. Body is 15/1.65, and the answer is
18 — the working screen sat entirely between 12 and 17 until a reviewer measured
it and called that range, 1.42 from the smallest label to the largest body, not
a hierarchy. The conversation
is set to a 66-character measure and nothing widens it; the evidence register
ignores the measure entirely, because a wrapped command is a command a person
cannot copy.

## Colour

One rule survives from the previous direction because it earned its place:

> **Cyan means measured.** It marks a counted token, a duration, a byte count, a
> live thread. Nothing is cyan for emphasis, because then nothing cyan would
> mean anything.

There is no second accent. "Something is happening right now" is said with a
pulsing dot and a weight change, not with a hue — a second signal colour would
halve the meaning of the first.

    --ink      the page                --text     what is said
    --panel    the evidence register   --dim      what is said about it
    --raise    a control               --faint    what is there but not now
    --rule     the hard edge           --signal   measured
    --bad      a problem               --string   syntax only

Both schemes ship. The build declares `dark light` and the tokens are redefined
under `prefers-color-scheme: light`, because a person who has told their
operating system what they want has already answered this question. There is no
in-app toggle; a preference that exists in two places disagrees in one of them.

## Motion

One orchestrated moment and nothing else: the drawer's arrival. Streaming text
does not animate — it is already moving. Steps do not fade in; they appear where
they will stay, because a row that slides into place under a person's cursor is
a row they mis-press. `prefers-reduced-motion` removes all of it, as it already
does.

## What must not break

`scripts/smoke.js` and `scripts/deploy-check.js` drive this page in a real
browser by `data-testid`, and they are the only tests of the interface that
exist — there is no component test, no jsdom, no Playwright. **Every existing
`data-testid` keeps its name and its meaning**, and a new surface gets a new
one. A rebuild that renames them turns the gate red for a reason that has
nothing to do with whether the page works.

The layer rule holds: nothing in `src/app/` imports `backend/` or `core/`.
`test/architecture/layers.test.js` executes it. Every capability reaches the
page through `BackendClient` or through `src/client/`.

## What two strangers found, and what it cost

Two fresh-context reviewers drove the built page in a real browser, one before
this was written and one after it was built. They are the reason most of the
decisions above are decisions rather than taste, and three findings are worth
keeping here because they are the shape of the mistakes this interface makes:

**A capability wired to a surface nobody was told to look at is not wired.**
The steps were kept after the turn — in the drawer. The reply went on saying
"the step above shows where it came from" with nothing above it, and the second
reviewer reported the same defect as the first.

**A check that cannot fail is worse than no check.** The connection test called
`/v1/models`, had the model list in hand, rendered two words, and passed with a
model name that did not exist.

**A page that cannot lay itself out has faults no test in this tree could see.**
One `<option>` of 258 characters made the settings sheet 1,813px wide on a 390px
phone; a label that is itself a grid left a `<select>` overflowing the box that
had been correctly narrowed; the prompt is 4,149px of one line in a 366px column
and scrolling it dragged the whole panel away. All three are measured in
`scripts/smoke.js` now, at the width where they broke.

## The order this is built in

1. Tokens, type and the shell — `globals.css`, `layout.jsx`.
2. The header: conversation switcher, one status line, two controls.
3. The transcript: message, attachment, thinking, step-with-result, copy.
4. The composer: attach, dictation with a level meter, stop.
5. The drawer: the four existing panels, plus `Agent`.
6. Settings: the model first, everything else folded under it.
7. The native facilities: wake lock on a long turn, a notification when handed
   work finishes, the keyboard inset, storage.
8. Light scheme.

Each step ends green on `bun run lint && bun test` and the whole ends green on
`bun run check`.
