//! Engines: one folder each (`engine.md`, `elements/*.md`, `engines/*/`), loaded from the Store.

use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};
use std::collections::HashMap;

use crate::Store;
use crate::frontmatter::{self, Doc};
use crate::kinds;
use crate::node::{Node, badge, button, card, col, row, slot, text, tone};
use crate::object::{Action, EngineTwin, Obj, Phase, Status, Twin, Views};

/// Counts below an engine (contract §2): `running` = running or waiting, `failed` = failed.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Serialize)]
pub struct Summary {
    pub running: usize,
    pub failed: usize,
}

/// A loaded engine: itself, its elements, its child engines. `dir` is its folder under the store.
#[derive(Debug, Clone)]
pub struct EngineNode {
    pub obj: Obj,
    pub dir: String,
    pub elements: Vec<Obj>,
    pub children: Vec<EngineNode>,
}

/// How a load treats what it finds. `strict` (only `load_all`, a strict check; boot and reload are not strict): a broken file is an error naming it.
/// Not strict (boot, reload): a broken file becomes a `failed` object and the rest loads.
/// `live`: objects already running in memory; one with the same id and kind keeps its phase and
/// state (a config edit never resets live state), anything else is restored from the store.
pub struct Load<'a> {
    pub store: &'a dyn Store,
    pub crashed: bool,
    pub strict: bool,
    pub live: Option<&'a HashMap<String, Obj>>,
}

/// Every top engine; an empty or missing `engines/` is seeded first.
pub fn load_all(store: &dyn Store, crashed: bool) -> Result<Vec<EngineNode>> {
    load_with(&Load { store, crashed, strict: true, live: None })
}

pub fn load_with(l: &Load) -> Result<Vec<EngineNode>> {
    let store = l.store;
    let mut ids = with_engine_md(store, "engines")?;
    if ids.is_empty() {
        crate::seed::write(store)?;
        ids = with_engine_md(store, "engines")?;
    }
    let mut out = ids.iter().map(|id| load(l, &format!("engines/{id}"), "", id)).collect::<Result<Vec<_>>>()?;
    out.sort_by(|a, b| (a.obj.order, &a.obj.id).cmp(&(b.obj.order, &b.obj.id)));
    Ok(out)
}

fn with_engine_md(store: &dyn Store, dir: &str) -> Result<Vec<String>> {
    let mut ids = vec![];
    for d in store.dirs(dir)? {
        if store.read_text(&format!("{dir}/{d}/engine.md"))?.is_some() {
            ids.push(d);
        }
    }
    Ok(ids)
}

fn read_doc(store: &dyn Store, file: &str) -> Result<Doc> {
    let text = store.read_text(file)?.with_context(|| format!("{file}: missing"))?;
    frontmatter::parse(&text).with_context(|| format!("data/{file}"))
}

/// An engine's avatar when its engine.md sets no `icon:`.
pub const ENGINE_ICON: &str = "🧭";

/// `icon:` in a .md: one emoji / grapheme, or a /ui/assets/ image (design::check_icon); kept in config.
fn read_icon(doc: &Doc, file: &str) -> Result<Option<String>> {
    match doc.meta.get("icon") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => crate::design::check_icon(s).map(|_| Some(s.clone())).with_context(|| format!("data/{file}")),
        Some(v) => bail!("data/{file}: icon {v} must be an emoji or /ui/assets/<image>"),
    }
}

fn obj_from(doc: Doc, id: String, kind: String) -> Obj {
    let title = doc.meta.get("title").and_then(Value::as_str).map(String::from).unwrap_or_else(|| id.rsplit('/').next().unwrap_or(&id).to_string());
    let order = doc.meta.get("order").and_then(Value::as_i64).unwrap_or(i64::MAX);
    let config = doc.meta.get("config").and_then(Value::as_object).cloned().unwrap_or_default();
    let description = doc.meta.get("description").and_then(Value::as_str).map(|s| s.trim().to_string()).unwrap_or_default();
    Obj { id, kind, title, order, config, description, body: doc.body, phase: Phase::Idle, state: json!({}), error: None, since: 0, activity: vec![] }
}

