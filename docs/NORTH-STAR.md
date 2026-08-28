# NORTH-STAR

> The document every other document answers to. The ringmaster rules against
> this file. If a change cannot name a sentence here that it serves, it is
> drift.

## The core problem

**A personal agent should not need a server.**

Every capable agent harness today is a program you install, a daemon you keep
running, a container you keep warm, and a machine you have to be sitting at.
That makes the agent a place you go rather than a thing you have. It also
makes it something you can lose: the box dies, the tunnel drops, the host bill
lapses, and the agent is gone.

This project is the opposite bet: **the whole harness is a static page.** You
open a URL. The agent is there — its identity, its memory, its tools, its
sandbox — running in the tab, on any device you can open a browser on. No
backend to deploy, nothing to trust, nothing to keep alive.

That is the thing being solved. Everything else is a consequence.

## The four consequences

1. **Zero backend.** No server the project owns. Model access is the user's own
   key or their own local endpoint, called directly from the page. If a feature
   requires a server we run, the feature is out of scope, not the constraint.
2. **The tab is the computer.** Persistence is the browser's (IndexedDB, OPFS).
   Compute that must be isolated runs in a worker or in WASM in the same tab.
   The page must survive a reload with its state, its history, and its
   configuration intact.
3. **Portable by construction.** The deployed artifact is a folder of static
   files. It works from a subpath on GitHub Pages, from a file server, from a
   USB stick. A build that only works at the root is a broken build.
4. **Legible over capable.** This is a single person's system. It is judged on
   whether a reader can follow it, not on feature count. Given a choice between
   one more capability and a system that still explains itself, the system
   wins. Deleting is a valid increment.

## What "the agent" means here

An agent is four things and no more:

- **An identity** — a file that says who it is and how it behaves, edited by a
  human, read verbatim by the model.
- **A loop** — the smallest cycle that turns a request into observation, action,
  and an answer, and knows when to stop.
- **A set of tools** — declared once, described to the model in its own words,
  executed against a real environment.
- **A memory** — what survives the turn, the session, and the reload.

Anything in the tree that is not one of those four, or the surface that renders
them, is on trial.

## The theme

**A workshop, not a chat window.**

Chat is one view onto the agent, not the agent. The interface shows the machine
working: what it is thinking through, which tool it reached for, what came back,
what it now believes, and what it will cost. A person should be able to watch a
turn happen and understand it without a debugger, and should be able to reach in
and change it mid-flight.

The feel is instrument, not toy: dense where information lives, quiet where it
does not, fast, and unmistakably one designed thing rather than a framework's
defaults.

## The tests this project is judged by

- **Cold open.** A stranger opens the deployed URL on a device that has never
  seen it, and reaches a working agent turn without reading documentation.
- **Reload.** Everything that mattered is still there.
- **Airplane.** With a local model endpoint reachable, the page works with no
  internet.
- **Read-through.** A competent reader follows a request from the input box to
  the model call and back, in one sitting, without asking anyone.

## Non-goals, stated so they stop coming back

- Not a hosted product. No accounts, no multi-tenancy, no billing.
- Not a team tool. One person, their devices.
- Not a model. It calls models; it does not train or serve them.
- Not a framework for other people's agents. It is one person's agent that
  happens to be well built.
- Not feature parity with anything. Parity is a reference, never a target.

## The evolving part

There is no finish line, and that is deliberate. What is fixed is the core
problem and the four consequences. What evolves is which capabilities earn a
place inside them. A capability earns its place by being reachable from the
cold-open test — not by being impressive in isolation.
