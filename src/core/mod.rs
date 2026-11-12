//! # Core: the one contract every component follows
//!
//! A component is **defined behaviour + configuration + state + UI**:
//!
//! | part | method | meaning |
//! | --- | --- | --- |
//! | identity | `kind()`, `name()`, `doc()` | what it is; `doc` is its self-contained documentation |
//! | init | `new(Spec)` (registered in [`KINDS`]) | read `config` (behaviour knobs, e.g. `format: toon`) and `state` (runtime data) |
//! | lifecycle | `on(&Event)` | react to engine events; the only way state changes |
//! | persistence | `config()`, `state()` → [`Spec`] | written back to its file, so a restart resumes |
//! | prompt | `prompt()` | its section of the prompt, or nothing |
//! | UI | `view()` → [`Node`] | its UI as data, drawn by fixed primitives |
//! | roles | `tools()`, `selects()`, `allows()`, `parse()`, `refresh()`, `watch()`, `wake()` | optional |
//!
//! Until an engine is initialised there are only components (this registry). Everything an
//! engine produces at runtime is data in its folder.
use crate::core::node::{Node, Size};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin, sync::Arc};

pub mod board;
pub mod caps;
pub mod code;
pub mod changes;
pub mod companion;
pub mod figure;
pub mod held;
pub mod files;
pub mod flow;
pub mod manifest;
pub mod media;
pub mod models;
pub mod node;
pub mod pack;
pub mod param;
pub mod places;
pub mod routes;
pub mod room;
pub mod run;
pub mod session;
pub mod boot;
pub mod store;
pub mod surfaces;
pub mod tables;
pub mod tasks;
pub mod world;
pub mod engine;
pub mod tool;

pub use engine::{Engine, EngineFile};
pub use tool::{text, tool, IntoTool, Tool, Toolbox};

pub type Fut<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// The file form of every component: `elements/<name>.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Spec {
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub state: Value,
}

/// What happens to an engine; components react in `on`.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A run begins; `run` is its id ([`run::Run::id`]). Sent before the input.
    Started { run: u64 },
    Input(String),
    Reply(String),
    Called { tool: String, args: Value, result: String },
    Snapshot { name: String, content: String },
    Observed { name: String, value: f64 },
    /// Context was folded into this summary (refocus).
    Folded(String),
    /// The user cleared the conversation (history forgets its turns).
    Cleared,
    /// The element now belongs to the engine at this path (sent once, when the engine is built).
    Bound(String),
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Call {
    pub tool: String,
    #[serde(default)]
    pub args: Value,
}

/// A parsed model reply: calls to run and/or a final answer.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reply {
    /// Custom fields written before calls/answer (`thinking`, `plan`, …), in reply order.
    pub fields: Vec<(String, String)>,
    pub calls: Vec<Call>,
    pub answer: Option<String>,
    /// Continue after the first call finishes instead of all (`await: any`); the rest are cancelled.
    pub wait_any: bool,
}

/// Something to poll: run `source` every `every_ms`, feed the number back as `Observed`.
#[derive(Clone, Debug, PartialEq)]
pub struct Watch {
    pub name: String,
    pub every_ms: u64,
    pub source: Call,
}

