# 011 Composition: one application, pluggable elements, shareable setups

The design of 2026-11-10, built on `000`–`009`. It answers three asks:

1. **Client and server, as one application.**
2. **The right elements pluggable, with the right variables, composed to orchestrate.**
3. **Every element and every engine setup shareable with no personal data in it.**

Start small: one rule per problem, each checked by a test. Memory and speed are rules too
(§6), but only where they are free now and costly later.

## 1. The one idea

Today an element file mixes three things in one value:

```json
{"kind": "notes", "name": "notes", "config": {"file": "notes.md", "hint": "…"}, "state": null}
```

- **kind**: code (`elements/notes.rs`).
- **config**: knobs. Some are craft (`hint`, `mode`); some are *about you* (an account, a
  ticker list, a path in your home).
- **state**: what happened. Always yours.

**Split them by who owns them, and sharing falls out.**

| layer | owner | holds | shared? |
| --- | --- | --- | --- |
| **kind** | code | behaviour, and a typed list of its parameters | the binary |
| **recipe** | the author | which kinds, their craft values, how they are wired, and *named holes* for anything personal | **yes, always** |
| **bindings** | you | the value of each hole, on this machine | never |
| **state** | the run | what happened | never |

A recipe has no personal values because it *cannot hold one*: a parameter declared
`personal` refuses a literal in a recipe and accepts only a hole (`{"$": "name"}`). Exporting
is then just copying recipes.

## 2. Parameters: the right variable, declared by the kind

Each kind declares its parameters in code. Nothing else may appear in its config.

```rust
// core/param.rs
pub enum Share { Craft, Personal, Secret }           // who a value belongs to
pub enum Ty { Text, Int { min: i64, max: i64 }, Bool, Choice(&'static [&'static str]),
              Path, List(&'static Ty), Ref(&'static str) }   // Ref: a role another element fills

pub struct Param {
    pub key: &'static str,
    pub ty: Ty,
    pub share: Share,
    pub default: Option<&'static str>,                // craft only
    pub doc: &'static str,
}

pub trait Kind {
    const NAME: &'static str;
    fn params() -> &'static [Param];
    fn build(cfg: &Resolved) -> Result<Box<dyn Component>, String>;
}
```

| `Share` | in a recipe | in bindings | in exports | in logs and run records |
| --- | --- | --- | --- | --- |
| `Craft` | literal | may override | yes | yes |
| `Personal` | a hole only | the value | no (the hole is kept) | yes |
| `Secret` | a hole only | a keychain reference, never the value | no | its length only (`008` G3) |

`notes` declares `hint`, `mode` and `file` as craft (`file` is a name inside the engine's own
folder). A market element declares `account` secret and `tickers` personal. A path outside the
engine's own folder is always personal.

Rules, each a test:

- an unknown key, a wrong type, or a literal in a personal or secret slot is refused **with the
  key and the reason**, and only that engine does not start (`010` B1: no silent dead knobs);
- every `Param` has a `doc`;
- the catalogue page and `askk api describe <kind>` are generated from `params()`.

## 3. Composition: how elements are put together

An **engine recipe** is a folder; nothing in it is personal.

```text
engines/trade-desk/
  engine.json        name, mode, model role, flow (the stages), the holes it needs
  elements/*.json    one per element: kind, name, craft config, holes
  goal.md            the craft prompt
```

```json
// engines/trade-desk/engine.json
{"name": "trade-desk", "mode": "desk", "model": "role:reasoning",
 "flow": ["prompt", "think", "parse", "act", "save"],
 "needs": {"account": "secret", "tickers": "personal", "home": "personal"}}

// engines/trade-desk/elements/market.json
{"kind": "market", "name": "market",
 "config": {"every_ms": 60000, "account": {"$": "account"}, "tickers": {"$": "tickers"}}}
```

Three composition tools, nothing more:

