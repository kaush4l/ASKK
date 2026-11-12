# Every box is a session

The owner's concept for the screen, said on 2026-11-11, and what follows from it. Sections 1
and 2 are the owner's. Section 3 is what herdr and Rex do, read from their docs. From
section 4 on, each choice that is mine is marked **(my call)** so it can be refused.

## 1. The concept

- **One kind of thing is on the screen: a box. A box is a session**: something that is
  running, that can be looked at and spoken to.
- **How deep a box can be seen into depends on the metadata there is about it.** A program
  askk only holds the terminal of shows its screen. An engine askk built itself shows its
  goal, what it learnt, its tools, and every stage of every run.
- **The default engine is an agent with a spec**: its goal, its learnings, its tools.
- **A terminal session is a session too**, the kind already supported.
- **The screen is two parts**: a pill on the left that folds away and opens into a
  dashboard, and a main canvas that shows every running session.
- **The multiplexer is the core**, as in herdr: the service holds the sessions, windows only
  look.
- **Sandboxing is native and chosen when the program is built**, because the build knows
  which system it is for.

## 2. Depth: what a box can show

One box, four depths. A box shows everything its depth gives and nothing it has to guess.

| depth | askk knows | because | the box shows | today |
| --- | --- | --- | --- | --- |
| 0 screen | that it runs, and its screen | the service holds its terminal | the live screen, a line to type into | built in the service (`core/terminals.rs`, `host/terminals.rs`) and in `askk terminal`, where a pane shows it and takes typing; the page does not draw it yet |
| 1 recognised | which agent it is; working, blocked or idle | the process name and what is on the screen | depth 0, with a state mark | built, first cut: the agent is told by its program's name (`host/harness/mod.rs`, `recognise`); the state is read off the bottom of the screen by a handful of patterns (`core/terminals.rs`, `guess`) and the box says it is a guess |
| 2 reported | each turn, the agent's own id for the conversation, its state as it says it | the agent's own wire or hooks (`core/session.rs`, `host/harness/`: claude, codex, muse) | the conversation, and it can be gone on with after a restart | built, one turn at a time |
| 3 spec | goal, learnings, tools, and each stage of each run | askk built it: an engine (`core/engine.rs`, its elements) | all of it: goal, notes, tools, the run stage by stage | built |

The state is the same word at every depth, so the pill can count them together:

| state | means | a depth 3 engine | a depth 2 session |
| --- | --- | --- | --- |
| working | it is doing something | a run is in hand (`busy`) | `Busy` |
| blocked | it waits for the owner | an ask is open | not known yet (needs the permission hook, `docs/sessions/009`) |
| done | it finished and this window has not shown it yet | last run ended since this window looked | last turn answered since this window looked |
| idle | finished and seen, or waiting | no run | `Idle` |
| failed | the last thing did not work; a sentence says why | run ended in an error | `Failed` |
| unknown | askk cannot tell | — | — |

"Done" belongs to the window, not the service: two windows each keep their own (herdr and Rex
both do this).

## 3. What herdr and Rex do