pub trait Component: Send + Sync {
    fn kind(&self) -> &'static str;
    fn name(&self) -> &str;
    fn doc(&self) -> &'static str;
    /// Catalog group: `prompt` (shapes the prompt), `action` (what it can do), `live` (watches
    /// the world), `model` (how the model is called). Required, so a new kind cannot forget it.
    fn category(&self) -> &'static str;
    /// Icon name (`components::ICONS`) for its views. Required for the same reason.
    fn icon(&self) -> &'static str;
    /// Where its prompt section sits; core owns the order of slots, never of kinds.
    fn slot(&self) -> Slot {
        Slot::Other
    }
    /// At most one element of this kind per engine (its role is a singleton: the reply format,
    /// the phase list, sampling). A second one is refused when the engine is built.
    fn unique(&self) -> bool {
        false
    }
    /// It reads the engine's message box, so others may post to this engine.
    fn receives(&self) -> bool {
        false
    }
    /// Names of the tools it contributes that the engine card shows (scripts, phase moves).
    fn abilities(&self) -> Vec<String> {
        vec![]
    }
    /// Recent tool calls `(call, result)`, oldest first (the run log on cards).
    fn log(&self) -> Vec<(String, String)> {
        vec![]
    }
    /// One line on where the work stands (latest reply summary, refocus summary).
    fn summary(&self) -> Option<String> {
        None
    }
    /// The conversation `(role, raw text)` in order, for the chat view.
    fn transcript(&self) -> Vec<(String, String)> {
        vec![]
    }
    /// What it has put on the board, oldest first, each with the run that drew it.
    fn figures(&self) -> Vec<figure::Shown> {
        vec![]
    }
    /// What the model should be shown beside the prompt on the next request (images).
    fn media(&self) -> Vec<media::Attachment> {
        vec![]
    }
    fn config(&self) -> Value;
    fn state(&self) -> Value;
    fn view(&self) -> Node;
    fn on(&mut self, _ev: &Event) {}
    fn prompt(&self) -> Option<String> {
        None
    }
    /// A short reminder placed at the very end of the prompt, after the input (e.g. the reply format).
    fn nudge(&self) -> Option<String> {
        None
    }
    /// Tools this component contributes (set_phase, a script, …).
    fn tools(&self) -> Vec<Arc<dyn Tool>> {
        vec![]
    }
    /// Whether a shared (global) tool is selected for this engine.
    fn selects(&self, _tool: &str) -> bool {
        false
    }
    /// Veto any tool right now (phase gating).
    fn allows(&self, _tool: &str) -> bool {
        true
    }
    /// Hide another element's prompt section right now (phase `elements`).
    fn shows(&self, _element: &str) -> bool {
        true
    }
    /// Turn a model reply into calls/answer (the response component).
    fn parse(&self, _reply: &str) -> Option<Reply> {
        None
    }
    /// A call whose result becomes this component's snapshot before each step (live artifact).
    fn refresh(&self) -> Option<Call> {
        None
    }
    fn watch(&self) -> Option<Watch> {
        None
    }
    /// Input to wake the engine with, if an observation fired (alert).
    fn wake(&mut self) -> Option<String> {
        None
    }
    fn spec(&self) -> Spec {
        Spec { kind: self.kind().into(), name: self.name().into(), config: self.config(), state: self.state() }
    }
    /// Live activity, shown on every view and driving its effects (idle, armed, fired, …).
    fn activity(&self) -> String {
        "idle".into()
    }
    /// The instruction to send when the context is nearly full (a phase marked `refocus`).
    fn refocus(&self) -> Option<String> {
        None
    }
    /// The current phase name (the phase element only).
    fn phase(&self) -> Option<String> {
        None
    }
    /// Sampling for the next request, given the current phase (the sampling element only).
    fn sampling(&self, _phase: Option<&str>) -> Option<Sampling> {
        None
    }
    /// A short state marker shown beside the icon (the phase element: its current phase).
    fn indicator(&self) -> Option<String> {
        None
    }
    /// One of the three view templates. Default: small = the live icon; medium = a card whose
    /// note is the first line of `view()` and whose body is the rest; large = all of `view()`
    /// plus config and state.
    fn render(&self, size: Size) -> Node {
        let n = Node::object(self.kind(), self.name(), size, &self.activity()).icon(self.icon());
        let mut body = self.view().children;
        match size {
            Size::Small => n,
            Size::Medium => {
                let note = self.indicator().or_else(|| body.first().map(|c| c.text.clone())).unwrap_or_default();
                if self.indicator().is_none() && !body.is_empty() {
                    body.remove(0);
                }
                n.note(&note).children(body)
            }
            Size::Large => {
                let json = |v: Value| serde_json::to_string_pretty(&v).unwrap_or_default();
                n.note(&self.indicator().unwrap_or_default()).children(body).child(Node::new("muted").text(&format!("config {}", json(self.config())))).child(Node::new("muted").text(&format!("state {}", json(self.state()))))
            }
        }
    }
}

/// One titled part of a prompt; `kind` is the element kind (or `tools` / `input`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Section {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub slot: Slot,
    pub body: String,
}

