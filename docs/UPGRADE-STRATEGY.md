# Upgrade plan — one agent, a strategy loop, and components that choose their format

Status: DONE. Every section below shipped. Three things the plan did not foresee,
recorded here because they are the parts a reader would otherwise have to
rediscover:

1. **`declared` and `stages` had to become two fields.** The strategy stage
   rewrites the list mid-turn, so without a copy of what the file declared, the
   second message of a conversation inherited the first one's route — a greeting
   after a project would still be planning. Every test helper that sets a stage
   list has to set both.
2. **The plan stage reads before it writes.** Against the real model its first
   act is a `list_skills` call, not the brief; the brief comes on the call after
   the result lands. A live test that expected the brief immediately failed
   against a prompt that was working exactly as written.
3. **A pure tool's result is EMITTED, not run.** `step` answers `list_skills`
   itself and emits the fact; the runtime appends it and steps again. Feeding a
   hand-built result instead left `## observations` empty, and the model answered
   with nothing — a harness bug that read exactly like a model failure.

Follows `UPGRADE-COMPONENTS.md`, which made every part of the prompt a component
ordered by `Slot`. That work stopped at "each component renders itself in one
shape, and the loop an agent runs is a fixed list in its frontmatter". This plan
finishes both.

## 1. The parent gains a format

`Component::render()` is the toString. It has exactly one output shape, so a
component that would be clearer as a JSON object for one caller and as named
lines for another cannot say so.

```rust
pub enum Form { Markdown, Json }

fn forms(&self) -> &'static [Form] { &[Form::Markdown] }   // first is the default
fn render_in(&self, form: Form) -> Vec<Part> { self.render() }
```

Two variants because two are used, and a third would be a guess. The user of the
second one is §3's response object: a local 12B follows `ROUTE: answer` far more
reliably than it emits valid JSON, so Markdown is the default and Json is there
for a provider that can enforce a schema.

## 2. Static once, dynamic every call

Static components (`soul`, `identity`, `operating_rules`) are rendered once, at
adoption. Only the dynamic ones are rebuilt before a call, and that set is named
in one place (`components::dynamic`) rather than as three `set_component` calls
scattered through `ask::call_model`.

Honest note on "in parallel": these renders are pure, independent and
order-free — the property that would let a threaded host run them concurrently.
This build targets Wasm in one thread, where spawning tasks to run four string
formats costs more than it saves. The structure is the parallel-ready part; the
scheduler is not, and pretending otherwise would be the "setting that looks
applied" failure this repo already has a name for.

## 3. Phase = a directive plus a response object

`ResponseContract` today carries prose. A phase that demands a specific reply
shape — the strategy vote, the plan brief, the verdict — needs the shape stated
as fields, not described in a sentence. `ResponseObject` is a component field:
named fields with one-line descriptions, rendered as the exact lines the model
must write.

## 4. The strategy loop

Today `stages:` is a fixed list in `agent.md`. Every turn walks all of it, so a
greeting pays for a plan and a verify.

The loop becomes: one cheap `strategy` stage decides the route, and the route
decides the rest of the turn.

| Route | Stages that follow | When |
|---|---|---|
| `answer` | `work`, tools off | The question can be answered from what is known |
| `react` | `work`, tools on | It needs a tool — a search, a file, a command |
| `project` | `plan`, `work`, `verify`, `critique` | Something to build; more than one step |

`plan` is where the query is enhanced and skills are loaded: it is granted the
skill tools alone, so it can read the instruction it needs and nothing else.
`critique` is the verification phase, loaded with the critic's stance.

## 5. One agent

`summarizer` and `critic` are deleted. Both were kept last round because the
loop finds them by `role:` — so both jobs move into the one agent:

- **Compaction** no longer needs a summarizer file. It already builds its own
  sheet; that sheet now carries the compaction instruction as its soul.
- **Critique** is the `critique` stage, which already existed.

## 6. Clear chat

`POST /chat/clear` empties the window for one agent. The seam already carries
everything needed; this is a route and a button.

## 7. What proves it

`crates/agent/tests/live.rs` drives the real `step` function against
`gemma-4-12B-it-qat-mxfp8` at `http://127.0.0.1:8873/v1`, with the real shipped
`main` agent — the one thing no scripted test can show, because the strategy
loop is entirely a bet on whether a 12B writes the vote the contract asks for.
A vote it cannot write lands in `react` by the fallback, and every other test in
the repo stays green.

```
cargo test -p agent --test live -- --ignored --test-threads=1
```

Four tests, all passing: the vote is written in the shape asked for; the three
routes are told apart on three messages a person would sort the same way; the
project route plans (reading the skills first) and hands its brief to the work
stage; the answer route replies in prose with no tool call.

Ignored by default because it needs a model running, and it shells out to `curl`
rather than adding an HTTP dependency to a crate whose whole rule is that it is
pure and needs no network (I3).
