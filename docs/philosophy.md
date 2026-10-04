# Engineering philosophy

ASKK is a team of agents you can watch work. Every design choice follows
from one idea:

> **Every engine is a live object: its own thread, its own inbox, its own
> tools and state, and a UI attached to that state. Whatever it does, you
> see as it happens.**

## 1. One engine, one thread, one inbox

Each agent runs as an engine in its own Web Worker. It owns:

- **an inbox**: every piece of work arrives as a letter: your message, another agent's quest, a report on a quest it handed out;
- **its tools and artifacts**: what it can do, and the live objects it works on;
- **its memory**: its conversation, saved as Markdown;
- **its status**: `created → idle ⇄ running → disposed`, plus what it is doing right now (`activity`).

An engine works one letter at a time. A deposit while it is idle starts the work.

## 2. Send messages, never wait on another agent

Engines talk only by putting letters in each other's inboxes. Calling another agent hands it a quest and returns at once. The caller's turn ends, and the report comes back as a new letter that wakes it. No agent ever blocks on another, so each one is always free to show its own state and to take your next message.

## 3. Long work is supervised, not capped

Agents may take as many steps as a quest needs, and a manager as many rounds; there is no fixed loop limit. Unlimited work brings risks: an agent drifting from its quest, looping on the same call, or stalling. The answer is supervision instead of a cap. A system supervisor reads every running engine's state, and every few minutes or steps sends the quest's owner a status letter with a digest of the latest work. The owner checks it against the quest: lets it run, steers it, or calls it back. The owner can always see the same thing and press Stop.

## 4. State is the interface

An engine's state is one immutable snapshot, replaced on every change:

- status and activity;
- messages, streamed token by token;
- pending approvals;
- open quests and queued letters;
- token metrics and context use;
- artifact state.

The worker sends changes as batched patches (about 30 per second, only what changed). The UI subscribes (`useSyncExternalStore`) and only renders.

So:

- **Nothing is hidden.** If the engine knows it, it is in the state; if it is
  in the state, the UI can show it. That covers thinking, each tool call and
  its result, a quest handed out, "Waiting for planner, critic", an approval
  card, and the exact prompt sent (`<>`).
- **Behaviour lives on the engine, not in components.** Components read
  state and call engine methods (`send`, `stop`, `resolveApproval`, memory
  actions). They never decide what an agent does.
- **Every surface reads the same state.** The chat, the engine bar, the
  activity line, the status bar along the bottom of every page, and the
  headless CLI's progress lines all subscribe to it.
  A new view is a new subscriber, never a new code path in the engine.

## 5. The owner stays in control

- **Changes are approved one by one.** Every change to your files waits for
  your approval. A declined call stays declined for that request.
- **Anything in flight can be stopped.** Stop aborts the current work, and
  Call back recalls quests that are still out.
- **Results are reported honestly.** A failed tool call is recorded as a
  failure (`ok: false`), and the agent must report it as one. A write over a
  file must be based on the version the agent actually saw.

## 6. Core defines the flow; features implement it

`backend/core/` holds the contracts and the flow: engine, artifact, tool,
prompt template, response parsing. `backend/features/` holds the
implementations, one folder each (filesystem, skills), registered in one
catalogue. Core never imports a feature directly. To add a capability you
write a feature; the flow stays as it is.

## 7. The prompt shows the present

The complete prompt is rendered fresh for every request, in a fixed order:
soul → role → context → history → artifacts → tools → response format →
request.

- **Artifacts show only their latest state**, never a log of edits, so
  context stays small however much work happens.
- **History holds finished turns.** The current request's own steps follow
  it, so the model continues instead of starting over.

## 8. Identity apart from the job

The soul is who every agent is: values and character, the same in every
role. The role (`agent.md`) is the hat for this work: what the work looks
like, its rules, and what has been learned. See `soul-and-role.md`.

## 9. One codebase, every way of running it

The same engines run:

- in the browser (static hosting, files in browser storage);
- beside your folder (dev server or the `askk` program, through the host
  API);
- headless (`askk ask`, for scripts and cron).

The app has no server state: the host only provides capabilities (reading
and writing a folder) and never runs agents. Code that only works in one
mode is a bug.

## Checklist for a change

- Does the new behaviour show up in engine state, so the UI can show it?
- Does it live on the engine (or a feature), not in a component?
- Does it block on another agent, or does it send a letter?
- Can the owner see it, approve it, and stop it?
- If it can run long, does it show up in the supervisor's status checks?
- Does it work in the browser, beside a folder, and headless?