/// The fixed prompt order (stable first, so the prefix caches; volatile last). Core decides the
/// order of these slots; each element only says which slot it fills. Within a slot: core's own
/// section (the toolbox) first, then by element name. The input and the nudges always close.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Slot {
    /// What to achieve (the goal).
    Purpose,
    /// What was learnt and noted.
    Knowledge,
    /// What it can do (the toolbox, scripts).
    Tools,
    /// How to answer (the reply format's rules).
    Format,
    /// Where the work stands (phase, state).
    Position,
    /// What the world looks like now (live artifacts, alerts, workspace).
    World,
    /// What was said and done (history).
    Conversation,
    /// Anything else, after the conversation.
    #[default]
    Other,
    /// The request itself, then the closing nudge.
    Input,
}

/// Slots a refocus request keeps: purpose and knowledge, position, conversation, input.
pub const REFOCUS_SLOTS: &[Slot] = &[Slot::Purpose, Slot::Knowledge, Slot::Position, Slot::Conversation, Slot::Input];

/// Kind of core's own toolbox section (first in the `Tools` slot).
pub const TOOLBOX: &str = "tools";

/// Put sections in prompt order: by slot, core's toolbox first within its slot, then by name.
pub fn order(sections: &mut [Section]) {
    sections.sort_by(|a, b| (a.slot, a.kind != TOOLBOX, &a.name).cmp(&(b.slot, b.kind != TOOLBOX, &b.name)));
}

/// Sections as prompt text: `## name` then the body.
pub fn render(sections: &[Section]) -> String {
    let mut out: String = sections.iter().map(|s| format!("## {}\n{}\n\n", s.name, s.body)).collect();
    out.truncate(out.trim_end().len());
    out.push('\n');
    out
}

/// Sampling knobs sent with a request. `None` = not sent, so the model's own default applies.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Sampling {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
}

/// Model access, implemented once per runtime (HTTP APIs, CLIs, test fakes).
pub trait Infer: Send + Sync {
    fn complete(&self, model: &str, prompt: String, sampling: Sampling) -> Fut<Result<String, String>>;
    /// The same, with things to show the model beside the prompt (images). A runtime that
    /// cannot show them answers from the prompt alone.
    fn complete_with(&self, model: &str, prompt: String, sampling: Sampling, _media: Vec<media::Attachment>) -> Fut<Result<String, String>> {
        self.complete(model, prompt, sampling)
    }
    /// The model's context window in tokens; 0 = unknown (no refocus).
    fn context(&self, _model: &str) -> Fut<usize> {
        Box::pin(async { 0 })
    }
}

/// Rough token count of a text (≈ 4 chars per token), enough to budget the context window.
pub fn tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

/// Read a config/state value into `T`; null means `T::default()`.
pub fn read<T: DeserializeOwned + Default>(v: &Value) -> Result<T, String> {
    if v.is_null() {
        Ok(T::default())
    } else {
        serde_json::from_value(v.clone()).map_err(|e| e.to_string())
    }
}

/// Write `T` as a JSON value.
pub fn value<T: Serialize>(t: &T) -> Value {
    serde_json::to_value(t).unwrap_or(Value::Null)
}

pub type Ctor = fn(Spec) -> Result<Box<dyn Component>, String>;

/// One kind of element: its name, how it is built, and every config key it reads.
pub struct Kind {
    pub name: &'static str,
    pub new: Ctor,
    pub params: &'static [Param],
}

use param::{craft, personal, Param};