/// A `.md` that could not be loaded, as an object: phase failed, state {error}.
fn failed(id: String, kind: &str, error: String) -> Obj {
    let title = id.rsplit('/').next().unwrap_or(&id).to_string();
    let state = json!({ "error": error });
    Obj { id, kind: kind.into(), title, order: i64::MAX, config: Map::new(), description: String::new(), body: String::new(), phase: Phase::Failed, state, error: Some(error), since: crate::now(), activity: vec![] }
}

/// Live phase and state when the same object runs in memory; else saved, else the kind's fresh
/// state; `running` after a crash → `interrupted`.
fn restore(l: &Load, obj: &mut Obj, fresh: Value, init_phase: Phase) -> Result<()> {
    if let Some(prev) = l.live.and_then(|m| m.get(&obj.id)).filter(|p| p.kind == obj.kind && p.error.is_none()) {
        obj.phase = prev.phase;
        obj.state = prev.state.clone();
        obj.since = prev.since;
        obj.activity = prev.activity.clone();
        return Ok(());
    }
    match l.store.read("state", &obj.id)? {
        Some(saved) => {
            obj.phase = serde_json::from_value(saved["phase"].clone()).unwrap_or(Phase::Idle);
            obj.state = if saved["state"].is_object() { saved["state"].clone() } else { fresh };
            obj.since = saved["since"].as_u64().unwrap_or(0);
            obj.activity = saved["activity"].as_array().cloned().unwrap_or_default();
        }
        None => {
            obj.state = fresh;
            obj.phase = init_phase;
        }
    }
    let before = obj.phase;
    if l.crashed && matches!(obj.phase, Phase::Running | Phase::Waiting) {
        obj.phase = Phase::Interrupted;
    }
    obj.mark(before);
    l.store.write("state", &obj.id, &obj.saved())
}

/// The state a `.md` starts with when nothing is saved (contract §1): its `state:` map laid over
/// the kind's fresh state key by key, and its `phase:` (idle when absent). `running` is refused:
/// no task stands behind a phase written in a file.
pub fn initial(doc: &Doc, fresh: Value) -> Result<(Phase, Value)> {
    let mut state = fresh;
    match doc.meta.get("state") {
        None | Some(Value::Null) => {}
        Some(Value::Object(m)) => {
            if !state.is_object() {
                state = json!({});
            }
            for (k, v) in m {
                state[k] = v.clone();
            }
        }
        Some(other) => bail!("state: must be a map like {{value: 3}}, got {other}"),
    }
    let phase = match doc.meta.get("phase") {
        None | Some(Value::Null) => Phase::Idle,
        Some(p) => match serde_json::from_value::<Phase>(p.clone()) {
            Ok(Phase::Running) => bail!("phase: running cannot be configured (no task runs behind it); use idle, waiting, stopped, interrupted or failed"),
            Ok(ph) => ph,
            Err(_) => bail!("phase: {p} is not one of idle, waiting, stopped, interrupted, failed"),
        },
    };
    Ok((phase, state))
}

fn engine_obj(l: &Load, file: &str, id: &str) -> Result<Obj> {
    let doc = read_doc(l.store, file)?;
    match doc.meta.get("kind") {
        None => {}
        Some(Value::String(k)) if k == "engine" => {}
        Some(k) => bail!("data/{file}: kind {k} is not engine"),
    }
    let (phase, state) = initial(&doc, json!({}))?;
    let icon = read_icon(&doc, file)?;
    let children = doc.meta.get("children").cloned();
    if let Some(c) = &children {
        crate::design::check_children(c).with_context(|| format!("data/{file}"))?;
    }
    let mut obj = obj_from(doc, id.to_string(), "engine".into());
    if let Some(c) = children {
        obj.config.insert("children".into(), c);
    }
    if let Some(i) = icon {
        obj.config.insert("icon".into(), json!(i));
    }
    restore(l, &mut obj, state, phase)?;
    Ok(obj)
}