| tool | does | example |
| --- | --- | --- |
| **hole** `{"$": "name"}` | a value supplied by bindings | `account`, `tickers` |
| **role** `"role:<name>"` | a thing the machine chooses, not the recipe | `model: "role:reasoning"` becomes whatever model you mapped to `reasoning` |
| **use** `{"use": "<recipe>", "with": {…}}` | an engine or element built from another recipe, with craft overrides | a sub-engine of askk from `templates/engine` |

`needs` lists every hole at the top, so a person importing a recipe sees at once what it asks
for. Boot refuses an engine whose holes are unbound, naming each one and where to bind it.

**Wiring stays as it is**: events in, prompt sections out, tools contributed, and envelopes on
the board between members (`007`). Elements do not call each other; a `Ref` parameter names a
role another element fills, checked when the engine is built (`unique()` already does half).

## 4. Bindings: the only personal file

```json
// <home>/personal/bindings.json   (synthetic values)
{"engines/trade-desk": {"account": {"keychain": "askk/desk-a"},
                        "tickers": ["AAA", "BBB"],
                        "home": "/Users/you/desk"},
 "roles": {"reasoning": "claude-opus-5-5", "fast": "claude-haiku-5-5"}}
```

- It lives under `<home>/personal`, beside the user's own data (`structure.md`).
- It is read once at boot into the snapshot and read again on its change mark (`adapt`, `007` §2).
- A secret is a reference into the macOS keychain; the file never holds one.
- **One function** turns holes into values: `core::param::resolve(recipe, bindings) -> Resolved`.
  A kind's `build` sees only `Resolved`; `Component::config()` returns the recipe, never the
  resolved value, so neither a view nor an export can leak a binding.

## 5. Sharing: packs

A **pack** is a folder of recipes plus a manifest.

```json
// pack.json
{"name": "day-trading-desk", "version": "1.0.0", "askk": ">=0.4",
 "recipes": ["engines/trade-desk", "engines/trade-desk/watcher"],
 "kinds": ["market", "phase", "notes", "handoff"],
 "needs": {"engines/trade-desk": {"account": "secret", "tickers": "personal", "home": "personal"}}}
```

| verb | does | refuses when |
| --- | --- | --- |
| `askk pack export <engine>` | copies recipes; writes `needs` | any value fails the personal check; any state or run file is in the set |
| `askk pack check <dir>` | the same check alone (for CI, and for whoever receives one) | the same |
| `askk pack import <dir>` | places recipes in a layer (§5.1); lists the holes to bind | a kind is unknown to this build; the version does not match |

The export check is **structural, not a scan**: it walks every value against its kind's
`Param.share`. Free text in a craft slot (a `goal.md` that names your account) is the one thing
structure cannot see, so export also runs a cheap pattern pass on text (home paths, emails,
long digit runs, keychain names) and **refuses with the line**; it never strips silently.
Test: `an_export_holds_no_bound_value`, from a fixture whose bindings are known.

### 5.1 Layers (`000` open decision 3, made concrete)

```text
built-in   defaults/ in the binary   read-only
packs/<n>  imported                  read-only
mine       the data folder           where edits go
personal   bindings and state        never shared
```

Boot reads top-down: a recipe in `mine` wins over the same path in a pack, which wins over
built-in. Editing a pack's recipe writes a copy into `mine` (copy on write). This replaces
seeding by copying defaults: an upgrade of the binary or of a pack reaches you unless you
edited that file.

## 6. One application, client and server inside

Dioxus fullstack already splits code by feature (`server` / `web` / `desktop`). Make the
boundary a **trait**, so one binary runs both halves with no network between them.

```rust
// api/port.rs — what a window may ask; generated from one method registry
pub trait Host: Send + Sync {
    async fn call(&self, method: Method, args: Value) -> Result<Value, ApiError>;
    fn changes(&self, since: Rev) -> ChangeStream;
}
// api/local.rs  — in-process: calls host functions directly; changes are a broadcast channel
// api/remote.rs — HTTP or Unix socket: the same methods, for the browser and the CLI
```

