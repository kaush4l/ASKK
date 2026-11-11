# 000 Verdict: the engine carries sessions

Read the numbered files in order; each builds only on the ones before it.

| file | answers |
| --- | --- |
| `000-verdict.md` | what to build, in one page |
| `001-evidence.md` | what Claude's desktop app, T3 Code, dsh-superagent, Muse, Grok and askk really are, and what each design is shouting |
| `002-decisions.md` | the decision chart: fourteen choices, their options, who chose what, for, against, the pick |
| `003-spirals.md` | eleven wrong first steps and where each one ends |
| `004-architecture.md` | where every line of the session layer lives: folders, file names, the port, the walls |
| `005-drive.md` | the road from idea to working: seven stages, each with its proof |
| `006-goal-statements.md` | how to hand a stage to Opus or Sonnet |
| `007-workflow.md` | every object, its life, and the expected workflow, on the design of 2026-11-10: a session and an engine are peers, and input is an envelope to an inbox |
| `008-openbot.md` | what CopilotKit OpenBot does that askk does not yet, and where each gap closes in `005` |
| `009-herdr-rex-terax.md` | three hosts that own other agents' terminals; Terax answers the Claude permission wire |
| `010-rex.md` | Superlogical Rex: good and bad decisions from its docs, the structure they imply, the REA runtime plan | (parked)
| `011-composition.md` | one app with client and server inside; kinds declare typed parameters; recipes, bindings and packs so every element and engine is shareable without personal data |
| `012-architecture.md` | the whole application: shape, build facts, the sub-agent protocol, the gap analysis, and the step-by-step order from the skeleton |

**`007` is later than the rest and wins where they disagree.** The answer below says "the
engine carries sessions in one element"; the design now is that a session stands beside an
engine and envelopes relate them. What changed and what stands is listed in `007`, section 7.

## The answer (as first written)

**askk is a layer over real sessions, and its engines are what make the layer more than a
window.** An engine owns the work. A session — a real Claude Code, Codex or ACP conversation —
is who does the work this time. The engine carries its sessions in one element, exactly as it
carries its notes or its phases.

```text
            the person
          ╱            ╲
   talks to a session    talks to an engine          two doors (D6)
   (T3 mode)             (dsh mode)
          ╲            ╱
     elements/sessions.rs      cards, asks, tools       one element, one writer
              │
       core/session.rs         Harness port: items, turns, asks, Can
              │
     host/harness/<kind>.rs    claude · codex · acp · own · replay
              │
     the real session          its loop, its tools, its transcript
```

- **From T3 Code:** the layer runs no loop of its own for a session; one seam per harness;
  whole items, not streams; capabilities stated honestly; our id is identity, theirs is evidence.
- **From dsh:** the work is separate from the session; code decides structure and the model
  decides meaning; what needs the person comes first and health takes no space; a setup is a
  thing that can be handed over.
- **From neither:** T3 Code's own copy of every transcript (it is why its orchestrator is about
  14,700 lines), and dsh's machinery for many strangers talking to one agent.

## What it costs

| | |
| --- | --- |
| kept as it is | the six folders and their walls, `Store`, `Files`, `Infer`, `Component`, the loop, the change feed, the Asks page, the sandbox |
| added | one port (`Harness`), one element (`sessions`), one `Event` variant, one file per harness, one file that keeps sessions alive, one view |
| retired | the idea that Claude Code is reached as a model with its tools switched off |
| stages to "working" | three (`005`: contract, Claude straight through, the engine drives) |

Every one of the five designs studied has the same seam in the same place (`001`, last table).
askk has three ports of that shape already and is missing the fourth. Nothing has to be torn
down to add it, and 161 tests are green today.

## What this report did not settle

These are yours, and nothing in `005` goes past them without a yes:

1. **The order.** The engine drives sessions (stage 2) before a second harness (stage 3).
2. **One face** (stage 5): the engine's own conversation drawn by the session view.
3. **Packs** (stage 6): boot reads through layers in place of copying defaults.
4. **A commit of what is in the working tree now,** before stage 0.
5. **`AGENTS.md`:** the short standing rules in `006` above the Dioxus reference.

## What is still unknown

- The exact value that makes `claude` send its permission requests to a host over stream-json
  (seen in the SDK, not confirmed against the installed CLI). Stage 1 starts by capturing it.
- Whether the long-poll feed is quick enough for text as it is written (D11).
- Muse Code: not installed; its SDK was not read.
- No runtime evidence was taken from any app: everything in `001` is source, static reading,
  local help or vendor docs, and says which.