Sources: herdr [concepts](https://herdr.dev/tui/docs/concepts/),
[quick start](https://herdr.dev/tui/docs/quick-start/),
[configuration](https://herdr.dev/tui/docs/configuration/),
[agents](https://herdr.dev/tui/docs/agents/). Rex (Superlogical, closed source)
[Mac settings](https://www.superlogical.com/rex/docs/reference/mac-settings.md),
[Mac actions](https://www.superlogical.com/rex/docs/reference/mac-actions.md),
[program status](https://www.superlogical.com/rex/docs/build/program-status.md). Neither was
installed or run; neither has a page called a walkthrough, so this is their quick start,
settings and actions read together. Earlier notes: `docs/sessions/009`, `010`.

| | herdr | Rex | askk takes |
| --- | --- | --- | --- |
| what it is | a terminal program over a background server | a native Mac app (iOS coming) over a server | a page, a Mac window and a terminal over one service |
| the things | session (a server) → workspace (a project) → tab (a layout) → pane (a real terminal); an agent is a process it recognises in a pane | server → session (a project) → window (a tab) → block (one application, today a terminal) | service → box. A box is the session; its place (project folder) groups boxes |
| left side | a sidebar with two lists: Spaces (workspace, branch, git state) and Agents (state mark, machine, workspace, tab, agent). A workspace's mark rolls up from its agents. Expanded on a desktop; "collapsed and mobile views keep compact layouts" | a sidebar that shows or hides (action, swipe). Sessions fold and unfold. An Activity view lists agents and programs "by session" or "by priority", with a filter field. Tabs can sit above, left or right | the pill: folded it is marks only; open it is the dashboard, sorted by what needs the owner first (Rex's "by priority"), groupable by place (herdr's Spaces) |
| main part | the focused tab: panes split right or down, borders dragged, one pane zoomed to fill | a tab's panes, tiled; split, balanced, zoomed; a pane can float and be minimised | the canvas: every running box, tiled; one box opened fills it |
| states | blocked, working, done, idle, unknown | working, blocked, error, done (idle only as a filter) | section 2 |
| how a state is shown | coloured dots, or one shape per state; never moving | working dots, progress pies, needs-attention dots and a message, on the tab; Dock badge; sound | one mark per state with a shape as well as a colour; working may move, and stops under Reduce Motion |
| how the state is known | process name and screen patterns; an integration or the agent itself reports instead when there is one. A new prompt it has not learnt shows as idle | the program says it, in a terminal escape (Program Status Protocol); hooks for agents | by depth: the engine knows, the agent reports, and only at depth 1 is it read off the screen and said to be a guess |
| getting to what needs you | click the agent in the sidebar; `prefix+alt+1..9` | "View Activity…", "Go to Anything…" | click the row in the pill; the blocked boxes come first on the canvas |
| look | themes; sidebar and row colours | "Glass" or "Classic"; panes "Comfortable" or "Compact"; animation "Snappy", "Natural" or "Off" | glass, on the tokens in `assets/styling/glass.css` |
| who holds the terminals | the server; a client is only the screen; detach leaves everything running | the server; each split is its own terminal connection; each client keeps its own scroll position | the service (section 6) |
| a restart | processes are gone; layout comes back; an agent that told its resume command is resumed | sessions outlive clients, not the server | a box of depth 2 or 3 goes on from disk; a depth 0 box is said to be lost |
| sandbox | none of its own; a wrapper may be used and named (`HERDR_AGENT`) | none; an agent has the authority of its process | chosen in the build, per box (section 7) |

What both confirm: the left side is where state is read, the main part is where work is seen,
and the two are the same list drawn twice. Neither can show more than a terminal, because a
terminal is all either has. Depth 2 and 3 are what askk adds.

## 4. The screen

| part | folded | open |
| --- | --- | --- |
| the pill | a narrow glass pill on the left: the mark of the brand, then one mark per running box in its state's colour and shape, blocked first; a number when they do not fit | the dashboard: boxes sorted blocked, failed, done, working, idle; each row is state mark, name, kind, place, its last line. Below: the service (version, since when, from `hello`), what this build can do, and the way to Settings |
| the canvas | fills the rest | the same, narrower |

- **A phone** has no room for both: the pill is a floating button, and the dashboard opens
  over the canvas as a sheet. The canvas is one column.
- **A tablet**: the pill stays folded until touched; the canvas is two columns.
- **A wide screen**: the pill opens and stays; the canvas fits as many columns as hold a
  readable box.
- **A box**: a head (state mark, name, kind, place), a body by depth (the screen; or the
  conversation; or the run stage by stage with goal, learnings and tools behind one touch),
  and a foot with one line to speak into. Touching the head opens the box to fill the canvas;
  the same touch puts it back.
- **Which boxes are on the canvas (my call):** those that are not idle, and those the owner
  pinned. The dashboard lists every box, idle ones too. An empty canvas says how to start one.
- **Tiles, not a free plane (my call):** the canvas today (`views/canvas.rs`) is a plane to
  pan and zoom, with a line from each engine to its sub-engines. Tiles read on every screen
  and are what both herdr and Rex do; the tree stays as a second view of the same boxes.
- **The rule for every part** (a test, `a_component_only_shows_what_it_is_given`): a
  component is given the box and draws it. It asks nothing itself.

## 5. One object, one answer

Every UI draws the same thing, so it is asked for once.

```text
core/boxes.rs       SessionBox { id, kind, depth, state, title, icon, place, last, facts }
                    made from an engine or from a session; nothing else decides state or depth
api  boxes()        every box; marked on the change feed when one changes
ui/features/boxes   the order (blocked first), the words for each state, what counts as running
ui/web              Pill (folded: marks; open: the dashboard), BoxRow, BoxTile: given boxes, draw them;
                    views/boxes.rs asks once for both and is the canvas (the view named `boxes`)
ui/terminal         /boxes: the same list as lines
```

The id says the kind (`engine:askk/developer`, `session:12`), as `docs/sessions/010` R3 asks.

## 6. The multiplexer

`docs/sessions/009` said holding terminals was "not for askk". The owner has now said it is
the core, so that line is reversed here.

| | decided |
| --- | --- |
| who holds a terminal | the service, which already runs in the background and outlives its windows (`askk start`, `docs/service.md`) |
| what a window gets | the screen as an object (rows of text with their colours), then the changes, over the change feed. **(my call)** The screen is worked out in the service, not in the page, so a page, the Mac window and `askk terminal` all draw the same object and none needs a terminal library of its own |
| typing | one answer: these keys, to this box |
| a restart of the service | its terminals end with it; the box says lost. Only depth 2 and 3 go on |
| a build with no processes (the browser tab) | says so in `capabilities` (`terminals`: not here); its boxes are depth 2 and 3 |

## 7. The sandbox, chosen in the build

A port in the core (`Sandbox`), with "not confined, and says so" as the default. Each build
fills it with what its system has, at compile time, so no build carries another's code:

| build for | a box's program is confined by | state |
| --- | --- | --- |
| macOS | the system's sandbox profile, one per box: it may write its own project folder and its agent's own state (`Harness::state`), and nothing else | built per box (`host/sandbox.rs`): a terminal's program writes only in its folder, in temp, and in its agent's state; held by `a_confined_program_cannot_write_outside_its_folder` and `scripts/terminals.sh`. The whole service can still be run confined as well (`scripts/sandboxed.sh`) |
| Linux | Landlock for files, with the kernel's call filter | built for files only (`askk confine`, Landlock): no call filter yet. A kernel without Landlock is noticed at start, and every box then says "not confined". Written and read against the library, but compiled and run on no Linux machine yet: the CI machines are the first to try it |
| Windows | nothing yet, and the box says so | as written: the build has no sandbox, the capability `sandbox` says so, and so does each box |
| the browser tab | the browser's own sandbox | built (`local/code.js`) |

A box's head says how it is confined. herdr and Rex leave this to whoever starts the agent.

## 8. Order of work

| step | what | proves | state |
| --- | --- | --- | --- |
| 1 | `SessionBox` and `boxes()` over engines and sessions | one list, tested | **built** |
| 2 | the pill, the dashboard, the canvas of tiles; `/boxes` in the terminal | the screen of section 4 on phone, tablet and wide, light and dark | **built**: a box opens in place (`/#<box id>`), boxes can be pinned, the pill groups by place, finds, and is resized |
| 3 | depth 0: a terminal held by the service, its screen as an object, typing | a shell in a box, in the page and in `askk terminal` | **built** in the service and in `askk terminal` (a full screen: sidebar, tabs, split panes); proved by `scripts/terminals.sh`. Not in the page yet: the answers and `ui/features/terminals.rs` are there for it |
| 4 | depth 1: recognising an agent in a terminal | a state mark on a terminal box, said to be a guess | **built**, first cut: by the program's name, with a few screen patterns; a wrapper (`npx`, a script) hides the name, and a prompt it has not learnt reads as idle |
| 5 | the sandbox port, macOS then Linux | a box that cannot write outside its folder, as a test | **built** on macOS, tested. Linux: written (Landlock through `askk confine`), with the same test, but not yet compiled or run on a Linux machine; CI is the first to try it. Files only on both: the network is not confined |

## 9. For the owner to say

- **"An agent spec supported agent"**: I read it as *an engine folder is the spec*
  (`engine.json`, `goal.md`, notes for the learnings, the tools element). If a format from
  outside is meant (a Claude Code agent file, or the Open Agent Spec), step 1 also reads and
  writes that format.
- Tiles as the first view, the tree as the second (section 4).
- Idle boxes stay off the canvas unless pinned (section 4).