fn element_obj(l: &Load, file: &str, id: String) -> Result<Obj> {
    let doc = read_doc(l.store, file)?;
    let kind = match doc.meta.get("kind") {
        Some(Value::String(k)) => k.clone(),
        _ => bail!("data/{file}: no kind (one of {})", kind_names()),
    };
    let Some(k) = kinds::find(&kind) else {
        bail!("data/{file}: unknown kind `{kind}` (one of {})", kind_names());
    };
    let meta = doc.clone();
    let icon = read_icon(&doc, file)?;
    let mut e = obj_from(doc, id, kind);
    if let Some(i) = icon {
        e.config.insert("icon".into(), json!(i));
    }
    let (phase, fresh) = initial(&meta, k.init(&e))?;
    restore(l, &mut e, fresh, phase)?;
    Ok(e)
}

/// The declared kind of a file that failed to load, when it can still be read.
fn declared_kind(store: &dyn Store, file: &str) -> String {
    let text = store.read_text(file).ok().flatten().unwrap_or_default();
    frontmatter::parse(&text).ok().and_then(|d| d.meta.get("kind").and_then(Value::as_str).map(String::from)).unwrap_or_else(|| "unknown".into())
}

fn load(l: &Load, dir: &str, prefix: &str, name: &str) -> Result<EngineNode> {
    let file = format!("{dir}/engine.md");
    let id = format!("{prefix}{name}");
    let obj = match engine_obj(l, &file, &id) {
        Ok(o) => o,
        Err(e) if !l.strict => failed(id.clone(), "engine", format!("{e:#}")),
        Err(e) => return Err(e),
    };

    let mut elements = vec![];
    for eid in l.store.files(&format!("{dir}/elements"), "md")? {
        let efile = format!("{dir}/elements/{eid}.md");
        let eid = format!("{id}/{eid}");
        match element_obj(l, &efile, eid.clone()) {
            Ok(e) => elements.push(e),
            Err(e) if !l.strict => elements.push(failed(eid, &declared_kind(l.store, &efile), format!("{e:#}"))),
            Err(e) => return Err(e),
        }
    }
    elements.sort_by(|a, b| (a.order, &a.id).cmp(&(b.order, &b.id)));

    let cdir = format!("{dir}/engines");
    let mut children = with_engine_md(l.store, &cdir)?
        .iter()
        .map(|c| load(l, &format!("{cdir}/{c}"), &format!("{id}/"), c))
        .collect::<Result<Vec<_>>>()?;
    children.sort_by(|a, b| (a.obj.order, &a.obj.id).cmp(&(b.obj.order, &b.obj.id)));
    Ok(EngineNode { obj, dir: dir.to_string(), elements, children })
}

fn kind_names() -> String {
    kinds::KINDS.iter().map(|k| k.kind()).collect::<Vec<_>>().join(", ")
}

/// The twin of an element that failed to load: its views show the error, it has no actions.
fn failed_twin(obj: &Obj) -> Twin {
    let err = obj.error.clone().unwrap_or_default();
    let status = Status { light: "error", now: format!("does not load: {}", err.lines().next().unwrap_or("")), since: obj.since, focus: "fix the file and it reloads".into(), chip: None };
    let shown = text(err.as_str()).p("mono", true).p("tone", "error").p("size", "sm");
    Twin {
        id: obj.id.clone(),
        kind: obj.kind.clone(),
        title: obj.title.clone(),
        phase: Phase::Failed,
        state: obj.state.clone(),
        config: json!({}),
        actions: vec![],
        views: Views {
            icon: card(&obj.title, Phase::Failed, vec![badge(obj.title.as_str(), "error")]),
            small: card(&obj.title, Phase::Failed, vec![row(vec![badge("failed", "error"), text("does not load").p("size", "sm")])]),
            medium: card(&obj.title, Phase::Failed, vec![shown.clone()]),
            large: card(&obj.title, Phase::Failed, vec![text("This file could not be loaded; fix it and it reloads.").p("size", "sm"), shown]),
        }
        .finish(&obj.title, Phase::Failed, &status)
        .with_avatar(&crate::object::icon_of(obj, "⚠️"), &obj.title, Phase::Failed, "error", (0, 0, 0)),
        status,
        prompt: format!("element \"{}\" ({}) failed to load: {err}", obj.title, obj.id),
        description: obj.description.clone(),
        icon: crate::object::icon_of(obj, "⚠️"),
        activity: obj.activity_newest(),
    }
}

