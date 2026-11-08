//! Tools: the abstract `Tool` (a spec + an async run), the registry, and the built-ins. The
//! standard is docs/tools.md. A loop starts the calls of a reply at once and does not block on
//! them (run.rs); each call is bounded by its spec's `timeout_ms`.
//!
//! The registry is process-wide (one app per process): `Hub::add_tool` adds to it, and the pure
//! prompt / view functions (`run::offered`, `run::render`, the tools kind) read it without a Hub.

use anyhow::{Result, anyhow, bail};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, LazyLock, RwLock},
    time::Duration,
};

use crate::Hub;

/// Who calls: the engine whose loop runs, that loop's id, and the call's id (`c1`, …).
#[derive(Clone)]
pub struct ToolCtx {
    pub hub: Hub,
    pub engine: String,
    pub loop_id: String,
    pub call: String,
}

pub type ToolFuture = Pin<Box<dyn Future<Output = Result<Value>> + Send>>;

/// `quick` returns at once; `long` may run for a while (the loop never blocks on either).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Quick,
    Long,
}

/// What a call may touch; shown to the owner, used later by phases and the sandbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Read,
    Write,
    Net,
    Exec,
}

/// Who may call (translation.md §2.4, `Action.by`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum By {
    Model,
    Owner,
    Both,
}

/// One argument: `name: type` (`name?` when optional) and a one-line doc.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Arg {
    pub name: String,
    /// `string | int | number | bool | object | list`
    pub ty: String,
    pub optional: bool,
    pub doc: String,
}

