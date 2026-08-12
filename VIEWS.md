# VIEWS.md — the map

What the left rail navigates between, why each one earns a slot, and what
deliberately does not get one.

Evidence: `reference/HERMES.md` (Nous Research's Hermes Agent, its shipped web
dashboard, and a nine-product nav survey), `reference/NGX.md` (ngx-admin's
measured dashboard layout), and the seam's own route table.

---

## 0. They are called **views**, not sections

`Section` is already a normative domain term in this codebase — a part of the
context Document, with a stability class and a compaction rule (`GLOSSARY.md`
line 60, `DOMAIN.md` §2, ADR-009). `DOMAIN.md` goes further: *"sections are
modules"*. A nav item is a different thing entirely, and reusing the word would
put two incompatible meanings on the most-typed noun in the repo.

So: **views** in code and in the UI. Where this document says "view", the
request said "section", and they mean the same thing.

---

## 1. What the app actually does

Fourteen routes across eight nouns. Everything below is derived from these, not
from what a dashboard usually has:

| Noun | Seam routes | Owner today | Lives today in |
|---|---|---|---|
| Chat | `GET/POST /chat`, `POST /chat/stop` | `chat.rs`, `composer.rs`, `turn.rs` | centre stage |
| Roster | `GET/POST /agents`, `POST /agents/delete` | `authoring.rs` | Setup deck |
| Agent file | `GET /agents/file` | `agentfile.rs` | Setup deck |
| Board | `GET /board` | `board.rs` | right rail |
| Tools | `GET /tools` | `tools.rs` | right rail |
| Workspace | `GET/POST /terminal` | `terminal.rs` | right rail |
| Space | `GET /space` | `space.rs`, `inspector.rs` | right rail |
| Status | `GET /panels/status` | — | header |
| Models & keys | **not the seam** — ADR-006 broker | `settings.rs` | Setup deck |

The shape of the problem, stated plainly: **four of eight nouns are crammed into
one rail, three more into a single "Setup" tab, and the most valuable navigation
real estate in the layout is spent listing five agents.** Agents is not the
navigation. Agents is one view.

---

## 2. The views

Six. Five were argued for below; the sixth was decided against this document
and is recorded in §7.

| # | View | Renders | Backed by |
|---|---|---|---|
| 0 | **Dashboard** *(default)* | the masthead, the agent board, the tool trace, the workspace and the shared space, as one grid of components | `GET /` + the panels' own routes |
| 1 | **Chat** | the conversation, the composer, the agent tab strip | `/chat` |
| 2 | **Agents** | the roster, and the `agent.md` reader/editor | `/agents`, `/agents/file` |
| 3 | **Memory** | the shared space: facts, notes, workspace path, and what each agent still holds after a compaction | `/space` |
| 4 | **Trace** | tool calls, their arguments, results and refusals — the event log admitting it is one | `/tools` |
| 5 | **Settings** | models, endpoint, keys, appearance — one page with a filter column, not five nav entries | broker + `models.json` |

### Why each earns a slot

**Chat** is the product. Agent switching stays a **tab strip inside this view**,
not five nav entries — `DESIGN.md` §9 already names "switch agents" as one of the
two interactions that must feel good, and a route change is heavier than a tab.
The Jarvis-on-Hermes console this was researched against reached the same
conclusion from the opposite direction: its entire navigation is three buttons,
and agents are not among them.

**Agents** is the only screen in the product that is a real editor. It is ASKK's
equivalent of Hermes' Skills page — hand-edited markdown that changes behaviour —
and 5 of 9 surveyed products give agents a top-level slot.

**Memory** is a deliberate bet *against* the category: only 3 of 9 products make
memory a view, and Hermes itself buries it in a System page plus a command
palette. Taking the position anyway, because ASKK's memory is bounded and
prunable, and a bounded store that silently overflows is a bug you cannot see.
It needs a capacity meter, which Hermes ships for exactly that reason.

**Trace** merges what the category splits. Products routinely ship `Logs`,
`Traces`, `Executions`, `Monitor` and `Analytics` as separate nav items; for a
single-operator tool that is a defect, not a feature. I8 says every view is a
projection of the event log — this is the view that admits it.

**Settings** is one page with a category filter, copied from Hermes' Config
(150+ fields, one page). Models, capabilities, appearance and storage are
**tabs within it**, not siblings of it.

---

## 3. What does NOT get a view, and why