pub fn element_twin(obj: &Obj, eng: Option<&EngineNode>) -> Twin {
    match (&obj.error, kinds::find(&obj.kind)) {
        (None, Some(k)) => {
            // kinds that redraw a size inside their engine (loop, tools) are finished again here
            let mut t = k.twin_in(obj, eng);
            t.status.chip = match obj.kind.as_str() {
                "loop" => eng.and_then(|e| e.phase_label()),
                "phases" => crate::run::current_phase(obj).map(|p| p.label()),
                "workflows" => crate::kinds::workflows::running_title(obj),
                _ => None,
            };
            t.views = t.views.finish(&obj.title, obj.phase, &t.status).with_avatar(&t.icon, &obj.title, obj.phase, t.status.light, (0, 0, 0));
            t
        }
        _ => failed_twin(obj),
    }
}

impl EngineNode {
    pub fn actions(&self) -> Vec<Action> {
        vec![
            Action::new("start", "Start"),
            Action::new("stop", "Stop"),
            Action::new("reply", "Reply").arg("ask", "text").arg("text", "text"),
            Action::new("element.add", "Add element").arg("kind", "text").arg("title", "text").arg("config", "text"),
            Action::new("element.remove", "Remove element").arg("id", "text"),
            Action::new("element.edit", "Edit element").arg("id", "text").arg("title", "text").arg("config", "text").arg("icon", "text"),
            Action::new("engine.add", "Add engine").arg("title", "text"),
            Action::new("engine.edit", "Edit engine").arg("title", "text").arg("description", "text").arg("body", "text").arg("icon", "text"),
            Action::new("engine.children", "Children size").arg("size", "text"),
            Action::new("engine.remove", "Remove engine").arg("id", "text"),
        ]
    }

    /// The current phase as people read it: its icon and title (`💬 Chat`), else its id.
    pub fn phase_label(&self) -> Option<String> {
        crate::run::first(self, "phases").and_then(crate::run::current_phase).map(|p| p.label())
    }

    /// What runs and what failed below this engine (its elements and child engines, any depth),
    /// never counting the engine itself: its own phase stays separate (contract §2).
    pub fn summary(&self) -> Summary {
        let mut s = Summary::default();
        let mut count = |p: Phase| match p {
            Phase::Running | Phase::Waiting => s.running += 1,
            Phase::Failed => s.failed += 1,
            _ => {}
        };
        for e in &self.elements {
            count(e.phase);
        }
        for c in &self.children {
            count(c.obj.phase);
        }
        for c in &self.children {
            let k = c.summary();
            s.running += k.running;
            s.failed += k.failed;
        }
        s
    }

    /// The summary as badges ("2 running", "1 failed"); none when nothing runs or failed below.
    fn summary_badges(&self) -> Vec<Node> {
        let s = self.summary();
        let mut out = vec![];
        if s.running > 0 {
            out.push(badge(format!("{} running", s.running), "busy"));
        }
        if s.failed > 0 {
            out.push(badge(format!("{} failed", s.failed), "error"));
        }
        out
    }

    pub fn act(&mut self, action: &str) -> Result<()> {
        if let Some(err) = &self.obj.error {
            bail!("{} failed to load: {err}", self.obj.id);
        }
        self.obj.phase = match action {
            "start" => Phase::Running,
            "stop" => Phase::Stopped,
            other => bail!("{} has no action {other}", self.obj.id),
        };
        Ok(())
    }

    /// `stop` cascades: every object below that is running or waiting turns `stopped` (tasks were
    /// cancelled by the Hub first). Returns the objects it changed, to persist.
    pub fn stop_below(&mut self) -> Vec<Obj> {
        let mut out = vec![];
        let own = self.obj.id.clone();
        for o in self.objs() {
            if o.id != own && o.error.is_none() && matches!(o.phase, Phase::Running | Phase::Waiting) {
                o.phase = Phase::Stopped;
                o.since = crate::now();
                out.push(o.clone());
            }
        }
        out
    }