/// Every component kind. Adding a kind = one file in `elements/` + one entry here.
pub const KINDS: &[Kind] = &[
    Kind { name: "phase", new: crate::elements::phase::new, params: &[
        craft("phases", "the phases in order: name, goal, tools allowed, when to move on"),
        craft("repeat", "after the last phase, start again at the first"),
    ] },
    Kind { name: "handoff", new: crate::elements::handoff::new, params: &[
        craft("format", "the reply format: toon or json"),
        craft("fields", "named fields written before calls and answer"),
        craft("nudge", "a reminder at the end of the prompt"),
    ] },
    Kind { name: "tools", new: crate::elements::tools::new, params: &[
        craft("use", "the shared tools this engine may call, by name"),
    ] },
    Kind { name: "history", new: crate::elements::history::new, params: &[
        craft("max", "turns kept before the oldest are dropped"),
    ] },
    Kind { name: "state", new: crate::elements::state::new, params: &[] },
    Kind { name: "artifact", new: crate::elements::artifact::new, params: &[
        craft("read", "the call that reads the artifact into the prompt"),
    ] },
    Kind { name: "alert", new: crate::elements::alert::new, params: &[
        craft("source", "the call polled for a number; put a hole where it names what you watch"),
        craft("every_ms", "how often it polls"),
        craft("when", "the condition that wakes the engine"),
        craft("wake", "the message the engine is woken with"),
        craft("keep", "how many observations are kept"),
    ] },
    Kind { name: "script", new: crate::elements::script::new, params: &[
        craft("description", "what the script does, shown to the model"),
        craft("steps", "the calls it makes in order"),
    ] },
    Kind { name: "notes", new: crate::elements::notes::new, params: &[
        craft("file", "the markdown file in the engine folder that holds the notes"),
        craft("mode", "replace, sections or list"),
        craft("hint", "shown when the notes are empty"),
        craft("share", "the text is craft (a goal, a skill) and goes into a pack; otherwise it is personal"),
    ] },
    Kind { name: "sampling", new: crate::elements::sampling::new, params: &[
        craft("use", "the preset in force"),
        craft("phases", "the preset for each phase"),
        craft("presets", "named sampling settings"),
    ] },
    Kind { name: "inbox", new: crate::elements::inbox::new, params: &[] },
    Kind { name: "workspace", new: crate::elements::workspace::new, params: &[
        personal("root", "the folder it works in"),
        craft("exclude", "paths never shown"),
        craft("protect", "paths never written"),
    ] },
    Kind { name: "whiteboard", new: crate::elements::whiteboard::new, params: &[
        craft("max", "figures kept on the board"),
    ] },
    Kind { name: "attachments", new: crate::elements::attachments::new, params: &[
        craft("shown", "attachments shown to the model at once"),
    ] },
];

pub fn kind(name: &str) -> Option<&'static Kind> {
    KINDS.iter().find(|k| k.name == name)
}

