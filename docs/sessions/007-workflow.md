# 007 Workflow: every object, its life, and what is expected to happen

A first pass, high level, written to be corrected. It follows the design of 2026-11-10:

> The high level concept is either a session or an engine. A session is where we connect to
> another harness. Input is an envelope, and every engine or session gets an envelope to its
> inbox.

Where this file and an earlier one disagree, this one holds (see the last section). Lines
marked **yours** are places where only you know what is expected; each carries a provisional
answer so the rest can be read as a whole.

## 1. The objects

| object | what it is | it has | where it lives |
| --- | --- | --- | --- |
| **envelope** | the one form of input: something from someone, to someone | from, to, kind, about, body | the board (`board.json`) |
| **inbox** | where envelopes for one address wait | an address | the board; it is a view of it, not a second store |
| **engine** | askk's own loop: elements, a flow, a model | an address, an inbox, config, state, views | `engines/<path>/` |
| **session** | a connection to another harness's real conversation | an address, an inbox, config, state, views | `sessions/<name>.json` |
| **the person** | you | an address (`user`), an inbox (the Asks page, the waiting count) | — |
| **harness** | a program that runs an agent's loop | kind (code), instance (a value) | `harnesses.json`; `host/harness/<kind>.rs` |
| **configuration** | every knob a person writes | a key in the store | the data folder |

Two things with an inbox do work: an engine and a session. They are peers. Neither holds the
other. What relates them is envelopes.

**Yours 1.** The code needs one word for "anything with an address and an inbox" (engine,
session, person). Provisional: *member* (of the board). The board already treats `user` as one:
it has a box that is read and never woken.

### The envelope

```json
{"id": 41, "from": "user", "to": "askk", "kind": "say", "about": null,
 "body": "make the site load faster", "shown": [], "state": "new"}
```

| kind | means | must carry |
| --- | --- | --- |
| `say` | words for the reader to act on | body |
| `ask` | the sender cannot go on without one answer | body, options, how it can still be answered |
| `answer` | settles one ask | `about` = the ask |
| `report` | a piece of work stopped: done, failed or stopped | `about` = the envelope that asked for it |

Four kinds. `about` chains envelopes into a thread; `from` is the return address. Those two
fields do the work that ownership would otherwise do.

It replaces two things in the code today: `board::Message {id, from, to, text, seen}` and
`Event::Input(String)`. An engine that is woken already receives its new messages joined into
one string; with the envelope it receives them as they are.

**Not an envelope:** what happens *inside* a session (each thing said, each tool call). Those
are items: the harness's own record, shown in the session's view. A session writes an envelope
only at a boundary: it needs an answer, or it stopped. This is dsh's rule (speak when someone
must act or can use a result) and it keeps inboxes readable.

## 2. One life for everything that is stored

Every engine and every session goes through the same steps. The first three are the ones
already agreed (seed → scan → init).

| step | what happens | engine | session |
| --- | --- | --- | --- |
| **seed** | what is missing is supplied from defaults | its folder from a template | nothing: a session is made, not seeded |
| **scan** | the manifest names the keys; what is there is read into one snapshot | `engines/**` | `sessions/*` |
| **init** | the object is built from the snapshot only | elements from their Specs | its card; if it was live before, it is now `lost` |
| **receive** | an envelope arrives in its inbox and it is woken | a run starts | the words are said to the harness |
| **work** | it does what it does, and saves at each whole step | the loop's stages | the harness's turn; items arrive |
| **speak** | at a boundary it posts an envelope | an answer, a say to another, an ask | an ask, a report |
| **adapt** | its configuration changed: the new value is checked, then taken up at the next safe point | between runs | between turns |
| **rest** | nothing to do; nothing running | idle | idle (its process may be let go) |
| **end** | it is dismissed; its record stays readable | dismissed | ended |

**Adapt is the step that is new.** Today only models do it (the models key is re-read when it
is marked changed); an engine's elements are built once, at init. The mechanism it needs
exists: every store write marks its key (`core/changes.rs`). What is added is that the object
which owns a key hears the mark.

Rules for adapt:

1. A new value is checked before it is used. A wrong one is refused with the reason, and the
   old one stays in force.