    fn views(&self) -> Views {
        let o = &self.obj;
        let count = format!("{} element(s), {} engine(s)", self.elements.len(), self.children.len());
        let toggle = if o.phase == Phase::Running { button("Stop", "stop") } else { button("Start", "start").p("tone", "accent") };
        // the engine's `children:` defaults (engine.md) pick each slot's size; else the view's own
        let dflt = o.config.get("children");
        let slots = |at: &str| -> Vec<Node> {
            self.elements
                .iter()
                .map(|e| slot(&e.id, crate::design::child_size(dflt, &e.kind).unwrap_or(at)))
                .chain(self.children.iter().map(|c| slot(&c.obj.id, crate::design::child_size(dflt, "engine").unwrap_or(at))))
                .collect()
        };
        let mut card_kids = vec![];
        if let Some(err) = &o.error {
            card_kids.push(text(err.as_str()).p("mono", true).p("tone", "error").p("size", "sm"));
        }
        if !o.description.is_empty() {
            card_kids.push(text(o.description.as_str()).p("md", true).p("size", "sm"));
        }
        card_kids.push(self.capabilities());
        card_kids.extend(self.ask_rows());
        card_kids.push(Node::new("Widgets").kids(slots("small")));
        let foot = |toggle: Node| {
            let mut left = vec![badge(json!(o.phase), tone(o.phase))];
            left.extend(self.summary_badges());
            row(vec![Node::new("Stack").p("dir", "row").p("gap", 2).p("wrap", true).kids(left), toggle])
        };
        card_kids.push(foot(toggle.clone()));

        let mut full_kids = vec![];
        if let Some(err) = &o.error {
            full_kids.push(text(err.as_str()).p("mono", true).p("tone", "error"));
        }
        for t in [&o.description, &o.body].into_iter().filter(|t| !t.is_empty()) {
            full_kids.push(text(t.as_str()).p("md", true));
        }
        full_kids.push(self.capabilities());
        full_kids.extend(self.ask_rows());
        full_kids.push(Node::new("Divider"));
        full_kids.push(Node::new("Widgets").kids(slots("small")));
        full_kids.push(foot(toggle));
        Views {
            icon: card(&o.title, o.phase, vec![badge(o.title.as_str(), tone(o.phase))]),
            small: card(&o.title, o.phase, vec![row([vec![text(count).p("size", "sm")], self.phase_label().map(|l| badge(l, "accent")).into_iter().collect(), self.summary_badges(), vec![badge(json!(o.phase), tone(o.phase))]].concat())]),
            medium: card(&o.title, o.phase, card_kids),
            large: card(&o.title, o.phase, full_kids).p("scene", "spatial"),
        }
    }

    /// What this engine is made of, as badges: its model, its loop, its phase, its tools —
    /// "No tools" when it has no tools element or an empty list.
    pub fn capabilities(&self) -> Node {
        let mut b = vec![];
        match crate::run::first(self, "model") {
            Some(m) => {
                let spec = crate::connector::ModelSpec::from_config(&m.config);
                b.push(badge(format!("model: {}", crate::kinds::model::label(&spec)), "neutral"));
            }
            None => b.push(badge("No model", "neutral")),
        }
        if crate::run::first(self, "loop").is_some() {
            b.push(badge("loop", "neutral"));
        }
        if let Some(l) = self.phase_label() {
            b.push(badge(format!("phase: {l}"), "neutral"));
        }
        let tools = crate::run::offered(self);
        b.push(if tools.is_empty() { badge("No tools", "neutral") } else { badge(format!("tools: {}", tools.join(", ")), "neutral") });
        Node::new("Stack").p("dir", "row").p("gap", 2).p("wrap", true).kids(b)
    }

