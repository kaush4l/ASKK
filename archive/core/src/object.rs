//! Objects: what every engine and element is, and the kind trait a new element kind implements.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::{collections::BTreeMap, future::Future, pin::Pin};

use crate::node::{Node, tone};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Idle,
    Running,
    Waiting,
    Stopped,
    Interrupted,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Action {
    pub name: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<BTreeMap<String, String>>,
}

impl Action {
    pub fn new(name: &str, label: &str) -> Self {
        Self { name: name.into(), label: label.into(), args: None }
    }
    /// `kind`: "text" | "number" | "bool".
    pub fn arg(mut self, field: &str, kind: &str) -> Self {
        self.args.get_or_insert_with(BTreeMap::new).insert(field.into(), kind.into());
        self
    }
}

/// One tree per card size (contract §2): `icon` (the tiniest: light + short label), `small` (overview), `medium` (expanded), `large`
/// (intense). All three always present, each rooted in a `Card`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Views {
    pub icon: Node,
    pub small: Node,
    pub medium: Node,
    pub large: Node,
}

/// The sizes, smallest first: the names of `Views`' fields and of `Slot`'s `at`.
/// (A full-screen size may follow `large` later.)
pub const SIZES: [&str; 4] = ["icon", "small", "medium", "large"];

/// The live status of an object (contract §2): its phase tone, one line of what it does now,
/// and since when (unix seconds) it has been in this phase.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Status {
    pub light: &'static str,
    pub now: String,
    pub since: u64,
    /// One line: what the object is focused on now (the small card's summary).
    pub focus: String,
    /// A phase label ("💬 Chat") when the object or its engine has a phase; null otherwise.
    pub chip: Option<String>,
}

impl Status {
    pub fn of(obj: &Obj, now: Option<String>) -> Self {
        let word = json!(obj.phase).as_str().unwrap_or("idle").to_string();
        let now = now.filter(|s| !s.is_empty()).unwrap_or(word);
        Status { light: tone(obj.phase), focus: now.clone(), now, since: obj.since, chip: None }
    }
    pub fn with_focus(mut self, focus: Option<String>) -> Self {
        if let Some(f) = focus.map(|f| one_line(&f)).filter(|f| !f.is_empty()) {
            self.focus = f;
        }
        self
    }
}

impl Views {
    /// Every size rooted in a Card carrying `size` and the object's `status`: a size tree that is
    /// not a Card is wrapped in one titled by the object. Idempotent.
    pub fn finish(self, title: &str, phase: Phase, status: &Status) -> Self {
        let f = |n: Node, size: &str| {
            let mut n = if n.c == "Card" {
                n
            } else {
                let mut n = n;
                // the Card carries the title: a row that leads with it would say it twice
                if n.children.first().is_some_and(|k| k.c == "Text" && k.props.get("value") == Some(&json!(title))) {
                    n.children.remove(0);
                }
                crate::node::card(title, phase, vec![n])
            };
            n.props.insert("size".into(), json!(size));
            if size == "large" && !n.props.contains_key("scene") {
                n.props.insert("scene".into(), json!("default"));
            }
            n.props.insert("status".into(), json!(status));
            n
        };
        Views { icon: f(self.icon, "icon"), small: f(self.small, "small"), medium: f(self.medium, "medium"), large: f(self.large, "large") }
    }

    /// Every object's icon size is its Avatar alone; the other sizes carry the avatar in their header (`icon`
    /// on the root Card). `live` = (running below, open asks, failed below) for an engine. Idempotent.
    pub fn with_avatar(mut self, icon: &str, title: &str, phase: Phase, light: &str, live: (u64, u64, u64)) -> Self {
        let avatar = crate::node::avatar(icon, title, phase, light, live);
        self.icon.children = vec![avatar];
        for n in [&mut self.icon, &mut self.small, &mut self.medium, &mut self.large] {
            n.props.insert("icon".into(), json!(icon));
        }
        self
    }
}

