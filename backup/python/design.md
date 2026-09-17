# Design

Every piece of text that reaches a model comes from exactly one place, and every place
answers exactly one question. This file names those places. When something new is added,
it goes where its question already lives, or it gets a new place of its own — it never
gets written twice.

## The layers

| Layer | Question it answers | Lives in | In context |
|---|---|---|---|
| Soul | Who is this agent? | `agents/soul.md` | Always, first |
| Agent | What is this agent's job? | `agents/<name>/agent.md` body | Always |
| Config | How is this agent wired? | `agents/<name>/agent.md` frontmatter | Never |
| Tools | What can it call? | `BaseTool.instructions()` | Always, generated |
| Context | What is true right now? | `core/context.py`, listed in frontmatter | Always, gathered |
| Conversation | What has happened? | `engine.history` | Always, grows |
| Response | How must it reply? | `BaseResponse.instructions()` | Always, generated, last |
| Skills | How is this kind of work done? | `skills/<name>.md` | Only when loaded |
| Models | Which model runs it? | `models.json` | Never |

The first seven are the prompt sheet, in that order. `BaseEngine.render()` is the whole
assembly — read it and you have seen the entire prompt.

Every markdown body is unwrapped on the way in: files are line-wrapped so a person can
read them, and `markdown.unwrap()` puts each paragraph back on one line so the model is
not charged for the wrapping. Lines that open a list, heading or quote keep their break,
because there the break carries meaning. What the file looks like and what the model
receives are allowed to differ, and where they do, the model's copy wins.

## Soul — character

Who the agent is and the rules it works by, independent of any task. Project-wide,
because character does not change between jobs. One `soul.md` at the head of the agents
folder serves every agent, sitting alongside the agent folders it applies to; an agent
overrides it only by keeping a `soul.md` of its own beside its `agent.md`.

Contains: character, the four working rules (think before acting, simplest thing that
works, touch only what was asked, know what done means), voice, boundaries.

Never contains: what any particular agent does, tool names, response format, project
facts. If a line stops being true when you swap the agent's job, it is not soul.

The soul says how the agent is; the agent file says what it is for. Only one of them
opens with a statement of what the agent is, and it is the agent file. A person wears
several jobs without becoming a different person, and the split is written the same way:
soul never says "you are a ReAct agent", agent.md never says "you are careful".

## Agent — job

What this one agent is for, and how it should work through a task. The body of
`agent.md` is the system prompt and nothing else is.

Contains: the agent's role, its loop behaviour, what it should prefer, what counts as
done for it. It states the job once, at the top — that is the one identity line on the
sheet.

Never contains: response format (the response object owns that), tool lists (the tools
own that), character (the soul owns that). Duplicating any of those is the most common
mistake, and it costs twice: tokens, and a second place to keep correct.

## Config — wiring

The frontmatter of `agent.md`. Read by `load_agent`, never rendered.

- `name`, `description` — how this agent appears when another agent holds it as a tool
- inference keys (`model`, `provider`, `temperature`, ...) — an alias from `models.json`,
  or nothing, and the catalogue default applies
- engine keys (`response_format`, `max_steps`, ...) — passed straight through
- `mcp:` — servers to connect, each with the subset of tools to expose
- `agents:` — agents at the head level, shared, attached as tools

An agent owns a folder, not a file, so it can carry more than config: a `tools.py`
beside it becomes its own tools, and a `soul.md` beside it becomes its own character.

Folders nest, and a folder inside an agent's folder is a sub-agent it alone holds,
attached without being named anywhere. What is physically inside you is yours; what is
listed in `agents:` is a peer at the head level that anyone may list. The tree is the
org chart, which is what lets an agent make a sub-agent by writing one file — there is
no registry to update, so `create_agent` writes an `agent.md` into a new folder and the
next load finds it.

## Tools — reach

What the agent can call, written by the tool itself. A tool's instruction line is
generated from its name, description and parameters, so the one description on the
function or the MCP server is the one the model reads.

Three kinds, one shape: a Python function, an MCP server tool, and another agent. An
agent becomes a tool through `as_tool()`, which is why the name and description in
frontmatter matter — they are what the calling agent sees.