2. It is taken up only between whole steps (one writer per object).
3. State is kept. Configuration is knobs; state is what happened.
4. If the change cannot be taken up in place (a session's harness, where it works), the
   object says so, and the change applies to the next one made.

**Yours 2.** The flow already has a stage called `Refresh` (elements that watch something
fetch it again). The step above is a different thing. Provisional: call this one *adapt* and
leave `Refresh` as it is.

## 3. Each object's states

### Envelope

```text
new ──► taken ──► settled
          │
(ask only)└─► gone      its sender can no longer hear an answer
```

| from → to | caused by |
| --- | --- |
| → new | someone posts it; the reader is woken |
| new → taken | the reader's run or turn begins with it |
| taken → settled | the reader answered, reported, or acknowledged |
| new or taken → gone | (ask) the session that asked has no live process |

### Session

```text
made ─► idle ─► starting ─► working ⇄ waiting ─► idle ─► … ─► ended
          ▲                    │
          └──── lost ◄─────────┘   (the host restarted)
```

| state | means | leaves when |
| --- | --- | --- |
| made | its configuration is written | init |
| idle | no turn in progress; it may have no process | an envelope arrives |
| starting | the harness is being started or resumed | the harness says it is ready, or fails |
| working | a turn is in progress | the turn ends, or it asks |
| waiting | it posted an ask and cannot go on | the answer arrives, or it is stopped |
| lost | it was live when the host stopped | someone opens it: resumed by the harness's own id |
| ended | closed on purpose | never: it can be read, not addressed |

What a session stores is small: which harness, where it works, a title, the harness's own id
for the conversation, its state. The conversation itself is the harness's.

### Engine

As today: idle → running (the stages of its flow, in order) → idle; stopped; error; dismissed.
What changes is its input (an envelope, not a string) and that it can adapt between runs.

### Harness (an instance in `harnesses.json`)

`listed` → `found` (the program exists; its version is known) or `missing`. Checking one never
opens a session: opening can start hooks, servers or a login.

### Configuration

```text
default ─► (pack) ─► personal          which value wins, read top down
written ─► marked ─► checked ─► taken up | refused
```

## 4. The expected workflow: a goal from someone who does not know how to ask

You should not need to know prompting. The default engine does. Its whole job is to turn a
wish into a brief a harness can be held to, place it, and watch it.

```text
you ──say──► askk ──say──► session ──► harness
 ▲            ▲  │            │
 │            │  └─ask?─► you │
 │            └────report─────┤
 └───ask (permission)─────────┘
 └───report──── askk
```

1. **You say a goal.** `{from: user, to: askk, kind: say, body: "make the site load faster"}`.
   It lands in askk's inbox; askk is woken.
2. **askk shapes it.** It reads the envelope and what it knows (your notes, the projects
   folder). It writes a brief with four parts: the end state, the proof that would show it,
   what must not change, and a bound. (`006-goal-statements.md` is this knowledge, written for
   a person; here it becomes the default engine's own instructions.)
3. **Only if it cannot write the end state, it asks you once.**
   `{from: askk, to: user, kind: ask, about: 41, body: "Faster to first paint, or to finish loading?", options: […]}`.
   Your inbox shows it; the waiting count goes up. Your answer is an envelope back.
4. **askk places it.** It decides which harness and where, and opens a session: this writes
   the session's configuration, exactly as making an engine writes a folder. The session is
   `made`, then `idle`.
5. **askk sends the brief.** `{from: askk, to: site-speed, kind: say, about: 41, body: <the brief>}`.
6. **The session receives.** `idle → starting → working`. The harness is started where the
   configuration says, and the brief is said to it.
7. **The harness works.** Items arrive and are drawn in the session's view. No envelope is
   written.
8. **The harness needs permission.** The session posts
   `{from: site-speed, to: user, kind: ask, body: "Run npm run build?", options: […]}` and is
   `waiting`. A permission ask always goes to you: that is fixed in code, not in a prompt.
9. **You answer.** `{from: user, to: site-speed, kind: answer, about: <the ask>}`. The session
   passes it to the harness and is `working` again.
10. **The turn ends.** The session posts
    `{from: site-speed, to: askk, kind: report, about: <the brief>, body: <what it said last, and how it ended>}`
    and is `idle`. The report goes to whoever sent the envelope it was working on.
11. **askk judges.** It is woken by the report and holds it against the proof in the brief.
    Not shown: it says so to the session (back to 6). Shown: it reports to you.
12. **You hear once.** `{from: askk, to: user, kind: report, about: 41}`. The thread that began
    with envelope 41 is settled.

What you saw: one question at most, the permission asks, one report. What you could look at
whenever you wished: the session, live.

**Yours 3.** In step 3, should askk show you the brief before it sends it? Provisional: no;
it asks only when it cannot write the end state, and the brief is always readable in the thread.

**Yours 4.** Is a goal an object of its own, or the thread of envelopes that began with it?
Provisional: the thread. Where a goal stands (needs you, working, done) is then read from its
envelopes and never stored.

**Yours 5.** In step 4, a new session for every goal, or may askk send a goal to a session
that already exists? Provisional: it may reuse one that is `idle` and works in the same place.

## 5. Other expected workflows

### Straight to a session

You address a session yourself: `{from: user, to: site-speed, kind: say}`. Steps 6 to 10 are
the same; the report comes to you, because you sent the envelope. askk is not in the path and
does nothing. This is the T3 Code experience, and it is the same road as section 4, entered one
step later.

**Yours 6.** Should askk be told when you speak to a session it opened? Provisional: no; it
can read the session when it is next woken.

### A configuration changes

1. You (on a page) or an engine (with a tool) writes a value: say, the session's title, an
   engine's phases, the command of a harness.
2. The store marks the key.
3. The object that owns the key hears the mark, checks the value, and takes it up at its next
   safe point; or refuses it and says why, where it was edited.
4. Windows showing that key redraw, as they do today.

Nothing restarts. If a harness's command changed, sessions that are live keep the process they
have; the next start uses the new one.

### The host restarts

1. Boot: seed → scan → init. Every session that was `starting`, `working` or `waiting` is `lost`.
2. Every ask from a lost session is `gone`: your inbox shows it as no longer answerable.
3. Opening a lost session resumes it by the harness's own id; the conversation is read back
   from the harness.
4. An engine that was mid-run is `interrupted`, as today.

### A session did not start here

A conversation begun in a terminal is found through its harness, read, and taken up as a
session of ours. Never one that another process is driving.

## 6. The map

```text
src/core/envelope.rs        the envelope: its kinds, its states
src/core/board.rs           the inboxes: post, wake, the directory of addresses
src/core/engine.rs          an engine; its input is an envelope
src/core/session.rs         a session: its card, its states; items; the Harness port
src/host/harness/<kind>.rs  one harness's wire, and nothing else
src/host/sessions.rs        the live ones: start, say, pass items on, post at boundaries, let go
src/host/world.rs           boot; who hears which key (adapt)
src/api/…                   what a window may ask
src/ui/views/…              an inbox, a session, an engine, drawn

data:  askk.json            + "sessions": "sessions", "harnesses": "harnesses.json"
       board.json           every envelope
       engines/<path>/      engine.json, elements/*.json
       sessions/<name>.json {kind, name, config, state}: the Spec shape, so it backs up like everything else
       harnesses.json       the instances
```

| the problem | the place |
| --- | --- |
| an envelope went to the wrong inbox, or woke no one | `core/board.rs` |
| a kind of envelope is missing a field | `core/envelope.rs` |
| a session is in the wrong state | `core/session.rs` (the states), `host/sessions.rs` (what moved it) |
| a session said the wrong thing to its harness | `host/harness/<kind>.rs` |
| a changed value was not taken up | `host/world.rs` (who hears), the object's own adapt |
| the default engine wrote a poor brief | its `goal.md` and phases: data, not code |

## 7. What this changes in the earlier files

| earlier | now |
| --- | --- |
| `002` D3: a session is an element the engine carries | a session is a peer of an engine, with its own inbox |
| `002` D6: two doors (to a session, to an engine) | one door: an envelope to an address |
| `002` D9, `004`: an *ask* is its own structure on a card | an ask is an envelope in your inbox |
| `004`: `elements/sessions.rs`, `Event::Session` | gone; `core/envelope.rs` and a session object in their place |
| `003` S9: "the work is the session" | still to be avoided: the work is the thread, the session is who is doing it |
| `005` stage 0: the port and a recording | the envelope and the inbox come first; the port after |

What stands: the harness port and one file per harness, native wire for Claude and Codex and
ACP for the rest, items whole and honest capabilities, the harness keeps the transcript, the
permission ask always reaches the person, code decides structure, personal use, packs later.

## 8. What changing the input costs

`docs/architecture.md` rates a change to `Event` or to a `Component` method as high: every
element reads them. The envelope touches `Event::Input`, the board, the `inbox` and `history`
elements, `Engine::wake`, and what the chat draws. It is one change, made once, before any
session exists; after it, sessions arrive without touching the engine again.
