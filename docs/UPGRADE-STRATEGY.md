# Upgrade plan — one agent, a strategy loop, and components that choose their format

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

The workflow is pointed at a real local model —
`gemma-4-12B-it-qat-mxfp8` at `http://127.0.0.1:8873/v1` — and each of the three
routes is driven end to end against it.