| run as | client | server | transport |
| --- | --- | --- | --- |
| **Mac app** (default) | Dioxus desktop | same process | `api::local` |
| browser on this Mac | Dioxus web | the Mac app's host | `api::remote`, loopback |
| headless (`askk serve`) | none | this process | Unix socket |
| CLI (`askk …`) | the CLI | a running host, or one it starts | Unix socket |

Rules:

- **One host per home** (the `askk.pid` lock already). A second window attaches; it never
  starts a second writer.
- The UI never imports `host`. `structure.rs` already enforces direction; add a test that `ui`
  reaches the host only through `api::port`.
- **One method registry** with input and output schemas and an example each. UI calls, CLI
  commands, remote routes and the agents' MCP tool (`009` T4) are generated from it, so they
  cannot drift.

### Memory and speed, where it is free now

| rule | why now |
| --- | --- |
| The snapshot is an `Arc<Snapshot>`, swapped whole on a change; readers never lock | one writer, many readers; no copy per request |
| `Resolved` is built once per engine build, not per run | holes are looked up in one place, once |
| Kinds and params are `&'static` tables | the catalogue, the checks and the docs allocate nothing |
| State is written only at whole steps, by the engine's one writer | no partial files, no lock contention |
| `api::local` passes values in memory; no HTTP, no socket | the in-process path costs a function call |
| Run records keep the last 12 (already); large texts go to a side file named by hash | memory per engine is bounded |
| Every list a window shows is paged by the host | no window holds the whole board |

Deliberately **not** now: interning, arenas, custom allocators, zero-copy parsing. Measure first.

## 7. Where the code goes

```text
src/core/param.rs        Param, Ty, Share; resolve(); the personal check          (§2, §4)
src/core/recipe.rs       Recipe, Needs, hole/role/use; layered lookup             (§3, §5.1)
src/core/pack.rs         the pack manifest; export, check, import as pure functions (§5)
src/elements/<kind>.rs   each kind gains params(); builds from Resolved only
src/host/bindings.rs     reads <home>/personal/bindings.json; keychain refs       (§4)
src/host/layers.rs       built-in / packs / mine / personal on disk               (§5.1)
src/api/port.rs          the Host trait and the method registry                   (§6)
src/api/local.rs         in-process Host
src/api/remote.rs        HTTP and Unix-socket Host
src/main.rs              chooses local or remote; one host per home
```

`Spec { kind, name, config, state }` splits into `Recipe` (kind, name, config with holes) and
`State` (its own file, `<engine>/state/<name>.json`). That is the only change to existing
types; `Component` keeps its methods.

## 8. Order of work

| step | done when | tests |
| --- | --- | --- |
| 1 | `Param` and `Share` exist; every kind declares `params()`; an unknown key is refused | `every_kind_declares_every_key_it_reads`, `an_unknown_key_is_refused_with_its_name` |
| 2 | state leaves `Spec` for its own file | `a_recipe_file_holds_no_state` |
| 3 | holes, bindings and `resolve`; the desk recipe holds no personal literal | `a_personal_slot_refuses_a_literal`, `an_unbound_hole_stops_only_its_engine` |
| 4 | `pack export / check / import`; layers replace seeding | `an_export_holds_no_bound_value`, `an_edit_to_a_pack_recipe_lands_in_mine` |
| 5 | the `Host` trait and `api::local`; the Mac app runs its host in-process | `ui_reaches_the_host_only_through_the_port`, `two_windows_one_writer` |
| 6 | the method registry generates the CLI and the remote routes | `every_api_method_has_a_schema_and_an_example` |

Steps 1–4 do not touch the session layer (`005`) and can go before or beside its stage 0.
Stable ids for members should land with step 3, so recipes address members by id.

## 9. Yours

1. **Where bindings live:** `<home>/personal/bindings.json` (provisional), or a `personal/`
   folder inside the data folder.
2. **`goal.md` is craft.** A prompt that needs your facts reads them from `notes` or `user.md`
   (personal) and never inlines them. Agree?
3. **A pack carries no code.** Packs from others run only kinds already in the binary. Agree?