An agent held as a tool runs each call on its own engine: same tools, same listener,
empty history. Two reasons, and the second is the stronger. A focused sub-agent called
for one job and later for another would otherwise answer the second against the first
job's past. And the same sub-agent can be sent two tasks at once — `[[worker(a),
worker(b)]]` is one stage — so a single shared engine would interleave both runs into one
history and hand each the other's turns.

An agent that should carry its past between calls says `remembers: true` in its
frontmatter, and is then the one engine every time, which means one task at a time. The
lead agent the user talks to keeps its history without saying anything, because nothing
holds it as a tool.

That one word is the whole difference between the two kinds of agent a lead can make. A
fresh agent is the default: called for a task stated in full, it answers and keeps
nothing, so the tenth call is as clean as the first. A lasting agent says `remembers:
true` and carries a `session` of its own, so it can be handed one long goal in pieces,
asked how it is going, and picked up again after the process has died. The lead chooses
between them when it writes the agent — `create_agent(..., lasting=True)` — because the
lead is the one who knows whether the job is a question or a campaign.

## Context — the present

What is true at this moment rather than in general: the time today, and whatever else is
worth knowing that changes between steps. Every other layer is written once and read back
unchanged; context is a function that runs on every render, so it can never be stale.

An agent lists the pieces it wants in its frontmatter, and the order it lists them is the
order they are read. A piece may take settings:

    context:
      - time

    context:
      time:
        format: "%H:%M"

It sits above the conversation, so the agent reads the present before it reads the past.
Adding a piece means a class with a `render()` and a name in `CONTEXTS` — nothing else in
the system changes.

A piece is handed the engine it renders for, so the present includes the agent's own
state, not only the world's. `budget` is that: steps spent of steps allowed, and history
measured against the window. An agent that cannot see its budget cannot spend it — it
explores for nine steps and is cut off on the tenth with nothing to show.

Context is not memory and not a tool result. If it has to be fetched by deciding to fetch
it, it is a tool. If it is simply true and cheap to state, it is context.

## Conversation — record

What has happened, as turns: `user`, `assistant`, `observation`, and `summary`. The only
layer that grows during a run, and the only one written by the run rather than by us.

Because it grows, it is the only layer that is bounded. Before each step the engine
measures the rendered sheet against the model's context length and, past `compact_at`,
folds every turn but the last `keep` into one `summary` turn. The context length is asked
of the provider (`GET /v1/models` publishes it on local servers; the OpenAI API does not),
then falls back to a configured `context_length`, then to a default.

The summarising is done by an agent, `agents/compactor`, not by a prompt in code — what to
keep and what to drop is a job description, so it lives where job descriptions live.

A run under way can still be spoken to. `engine.nudge(note)` leaves a note in the
engine's inbox and returns at once; the loop drains the inbox before each step and
appends what it finds as ordinary `user` turns. A nudge is therefore not a new kind of
message and needs no new instruction anywhere — the agent already knows how to read the
user speaking again. It lands between steps rather than during one, so an agent is
redirected at its next decision, never mid-tool-call.

It is also the only layer worth saving. An agent given a `session` name writes its
history to `sessions/<name>.json` after every turn and picks it up again when an engine
with that name is built, so a conversation outlives the process. Every other layer is
rebuilt from its files each time and would be stale the moment one of them changed.
Writing after each turn rather than at the end is deliberate: the run that crashes on
step nine is the one whose history you wanted. A sub-agent is not given a session — it
is called for one task and keeps nothing — so what persists is the agent the user talks
to.

## Response — shape

How the model must reply, generated from the response model's fields and their
descriptions. The format (`toon` or `json`) is chosen at initialization and carried on
the class, so a field's meaning is written once and rendered correctly in either.

This is why field descriptions carry real instruction, not labels. The rule for tool
call staging lives on the `act` field because that is where the model reads it.

A ReAct reply says `do`, then `act`. `do` is the choice — `tool` or `done` — and `act` is
what that choice asked for: the tool calls, or the reply itself. One payload field, not
two, because two let the model fill both and leave the loop to guess which it meant.
`calls` and `answer` are still there to read, as properties returning whichever half `do`
selected.

Field names are picked for what they cost as well as what they say. A name is written
once in the format block and again in every reply the model makes, so a word that says
the same thing in one token instead of two is paid back on every step.

Never hand-write these instructions anywhere else.

## Skills — method

How a kind of work is done well: the procedure, the pitfalls, when to stop. Not in
context by default. `catalogue()` gives name and description for every skill, cheaply,
so an agent can see what exists; `load(*names)` returns the full text of the ones it
decides it needs.

Contains: procedure and judgement for one kind of task.

Never contains: character, or what a specific agent is for. A skill is written for
whoever needs it, not for one agent — that is the difference between a skill and an
agent's instructions.

Skills are deliberately not wired into the engine yet.

## The rule for anything new

Ask which question it answers.

- True of every agent, regardless of task → soul
- True of one agent's job → that agent's `agent.md`
- Read by code, not the model → frontmatter or `models.json`
- Describes something callable → the tool's own description
- Describes the reply's shape → a response model field
- A procedure worth reusing across agents → a skill

If it fits two, it belongs in the more general one and the specific one refers to it.
If it fits none, it needs a new layer, and a new layer needs a new place in `render()`.

## Events — the run as it happens

A run is not only its answer. `engine.listen(fn)` attaches one listener to an agent and
every sub-agent below it, and from then on the run reports itself: reasoning as the model
thinks, raw deltas, each response field the moment it is complete, every tool call, every
observation, what it is doing, the answer, and any error.

`status` is that one: what the agent is doing right now, in a single word — `thinking`
while the model is answering, `calling` while tools run, `compacting` while history is
folded, `done` when it has an answer. A tree of agents renders as a row each with its
own word. It is a field on the engine as well as an event, but the field is only worth
reading on an agent you hold — a sub-agent's call runs on its own engine, so a front end
follows sub-agents through the events, not by reaching for the field. The engine's own
word is `status` because `stage` already means one group of parallel tool calls.

`status` is one word. `progress()` is the small record around it, and it answers the
other question you have about a long run: not what the agent is doing this second but
whether it is getting anywhere. Six fields — the goal, the word, steps, seconds, the calls
made, and how many of those were made twice — chosen because each one changes what you
would do about it, and nothing else does. A run on step two after ninety seconds is
waiting on a slow model; a run on step nine with three repeats is stuck, and no amount of
waiting will help.

Everything in it is measured, not asked for, so it costs no tokens and cannot flatter the
way a self-report can. It is per turn, not per agent: `begin()` resets the count, the
clock and the calls each time `invoke` is called, because on an agent that remembers, a
number counting since the first job it ever ran answers nothing.

What this cannot see is whether the work is any good, because only the model knows that.
Measured progress tells you a run is moving; it takes a reported field to tell you it is
moving somewhere.

Nothing in the loop depends on a listener existing. With none attached the engine is
silent and behaves identically — events are how a front end watches a run, not how the
run works.

Fields arrive early because the reply is streamed and TOON is read line by line: a field
is announced as soon as the next field's key appears, since only then is it certainly
finished. JSON cannot be read until it closes, so in JSON the fields all arrive at the
end. That is a real cost of the format, and it is the reason TOON is the default.

## Failure

`invoke()` does not raise. A run either answers or explains why it could not, and the
caller — a REPL today, a UI later — never handles an exception to stay alive.

Failures are handled where they happen, by kind:

- **The model call** is the one genuinely outside thing. `BaseInference.invoke` retries
  with backoff and raises `InferenceError` only after every try; the engine turns that
  into an answer saying so. Providers implement `send()` and never think about retries.
- **An unparseable reply** is not a failure of the model so much as a miss. The engine
  shows it exactly which fields were rejected and asks for the whole reply again, up to
  `repairs` times, then falls back to `recovered()` — the model's own words as the
  answer, so nothing is silently lost.
- **A tool** returns its failure as the observation text. A failed tool is information
  the agent can act on, not an ending.
- **An MCP server that will not start** costs its tools, not the agent. The agent loads
  without them and warns.

Everything else in the flow is ours and is meant to be correct. A missing `agent.md`, a
malformed frontmatter, an unknown skill name: these still raise, because they are
mistakes to fix rather than conditions to survive.

## Why the split matters

Context is finite and every always-on layer is paid for on every step. The split keeps
the standing cost small and fixed — soul, job, tools, format — while the parts that
could grow without limit, skills and history, are loaded on demand or bounded.

It also keeps the system honest: one owner per fact means changing a fact changes it
everywhere. Generated instructions mean the code and the prompt cannot drift apart.