pub fn build(spec: Spec) -> Result<Box<dyn Component>, String> {
    let k = kind(&spec.kind).ok_or_else(|| format!("unknown kind '{}'", spec.kind))?;
    param::check(&spec.config, k.params).map_err(|e| format!("{}: {e}", k.name))?;
    (k.new)(spec).map_err(|e| format!("{}: {e}", k.name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The abstract contract, checked for every registered kind: builds from an empty spec,
    /// documents itself, round-trips its spec, reacts to events, renders a view, and its state
    /// survives a rebuild (restart).
    #[test]
    fn every_kind_obeys_the_contract() {
        for Kind { name: kind, .. } in KINDS {
            let mut c = build(Spec { kind: kind.to_string(), name: "x".into(), ..Default::default() })
                .unwrap_or_else(|e| panic!("{kind} must build from an empty config: {e}"));
            assert_eq!(c.kind(), *kind);
            assert_eq!(c.name(), "x");
            assert!(!c.doc().is_empty(), "{kind} needs docs");
            assert_eq!(build(c.spec()).unwrap().spec(), c.spec(), "{kind} spec must round-trip");
            for ev in [
                Event::Started { run: 1 },
                Event::Input("hi".into()),
                Event::Reply("ok".into()),
                Event::Called { tool: "t".into(), args: json!({}), result: "r".into() },
                Event::Observed { name: "x".into(), value: 1.0 },
                Event::Folded("summary".into()),
            ] {
                c.on(&ev);
            }
            let _ = c.view();
            for size in Size::ALL {
                let n = c.render(size);
                assert_eq!((n.kind.as_str(), n.text.as_str(), n.size.as_str()), ("object", *kind, size.as_str()), "{kind} renders itself at every size");
                assert!(!n.state.is_empty(), "{kind} view carries its activity");
            }
            assert_eq!(c.render(Size::Small).children.len(), 0, "{kind}: small is only the live icon");
            assert!(!c.render(Size::Small).icon.is_empty(), "{kind} has an icon");
            assert!(["prompt", "action", "live", "model"].contains(&c.category()), "{kind}: unknown category '{}'", c.category());
            assert!(crate::ui::web::components::ICONS.iter().any(|(n, _)| *n == c.icon()), "{kind}: icon '{}' is not in ICONS", c.icon());
            assert_eq!(build(c.spec()).unwrap().spec(), c.spec(), "{kind} state must survive a restart");
        }
    }

    /// Every key a kind reads is declared with whose it is and what it does; a key it does not
    /// declare is refused, so a misspelt knob never silently does nothing.
    #[test]
    fn every_kind_declares_its_keys_and_refuses_others() {
        for k in KINDS {
            for p in k.params {
                assert!(!p.doc.is_empty(), "{}.{} needs a doc", k.name, p.key);
                assert_eq!(k.params.iter().filter(|q| q.key == p.key).count(), 1, "{}.{} declared twice", k.name, p.key);
            }
            let e = build(Spec { kind: k.name.into(), name: "x".into(), config: json!({"no_such_key": 1}), ..Default::default() })
                .err()
                .unwrap_or_else(|| panic!("{} must refuse an unknown key", k.name));
            assert!(e.contains("'no_such_key'"), "{}: {e}", k.name);
        }
    }

    /// Every element shipped in `defaults/` uses only declared keys.
    #[test]
    fn every_shipped_element_uses_declared_keys() {
        fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, out)
                } else if p.extension().is_some_and(|x| x == "json") {
                    out.push(p)
                }
            }
        }
        let mut files = vec![];
        walk(std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/defaults")), &mut files);
        let mut seen = 0;
        for f in files {
            let Ok(v) = serde_json::from_str::<Value>(&std::fs::read_to_string(&f).unwrap()) else { continue };
            let Some(kind) = v.get("kind").and_then(Value::as_str) else { continue };
            let k = self::kind(kind).unwrap_or_else(|| panic!("{}: unknown kind '{kind}'", f.display()));
            seen += 1;
            param::check(v.get("config").unwrap_or(&Value::Null), k.params).unwrap_or_else(|e| panic!("{}: {e}", f.display()));
        }
        assert!(seen > 20, "only {seen} element files found");
    }

    #[test]
    fn prompt_order_is_fixed_by_slot_then_name_with_input_last() {
        let s = |k: &str, n: &str, slot: Slot| Section { name: n.into(), kind: k.into(), slot, body: "b".into() };
        let mut v = vec![
            s("handoff", "r", Slot::Format),
            s("history", "h", Slot::Conversation),
            s("notes", "learning", Slot::Knowledge),
            s("script", "build", Slot::Tools),
            s("notes", "goal", Slot::Purpose),
            s("state", "z", Slot::Position),
            s("state", "a", Slot::Position),
            s(TOOLBOX, "tools", Slot::Tools),
            s("custom", "zz", Slot::Other),
        ];
        order(&mut v);
        assert_eq!(v.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["goal", "learning", "tools", "build", "r", "a", "z", "h", "zz"]);
        assert_eq!(render(&[s("notes", "g", Slot::Purpose), s("input", "input", Slot::Input)]), "## g\nb\n\n## input\nb\n");
    }

    /// Rigid rule: core never names an element kind. Kinds speak for themselves through the
    /// contract (category, icon, slot, roles); the registry in [`KINDS`] is the one place a kind
    /// name appears. Adding a kind must never need an edit here.
    #[test]
    fn core_never_names_an_element_kind() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/core");
        for f in std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()) {
            let src = std::fs::read_to_string(&f).unwrap();
            let code = src.split("#[cfg(test)]").next().unwrap();
            for (n, line) in code.lines().enumerate() {
                if line.contains("crate::elements::") && line.trim_start().starts_with("Kind { name: \"") || line.contains("pub const TOOLBOX") {
                    continue;
                }
                for Kind { name: kind, .. } in KINDS {
                    assert!(!line.contains(&format!("\"{kind}\"")), "{}:{}: names kind '{kind}': {}", f.display(), n + 1, line.trim());
                }
            }
        }
    }

    #[test]
    fn unknown_kind_is_an_error() {
        assert!(build(Spec { kind: "nope".into(), ..Default::default() }).is_err());
    }
}