impl Arg {
    pub fn new(name: &str, ty: &str, doc: &str) -> Self {
        Arg { name: name.into(), ty: ty.into(), optional: false, doc: doc.into() }
    }
    pub fn opt(name: &str, ty: &str, doc: &str) -> Self {
        Arg { optional: true, ..Arg::new(name, ty, doc) }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolSpec {
    /// `<ns>.<verb>`
    pub name: String,
    pub description: String,
    pub args: Vec<Arg>,
    /// The result's shape, e.g. `{unix: int}`.
    pub returns: String,
    pub mode: Mode,
    pub timeout_ms: u64,
    pub effects: Vec<Effect>,
    pub by: By,
}

/// The default `timeout_ms` of a quick tool and of a long one.
pub const QUICK_TIMEOUT_MS: u64 = 10_000;
pub const LONG_TIMEOUT_MS: u64 = 120_000;

impl ToolSpec {
    pub fn new(name: &str, description: &str) -> Self {
        ToolSpec { name: name.into(), description: description.into(), args: vec![], returns: "{}".into(), mode: Mode::Quick, timeout_ms: QUICK_TIMEOUT_MS, effects: vec![], by: By::Model }
    }
    pub fn arg(mut self, a: Arg) -> Self {
        self.args.push(a);
        self
    }
    pub fn returns(mut self, r: &str) -> Self {
        self.returns = r.into();
        self
    }
    pub fn long(mut self) -> Self {
        self.mode = Mode::Long;
        if self.timeout_ms == QUICK_TIMEOUT_MS {
            self.timeout_ms = LONG_TIMEOUT_MS;
        }
        self
    }
    pub fn timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = ms;
        self
    }
    pub fn effects(mut self, e: &[Effect]) -> Self {
        self.effects = e.to_vec();
        self
    }
    pub fn by(mut self, b: By) -> Self {
        self.by = b;
        self
    }
    /// The compact args schema: `{text: string, note?: string}` (`{}` when none).
    pub fn args_line(&self) -> String {
        let parts: Vec<String> = self.args.iter().map(|a| format!("{}{}: {}", a.name, if a.optional { "?" } else { "" }, a.ty)).collect();
        format!("{{{}}}", parts.join(", "))
    }
    /// A model may call it.
    pub fn for_model(&self) -> bool {
        matches!(self.by, By::Model | By::Both)
    }
    /// The TOOLS line of the prompt: `- name {args} [long]: description; returns {…}`.
    pub fn prompt_line(&self) -> String {
        let docs: Vec<String> = self.args.iter().filter(|a| !a.doc.is_empty()).map(|a| format!("{}: {}", a.name, a.doc)).collect();
        let docs = if docs.is_empty() { String::new() } else { format!(" ({})", docs.join("; ")) };
        let mode = if self.mode == Mode::Long { " [long]" } else { "" };
        format!("- {} {}{mode}: {}{docs} → {}", self.name, self.args_line(), self.description, self.returns)
    }
}

pub trait Tool: Send + Sync {
    fn spec(&self) -> &ToolSpec;
    fn run(&self, ctx: ToolCtx, args: Value) -> ToolFuture;
}

// ── the registry ───────────────────────────────────────────────────────────

static REGISTRY: LazyLock<RwLock<Vec<Arc<dyn Tool>>>> = LazyLock::new(|| RwLock::new(builtins()));

/// Add (or replace, by name) a tool.
pub fn add(t: Arc<dyn Tool>) {
    let mut r = REGISTRY.write().unwrap();
    let name = t.spec().name.clone();
    match r.iter().position(|x| x.spec().name == name) {
        Some(i) => r[i] = t,
        None => r.push(t),
    }
}

pub fn find(name: &str) -> Option<Arc<dyn Tool>> {
    REGISTRY.read().unwrap().iter().find(|t| t.spec().name == name).cloned()
}

/// Every tool's spec, in registration order (built-ins first).
pub fn specs() -> Vec<ToolSpec> {
    REGISTRY.read().unwrap().iter().map(|t| t.spec().clone()).collect()
}

/// A tool made of a spec and a plain function (how the built-ins are written).
pub struct FnTool {
    pub spec: ToolSpec,
    pub run: fn(ToolCtx, Value) -> ToolFuture,
}

impl Tool for FnTool {
    fn spec(&self) -> &ToolSpec {
        &self.spec
    }
    fn run(&self, ctx: ToolCtx, args: Value) -> ToolFuture {
        (self.run)(ctx, args)
    }
}

/// The longest `clock.wait`.
pub const WAIT_LIMIT_MS: u64 = 5_000;
/// The largest file `files.read` returns, in characters.
pub const READ_LIMIT: usize = 20_000;

fn builtins() -> Vec<Arc<dyn Tool>> {
    use Effect::*;
    let t = |spec: ToolSpec, run: fn(ToolCtx, Value) -> ToolFuture| Arc::new(FnTool { spec, run }) as Arc<dyn Tool>;
    vec![
        t(
            ToolSpec::new("note.write", "write a note element of this engine")
                .arg(Arg::new("text", "string", "the note's new text"))
                .arg(Arg::opt("note", "string", "which note (its id); default the first"))
                .arg(Arg::opt("append", "bool", "add a line instead of replacing"))
                .returns("{written: id}")
                .effects(&[Write])
                .by(By::Both),
            note_write,
        ),
        t(ToolSpec::new("clock.now", "the time now").returns("{unix: int}"), clock_now),
        t(ToolSpec::new("clock.wait", "wait some milliseconds").arg(Arg::new("ms", "int", "at most 5000")).returns("{waited_ms: int}").long().timeout(WAIT_LIMIT_MS + 1_000), clock_wait),
        t(
            ToolSpec::new("help.ask", "ask one level up: the parent engine, or the owner from a top engine")
                .arg(Arg::new("question", "string", "one question"))
                .returns("{asked: id, at: id, to: id}")
                .effects(&[Write]),
            help_ask,
        ),
        t(
            ToolSpec::new("files.read", "read a file of this engine's workspace (data/workspace/<engine>/)")
                .arg(Arg::new("path", "string", "relative to the workspace"))
                .returns("{path, text, clipped: bool}")
                .effects(&[Read]),
            files_read,
        ),
    ]
}

fn note_write(ctx: ToolCtx, args: Value) -> ToolFuture {
    Box::pin(async move {
        let text = args["text"].as_str().ok_or_else(|| anyhow!("note.write needs text"))?.to_string();
        let append = args["append"].as_bool().unwrap_or(false);
        let want = args["note"].as_str().map(|n| n.strip_prefix(&format!("{}/", ctx.engine)).unwrap_or(n).to_string());
        let id = ctx
            .hub
            .read(|rt| {
                let e = rt.engine_node(&ctx.engine)?;
                e.elements.iter().filter(|x| x.kind == "note" && x.error.is_none()).find(|x| want.as_ref().is_none_or(|w| x.id == format!("{}/{w}", ctx.engine))).map(|x| x.id.clone())
            })?
            .ok_or_else(|| anyhow!("{} has no note element{}", ctx.engine, want.map(|w| format!(" {w}")).unwrap_or_default()))?;
        ctx.hub
            .update(&id, |o| {
                let old = o.state["text"].as_str().unwrap_or("").to_string();
                o.state["text"] = json!(if append && !old.is_empty() { format!("{old}\n{text}") } else { text });
                Ok(())
            })
            .await?;
        Ok(json!({ "written": id }))
    })
}

fn clock_now(_: ToolCtx, _: Value) -> ToolFuture {
    Box::pin(async move { Ok(json!({ "unix": crate::now() })) })
}

fn clock_wait(_: ToolCtx, args: Value) -> ToolFuture {
    Box::pin(async move {
        let ms = args["ms"].as_u64().unwrap_or(0).min(WAIT_LIMIT_MS);
        tokio::time::sleep(Duration::from_millis(ms)).await;
        Ok(json!({ "waited_ms": ms }))
    })
}

/// The engine an ask from `engine` goes to: its parent, or itself (to the owner) when on top.
pub fn ask_target(hub: &Hub, engine: &str) -> Result<(String, String)> {
    let parent = engine.rsplit_once('/').map(|(p, _)| p.to_string());
    match parent {
        Some(p) if hub.read(|rt| rt.engine_node(&p).is_some())? => Ok((p.clone(), p)),
        _ => Ok((engine.to_string(), "owner".to_string())),
    }
}

fn help_ask(ctx: ToolCtx, args: Value) -> ToolFuture {
    Box::pin(async move {
        let q = args["question"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| anyhow!("help.ask needs question"))?.to_string();
        let (at, to) = ask_target(&ctx.hub, &ctx.engine)?;
        let mut id = String::new();
        let from = ctx.engine.clone();
        ctx.hub
            .update(&at, |o| {
                if !o.state.is_object() {
                    o.state = json!({});
                }
                let asks = o.state.as_object_mut().expect("object").entry("asks").or_insert_with(|| json!([]));
                let list = asks.as_array_mut().ok_or_else(|| anyhow!("state.asks is not a list"))?;
                id = format!("a{}", list.len() + 1);
                list.push(json!({ "id": id, "from": from, "to": to, "question": q, "status": "open", "at": crate::now() }));
                Ok(())
            })
            .await?;
        Ok(json!({ "asked": id, "at": at, "to": to, "note": "the reply arrives as a message of this loop" }))
    })
}

fn files_read(ctx: ToolCtx, args: Value) -> ToolFuture {
    Box::pin(async move {
        let path = args["path"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| anyhow!("files.read needs path"))?;
        // the store refuses `..`, dot segments and anything but plain names: no way out of the folder
        if path.starts_with('/') || path.split('/').any(|s| s.is_empty() || s.starts_with('.')) {
            bail!("files.read: {path} is not a path inside the workspace");
        }
        let rel = format!("workspace/{}/{path}", ctx.engine);
        let store = ctx.hub.store();
        let text = store.read_text(&rel)?.ok_or_else(|| anyhow!("no file {path} in data/workspace/{}/", ctx.engine))?;
        let clipped = text.chars().count() > READ_LIMIT;
        Ok(json!({ "path": path, "text": text.chars().take(READ_LIMIT).collect::<String>(), "clipped": clipped }))
    })
}