    /// Open asks this engine holds (from a child engine, or its own to the owner), each with a reply field.
    fn ask_rows(&self) -> Vec<Node> {
        let asks = self.obj.state["asks"].as_array().cloned().unwrap_or_default();
        asks.iter()
            .filter(|a| a["status"] == "open")
            .map(|a| {
                let id = a["id"].as_str().unwrap_or("");
                let from = a["from"].as_str().unwrap_or("");
                let who = if a["to"] == "owner" { "asks you".to_string() } else { format!("from {from}") };
                col(vec![
                    row(vec![text(format!("Ask {id}")), badge(who, "accent")]),
                    text(a["question"].as_str().unwrap_or("")),
                    Node::new("Field").p("label", "Reply").p("name", "text").p("value", "").p("action", "reply").p("args", json!({ "ask": id })).p("kind", "text"),
                ])
            })
            .collect()
    }

    fn prompt(&self) -> String {
        let o = &self.obj;
        let mut p = format!("engine \"{}\" ({}) is {}.", o.title, o.id, json!(o.phase).as_str().unwrap_or("?"));
        let s = self.summary();
        if s.running + s.failed > 0 {
            p.push_str(&format!(" Below it: {} running, {} failed.", s.running, s.failed));
        }
        if let Some(err) = &o.error {
            p.push_str(&format!(" Its engine.md failed to load: {err}"));
        }
        let tools = crate::run::offered(self);
        p.push_str(&if tools.is_empty() { " No tools.".to_string() } else { format!(" Tools: {}.", tools.join(", ")) });
        let open = self.obj.state["asks"].as_array().map(|a| a.iter().filter(|x| x["status"] == "open").count()).unwrap_or(0);
        if open > 0 {
            p.push_str(&format!(" {open} open ask(s)."));
        }
        for t in [&o.description, &o.body].into_iter().filter(|t| !t.is_empty()) {
            p.push_str(&format!("\n{t}"));
        }
        for e in &self.elements {
            p.push_str(&format!("\n- {}", element_twin(e, Some(self)).prompt.replace('\n', "\n  ")));
        }
        for c in &self.children {
            p.push_str(&format!("\n- child engine \"{}\" ({})", c.obj.title, c.obj.id));
        }
        p
    }

    /// One line of what is going on in and below this engine.
    pub fn now(&self) -> String {
        let s = self.summary();
        let mut parts = vec![];
        if s.running > 0 {
            parts.push(format!("{} running", s.running));
        }
        if s.failed > 0 {
            parts.push(format!("{} failed", s.failed));
        }
        let open = self.obj.state["asks"].as_array().map(|a| a.iter().filter(|x| x["status"] == "open").count()).unwrap_or(0);
        if open > 0 {
            parts.push(format!("{open} open ask(s)"));
        }
        if parts.is_empty() {
            parts.push(json!(self.obj.phase).as_str().unwrap_or("idle").to_string());
        }
        if let Some(l) = self.phase_label() {
            parts.insert(0, l);
        }
        parts.join(" · ")
    }

    pub fn own_twin(&self) -> Twin {
        let o = &self.obj;
        let loop_focus = crate::run::first(self, "loop").and_then(|l| kinds::find("loop").and_then(|k| k.focus(l)));
        let mut status = Status::of(o, Some(self.now())).with_focus(Some(format!("{} · {}", json!(o.phase).as_str().unwrap_or("idle"), loop_focus.unwrap_or_else(|| "no loop".into()))));
        status.chip = self.phase_label();
        if o.error.is_none() && self.summary().running > 0 && o.phase != Phase::Running {
            status.light = "busy"; // work in flight below lights the engine
        }
        let s = self.summary();
        let asks = o.state["asks"].as_array().map(|a| a.iter().filter(|x| x["status"] == "open").count()).unwrap_or(0) as u64;
        let live = (s.running as u64 + u64::from(o.phase == Phase::Running), asks, s.failed as u64);
        let icon = crate::object::icon_of(o, ENGINE_ICON);
        Twin {
            id: self.obj.id.clone(),
            kind: "engine".into(),
            title: self.obj.title.clone(),
            phase: self.obj.phase,
            state: self.obj.state.clone(),
            config: Value::Object(self.obj.config.clone()),
            actions: self.actions(),
            views: self.views().finish(&o.title, o.phase, &status).with_avatar(&icon, &o.title, o.phase, status.light, live),
            status,
            prompt: self.prompt(),
            description: o.description.clone(),
            icon,
            activity: o.activity_newest(),
        }
    }

