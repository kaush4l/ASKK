//! The tool registry: what a `tools` element may list. Each tool is a plain async function over
//! the Hub; a loop runs the calls of one reply in parallel (tokio tasks).

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};
use std::{future::Future, pin::Pin, time::Duration};

use crate::Hub;

/// Who calls: the engine whose loop runs, and that loop's id.
#[derive(Clone)]
pub struct ToolCtx {
    pub hub: Hub,
    pub engine: String,
    pub loop_id: String,
}

pub type ToolFuture = Pin<Box<dyn Future<Output = Result<Value>> + Send>>;

pub struct Tool {
    pub name: &'static str,
    pub about: &'static str,
    /// Its args, as shown in the prompt.
    pub args: &'static str,
    pub run: fn(ToolCtx, Value) -> ToolFuture,
}

pub static TOOLS: [Tool; 5] = [
    Tool { name: "note.write", about: "write a note element of this engine", args: "{text, note?: id, append?: bool}", run: note_write },
    Tool { name: "clock.now", about: "the time now (unix seconds)", args: "{}", run: clock_now },
    Tool { name: "clock.wait", about: "wait some milliseconds (at most 5000)", args: "{ms}", run: clock_wait },
    Tool { name: "help.ask", about: "ask one level up: the parent engine, or the owner from a top engine", args: "{question}", run: help_ask },
    Tool { name: "files.read", about: "read a file of this engine's workspace (data/workspace/<engine>/)", args: "{path}", run: files_read },
];


pub fn find(name: &str) -> Option<&'static Tool> {
    TOOLS.iter().find(|t| t.name == name)
}

/// The largest file `files.read` returns, in characters.
pub const READ_LIMIT: usize = 20_000;

fn note_write(ctx: ToolCtx, args: Value) -> ToolFuture {
    Box::pin(async move {
        let text = args["text"].as_str().ok_or_else(|| anyhow!("note.write needs text"))?.to_string();
        let append = args["append"].as_bool().unwrap_or(false);
        let want = args["note"].as_str().map(|n| n.strip_prefix(&format!("{}/", ctx.engine)).unwrap_or(n).to_string());
        let id = ctx
            .hub
            .read(|rt| {
                let e = rt.engine_node(&ctx.engine)?;
                e.elements
                    .iter()
                    .filter(|x| x.kind == "note" && x.error.is_none())
                    .find(|x| want.as_ref().is_none_or(|w| x.id == format!("{}/{w}", ctx.engine)))
                    .map(|x| x.id.clone())
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
        let ms = args["ms"].as_u64().unwrap_or(0).min(5000);
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