| Not a view | Where it goes instead | Reason |
|---|---|---|
| **Models** | the composer, and a Settings tab | Hermes puts the model picker "just left of the microphone" and keeps a Models page only for the per-profile default. Models is a view only where models are the product (LM Studio, Open WebUI). Here the model is per-turn config. |
| **Board** (agent status) | the rail, on Chat and Trace | It is ambient state. Every real agent console surveyed keeps fleet status as a permanent meter, never a destination. |
| **Workspace / terminal** | the rail | Hermes' own desktop app puts the terminal in the right sidebar, not the nav. It is a tool you use *while* doing something else. |
| **Tool registry** | a Settings tab; individual calls render inline in Trace | Splitting "what tools exist" from "what tools did" into two views is the Logs/Traces mistake in miniature. |
| **Files** | nowhere | 1 of 9 products has a Files section. Files ride along with the thing that uses them. |
| **Forge** | nowhere, **yet** | The research recommended a conditional Forge view. It is specified in `DOMAIN.md` and **not implemented**: `dispatch.rs:182` returns `501 "tier-1 script modules land with the forge"`. A nav entry for an unimplemented feature is a lie in the most trusted part of the UI. |
| **Sessions, Cron, Channels, Webhooks, Pairing, Profiles, Plugins** | nowhere | Nine of Hermes' fourteen nav items exist because it is a daemon with twenty-plus chat platforms attached. ASKK is a browser tab. |
| **Evals, Users, Marketplace** | nowhere | Team and production features. This is a single-operator tool. |

---

## 4. The frame

The frame does not change — `header · nav · stage · rail` is already what both
real agent consoles converged on, and it is measured, guarded and green. What
changes is **what the nav contains**: five views instead of five agents.

From `reference/NGX.md`, the mechanisms worth taking:

- **The rail expands and contracts rather than being re-implemented.** ngx-admin
  gets 256px → 56px by putting `display: none` on the label, not by shipping a
  second template. One set of rules; the icon rail is a consequence.
- **Active item is a 4px edge bar with no background fill.** Cheaper than a fill,
  and it survives on glass, where a fill would fight the material.
- **Two independent viewport-height scrollers; the document never scrolls.**
  Already true here and guarded by ONESCREEN.

And what `NGX.md` says explicitly **not** to take, all three of which are right
for this product:

- Its single flat opaque surface token — correct for a six-theme CRUD template,
  wrong for a console whose visual thesis is elevation.
- Its fluid content column (`max-width: none`) — harmless for charts, destructive
  for a conversation. Folding the rail at 1600px gives a 140-character measure;
  the reclaimed width belongs in the margins, not the line.
- Its off-canvas menu with **no scrim** over live, non-inert content. On a console
  where a nav tap can start or stop an agent run, that is a hazard.

### Breakpoints

| Width | Nav |
|---|---|
| ≥1100 | labelled rail, 13rem |
| 768–1099 | icon rail, 3.5rem, labels `display: none`, `title` + `aria-label` carry the name |
| <768 | off-canvas over a scrim, closed by default |

1100 stays the fold threshold because the existing FOLD assertion measures
against it to the pixel and that assertion does not get to regress.

---

## 5. What each view puts in the rail

The rail is contextual. It is the answer to "what else do I need while I am
doing this", and it is different per view rather than being the same four
panels forever.

| View | Rail |
|---|---|
| Chat | Board (who is working) · live tool trace for this turn |
| Agents | the selected agent's status and origin |
| Memory | capacity meter · which agents share this space |
| Trace | the workspace terminal |
| Settings | nothing — it folds |

---

## 6. Open, and honest about it

- **The nav is not meant to stay hardcoded.** `DOMAIN.md` says modules serve
  "routes + dashboard fragments" and the registry generates Affordances, so the
  finished shape is a small fixed core plus module-contributed entries. This
  document specifies the core. The generated part lands with the module registry.
- **Memory as a view is a position, not a convention** (3 of 9). If it turns out
  to be a screen nobody opens, the fallback is Hermes' answer: fold it into
  Settings and reach the graph from a command palette.
- **A cost/quota meter is missing.** It is the one thing present in the permanent
  chrome of *every* console surveyed that has a real agent behind it, and its
  absence is the tell for a console built by someone who does not run agents.
  ASKK has no token accounting to render yet, so this is a note, not a view.

  **Closed 2026-08-12 (15E).** `EventKind::ModelCalled` is emitted for every
  model call whose provider reported usage, the chat projection carries the
  running total as `x-tokens`, and the header renders it beside the endpoint
  line. Tokens, not money: there is no price table in this build.

---

## 7. The Dashboard, decided against this document

This document made Chat the default and named no dashboard. The product goal
overruled it on 2026-08-12: *"the dashboard will be the initial side of the
application, with components where each component is based on the functionality
it offers."* The disagreement is recorded rather than quietly resolved, because
the reasoning below is still the reasoning — it is just outranked.

**Why §2 said no.** Every noun already has a view, and a dashboard that only
links to them is a menu wearing a screen's clothes. Mission-control screens
earn their place in products with more surfaces than a person can hold in their
head; this one has six.

**Why it wins anyway.** It is the only surface that answers *"what is this thing
doing right now"* across ALL agents at once — every other view answers it for
exactly one. That question is the product: an agent you hand an autonomous task
to and walk away from is worth nothing if coming back means checking six places.

**What it is, so it does not become a menu.** A grid of the SAME panel
components the rail holds — board, tool trace, workspace, shared space — not a
second implementation of any of them, and not a set of tiles whose only content
is a number and a link. The rail folds here, because the panels are already on
screen.
