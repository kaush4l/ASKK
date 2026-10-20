# Agent — the core desk

One capable agent, no fixed team. Its capability is the kernel's kit:

- **helpers** made for a goal and run in parallel — `agent.spawn`, `agent.catalog` (what a helper can be given),
  `agent.update`, `agent.dismiss`, and `dispatch` (start, wait, read, stop). A helper whose job recurs is kept
  (`keep: desk`): written as `agents/agent/<name>/agent.md` and spawned again at every start.
- **desks** for standing jobs — `desk.list`, `desk.create` (a desk written from a spec into the local desks folder,
  `custom/`, composed before it is put in place), `desk.check`, `desk.load`, `desk.ask`, `desk.propose` (tool code kept
  for the owner to accept, never loaded by an agent).
- **practice** — its run checklist, quality bar and learned instructions in `memory/agent/practice/agent.md`, seeded
  from `agents/agent/practice.md`; every run ends with its retro (`agent.practice.reflect`), which edits the section the
  run showed was missing.

Three routes for any request: itself (a few reads), helpers (independent angles, in parallel), or a desk (a standing
job: `desk.create` → `desk.load` → `desk.ask` its first request → `desk.create {update}` until its answer meets its bar).

```bash
bun run dev
bun run send -- --agents desks/agent --wait "Set up a desk that …"
```

The hosted version (the static export, e.g. GitHub Pages) runs the same kind of agent in the browser against a model
you name (a local OpenAI-compatible server or a hosted one): `backend/browser/`.