    pub fn twin(&self) -> EngineTwin {
        EngineTwin {
            twin: self.own_twin(),
            elements: self.elements.iter().map(|e| element_twin(e, Some(self))).collect(),
            children: self.children.iter().map(|c| c.twin()).collect(),
            summary: self.summary(),
            children_defaults: self.obj.config.get("children").cloned().unwrap_or(Value::Null),
        }
    }

    /// Every object in this engine's tree, by id (a snapshot).
    pub fn collect(&self, out: &mut HashMap<String, Obj>) {
        out.insert(self.obj.id.clone(), self.obj.clone());
        for e in &self.elements {
            out.insert(e.id.clone(), e.clone());
        }
        for c in &self.children {
            c.collect(out);
        }
    }

    /// Every object in this engine's tree.
    pub fn objs(&mut self) -> Vec<&mut Obj> {
        let mut out = vec![&mut self.obj];
        out.extend(self.elements.iter_mut());
        for c in &mut self.children {
            out.extend(c.objs());
        }
        out
    }
}

/// A file name from a title: lowercase letters, digits, dashes.
pub fn slug(title: &str) -> String {
    let mut s = String::new();
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            s.push(ch.to_ascii_lowercase());
        } else if !s.ends_with('-') && !s.is_empty() {
            s.push('-');
        }
    }
    let s = s.trim_end_matches('-').to_string();
    if s.is_empty() { "item".into() } else { s }
}

/// `config` given as a map or as its JSON / frontmatter text; only the kind's fields allowed.
pub fn config_arg(v: &Value, allowed: &[(&str, &str)]) -> Result<Option<Map<String, Value>>> {
    let map = match v {
        Value::Null => return Ok(None),
        Value::Object(m) => m.clone(),
        Value::String(s) if s.trim().is_empty() => return Ok(None),
        Value::String(s) => match serde_json::from_str::<Value>(s).ok().or_else(|| frontmatter::value_of(s).ok()) {
            Some(Value::Object(m)) => m,
            _ => bail!("config must be a map like {{step: 1}}"),
        },
        _ => bail!("config must be a map"),
    };
    let mut map = map;
    for (k, ty) in allowed {
        // a list typed as text in a form ("a, b") is stored as a list
        if *ty == "list"
            && let Some(Value::String(s)) = map.get(*k).cloned()
        {
            map.insert(k.to_string(), Value::Array(s.split(',').map(str::trim).filter(|x| !x.is_empty()).map(|x| json!(x)).collect()));
        }
    }
    for (k, val) in &map {
        let Some((_, ty)) = allowed.iter().find(|(f, _)| f == k) else {
            bail!("unknown config field {k} (allowed: {})", allowed.iter().map(|(f, _)| *f).collect::<Vec<_>>().join(", "));
        };
        let ok = match *ty {
            "number" => val.is_number(),
            "list" => val.is_array() || val.is_string(),
            "bool" => val.is_boolean(),
            _ => val.is_string(),
        };
        if !ok {
            bail!("config field {k} must be a {ty}");
        }
    }
    Ok(Some(map))
}

/// What a change to an engine (not by its owner) did: an ask arrived, or its phase ended.
pub fn engine_activity(before: &Obj, after: &Obj) -> Vec<(String, String, bool)> {
    let open = |o: &Obj| o.state["asks"].as_array().map(|a| a.iter().filter(|x| x["status"] == "open").cloned().collect::<Vec<_>>()).unwrap_or_default();
    let (b, a) = (open(before), open(after));
    let mut out: Vec<(String, String, bool)> = a.iter().filter(|x| !b.contains(x)).map(|x| ("ask".to_string(), format!("ask from {}: {}", x["from"].as_str().unwrap_or("?"), x["question"].as_str().unwrap_or("")), true)).collect();
    out.extend(crate::object::phase_activity(before, after));
    out
}