/// An object's avatar: its own `icon:` (kept in config by the loader), else the given default.
pub fn icon_of(obj: &Obj, default: &str) -> String {
    obj.config.get("icon").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or(default).to_string()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Twin {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub phase: Phase,
    pub state: Value,
    /// The current config map from the file, {} when none (edit forms prefill from it).
    pub config: Value,
    pub actions: Vec<Action>,
    pub views: Views,
    pub status: Status,
    pub prompt: String,
    /// `description:` from its file; omitted when empty.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub description: String,
    /// The object's avatar: its `icon:` (an emoji, or a /ui/assets/ image), else its kind's default.
    pub icon: String,
    /// What it did, newest first (≤ ACTIVITY_CAP): {at, action, by, text, ok}.
    pub activity: Vec<Value>,
}

/// How many activity entries an object keeps.
pub const ACTIVITY_CAP: usize = 20;

/// One line, at most 120 chars.
pub fn one_line(s: &str) -> String {
    let l = s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let mut out: String = l.chars().take(120).collect();
    if l.chars().count() > 120 {
        out.push('…');
    }
    out
}

/// Short text, at most `n` chars.
pub fn clip(s: &str, n: usize) -> String {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > n { format!("{}…", s.chars().take(n.saturating_sub(1)).collect::<String>()) } else { s }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EngineTwin {
    #[serde(flatten)]
    pub twin: Twin,
    pub elements: Vec<Twin>,
    pub children: Vec<EngineTwin>,
    /// What runs / failed below the engine (contract §2); its own `phase` is separate.
    pub summary: crate::engine::Summary,
    /// The engine's `children:` presentation defaults from engine.md (`{size?, kinds?}`), null when none.
    pub children_defaults: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KindInfo {
    pub kind: String,
    pub about: String,
    pub config: BTreeMap<String, String>,
}

/// An object as loaded: its file (title, config, body) plus its saved phase and state.
#[derive(Debug, Clone, PartialEq)]
pub struct Obj {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub order: i64,
    pub config: Map<String, Value>,
    /// `description:` from the frontmatter: what the object is for, one line or a few.
    pub description: String,
    pub body: String,
    pub phase: Phase,
    pub state: Value,
    /// Set when the object's `.md` could not be loaded: it is `failed`, its state is `{error}`,
    /// and nothing about it is written to the store until the file is fixed.
    pub error: Option<String>,
    /// Unix seconds since the object entered its current phase (running and waiting count as one).
    pub since: u64,
    /// What it did, oldest first, ≤ ACTIVITY_CAP; saved beside its state.
    pub activity: Vec<Value>,
}

/// The body of a long-running action (see `Kind::task`). It runs as a tokio task; it changes its
/// object only through `TaskCtx::update`. Ok ends `idle`, Err ends `failed`, a cancel ends `stopped`.
pub type TaskFuture = Pin<Box<dyn Future<Output = Result<()>> + Send>>;
pub type TaskFn = fn(crate::hub::TaskCtx) -> TaskFuture;
/// The callback of a waiting object (`Hub::wake`): check its waiting condition, advance when met.
pub type WakeFn = fn(crate::hub::Hub, String) -> TaskFuture;

impl Obj {
    pub fn num(&self, key: &str, default: f64) -> f64 {
        self.config.get(key).and_then(Value::as_f64).unwrap_or(default)
    }
    pub fn saved(&self) -> Value {
        json!({ "phase": self.phase, "state": self.state, "since": self.since, "activity": self.activity })
    }
    /// Record one thing it did (capped, oldest dropped).
    pub fn record(&mut self, action: &str, by: &str, text: &str, ok: bool) {
        self.activity.push(json!({ "at": crate::now(), "action": action, "by": by, "text": clip(text, 80), "ok": ok }));
        let n = self.activity.len();
        if n > ACTIVITY_CAP {
            self.activity.drain(..n - ACTIVITY_CAP);
        }
    }
    /// Newest first, for the twin.
    pub fn activity_newest(&self) -> Vec<Value> {
        self.activity.iter().rev().cloned().collect()
    }
    /// Record a phase change: `since` moves to now when the phase class changed from `before`.
    pub fn mark(&mut self, before: Phase) {
        let busy = |p: Phase| matches!(p, Phase::Running | Phase::Waiting);
        if before != self.phase && !(busy(before) && busy(self.phase)) || self.since == 0 {
            self.since = crate::now();
        }
    }
}

/// An element kind. A new kind is one file implementing this, listed in `kinds::KINDS`.
pub trait Kind: Send + Sync {
    fn kind(&self) -> &'static str;
    fn about(&self) -> &'static str;
    /// Config fields the kind reads: field → "text" | "number" | "bool".
    fn config(&self) -> &'static [(&'static str, &'static str)];
    /// The state of a fresh element.
    fn init(&self, obj: &Obj) -> Value;
    fn actions(&self, obj: &Obj) -> Vec<Action>;
    fn act(&self, obj: &mut Obj, action: &str, args: &Value) -> Result<()>;
    /// The tiniest form: a short label (the Card adds the light).
    fn icon(&self, obj: &Obj) -> Node {
        crate::node::badge(obj.title.as_str(), tone(obj.phase))
    }
    /// Overview: one line of the essentials (wrapped in the object's Card when it is not one).
    fn small(&self, obj: &Obj) -> Node;
    /// Expanded: the working set.
    fn medium(&self, obj: &Obj) -> Node;
    /// Intense: everything.
    fn large(&self, obj: &Obj) -> Node {
        self.medium(obj)
    }
    /// One line of what it is doing now (the status line); None = its phase word.
    fn now(&self, _obj: &Obj) -> Option<String> {
        None
    }
    fn prompt(&self, obj: &Obj) -> String;
    /// One line of what it is focused on (the small card's summary); None = its `now`.
    fn focus(&self, _obj: &Obj) -> Option<String> {
        None
    }
    /// What a task change did, as (action, text, ok) entries (recorded by `by: task`). The default: phase ends only.
    fn activity(&self, before: &Obj, after: &Obj) -> Vec<(String, String, bool)> {
        phase_activity(before, after)
    }
    /// A long-running action: `act` runs first (synchronously, e.g. phase → running), then this
    /// task is spawned. None (the default) = the action is done when `act` returns.
    fn task(&self, _obj: &Obj, _action: &str) -> Option<TaskFn> {
        None
    }
    /// The kind's wake handler (`Hub::wake` dispatches on the kind): a loop takes its next step
    /// when its `state.waiting` is met; a workflow kind may plug in its own. None = wakes are ignored.
    fn wake(&self) -> Option<WakeFn> {
        None
    }

    /// The kind's default avatar (an emoji).
    fn avatar(&self) -> &'static str {
        "◻️"
    }

    fn info(&self) -> KindInfo {
        KindInfo { kind: self.kind().into(), about: self.about().into(), config: self.config().iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() }
    }

    /// The twin as seen inside its engine (its siblings, its parent). Kinds whose views or
    /// prompt depend on the engine (loop, tools) override this; the default ignores it.
    fn twin_in(&self, obj: &Obj, _eng: Option<&crate::engine::EngineNode>) -> Twin {
        self.twin(obj)
    }

    fn twin(&self, obj: &Obj) -> Twin {
        let status = Status::of(obj, self.now(obj)).with_focus(self.focus(obj));
        let icon = icon_of(obj, self.avatar());
        Twin {
            id: obj.id.clone(),
            kind: obj.kind.clone(),
            title: obj.title.clone(),
            phase: obj.phase,
            state: obj.state.clone(),
            config: Value::Object(obj.config.clone()),
            actions: self.actions(obj),
            views: Views { icon: self.icon(obj), small: self.small(obj), medium: self.medium(obj), large: self.large(obj) }.finish(&obj.title, obj.phase, &status).with_avatar(
                &icon,
                &obj.title,
                obj.phase,
                status.light,
                (0, 0, 0),
            ),
            status,
            prompt: self.prompt(obj),
            description: obj.description.clone(),
            icon,
            activity: obj.activity_newest(),
        }
    }
}

/// The default activity of a task change: a phase end or start.
pub fn phase_activity(before: &Obj, after: &Obj) -> Vec<(String, String, bool)> {
    if before.phase == after.phase {
        return vec![];
    }
    match after.phase {
        Phase::Idle => vec![("done".into(), "done".into(), true)],
        Phase::Failed => {
            vec![("failed".into(), format!("failed: {}", after.state["error"].as_str().unwrap_or("?")), false)]
        }
        Phase::Stopped => vec![("stopped".into(), "stopped".into(), true)],
        Phase::Interrupted => vec![("interrupted".into(), "interrupted".into(), false)],
        Phase::Running | Phase::Waiting if !matches!(before.phase, Phase::Running | Phase::Waiting) => {
            vec![("start".into(), "started".into(), true)]
        }
        _ => vec![],
    }
}
