# HARNESS

A personal agent harness that runs entirely in the browser, as a static page.
Vanilla JavaScript on Bun 1.4. Zero runtime dependencies.

It is a port of a Python agent core, and it inherits that core's one idea:

> **Define the flow with an abstract base; let the variables passed at
> construction decide the behaviour.**

Four places that shape appears — inference, responses, tools, components — and
what all of it exists to produce is one string. **The strength of this
application is the prompt it constructs.**

## Layout

```
core/     the backend — pure JavaScript, no DOM, tested on the host
app/      the interface — a static page that renders what core computes
docs/     PHILOSOPHY · PORT-MAP · PORTING-GUIDE · INCREMENTS
tests/    the suite, and golden/ — the byte-for-byte oracle
agents/   agent.md files: who each agent is, what it may call
skills/   SKILL.md packages the agent can choose to read
```

## Commands

```
bun test          the host suite
bun run types     tsc --checkJs --strict
bun run gate      everything, in one command
bun run dev       the page, live
bun run build     the static export
```

## Reading order

1. `docs/PHILOSOPHY.md` — the principle, at its smallest
2. `core/components.js` — what a prompt part is
3. `core/assembler.js` — how parts become bytes
4. `core/responses.js` — the field set as contract
5. `core/agent.js` — one exchange
6. `docs/PORT-MAP.md` — every place the port had to decide something
