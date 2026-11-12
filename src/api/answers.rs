//! Answers: the world, engines, layout, theme.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::api::say;
use crate::core::held::Held;
use crate::core::world::{find, world};
use crate::core::store::data as store;

fn load_layout() -> Layout {
    store().get(&crate::core::manifest::manifest().layout).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub async fn ui_config() -> Result<UiConfig, String> {
    world();
    let s = store().get(&crate::core::manifest::manifest().ui).unwrap_or_default();
    Ok(serde_json::from_str(&s).unwrap_or_default())
}

pub async fn world_view() -> Result<WorldView, String> {
    let w = world();
    let l = load_layout();
    let paths: Vec<String> = w.engines.iter().map(|e| e.path.clone()).collect();
    let order = l.arrange(&paths);
    let engines = order.iter().map(|&i| w.engines[i].render(l.sizes.get(&paths[i]).copied().unwrap_or_default(), &l.hidden)).collect();
    Ok(WorldView { engines, paths: order.iter().map(|&i| paths[i].clone()).collect(), columns: l.columns, error: w.error.clone() })
}

pub async fn engine_view(path: String) -> Result<Node, String> {
    find(&path).map(|e| e.render(crate::core::node::Size::Large, &load_layout().hidden)).ok_or_else(|| say(format!("no engine '{path}'")))
}

/// Invoke an engine (it is a tool: input in, answer out).
/// Leave a message for an engine and return at once; it runs on its own and answers in `user`'s box.
pub async fn post_message(path: String, text: String) -> Result<u64, String> {
    let _ = world();
    crate::core::board::board().post("user", &path, &text, crate::core::board::Cause::Person).map_err(say)
}

/// The same, fired by a schedule with nobody there: `by` names the schedule (`desk-open`).
/// The message carries that cause, so an unattended run can always be told from a typed one.
pub async fn post_wake(path: String, text: String, by: String) -> Result<u64, String> {
    let _ = world();
    // An attestation by the caller, not authentication: the host listens on loopback only.
    crate::core::board::board().post("user", &path, &text, crate::core::board::Cause::Wake(by.trim().into())).map_err(say)
}

/// An engine's open questions for the user: its resolved path and its `asks.md` text. An empty
/// path means the first engine in the directory.
pub async fn engine_asks(path: String) -> Result<(String, String), String> {
    let _ = world();
    let path = if path.is_empty() {
        crate::core::board::board().directory().first().map(|(p, _)| p.clone()).ok_or_else(|| say("no engines"))?
    } else {
        path
    };
    if path.split('/').any(|s| s.is_empty() || s == ".." || s == ".") {
        return Err(say("bad engine path"));
    }
    // A call that waits for the owner's yes is asked in the same words as a question.
    let asks = crate::core::permit::lines(&path) + &store().get(&format!("engines/{path}/asks.md")).unwrap_or_default();
    Ok((path, asks))
}

/// The engine at `path` as a pack: its recipe files and the holes a receiver must bind. Refused,
/// with the file and the reason, when anything personal would leave.
pub async fn pack_export(path: String) -> Result<(Vec<(String, String)>, Vec<(String, String)>), String> {
    let _ = world();
    if path.split('/').any(|s| s.is_empty() || s == ".." || s == ".") {
        return Err(say("bad engine path"));
    }
    let p = crate::core::pack::export(&*store(), &format!("engines/{path}")).map_err(say)?;
    Ok((p.files, p.needs.into_iter().map(|(k, v)| (k, v.to_string())).collect()))
}

/// Place a pack (from [`pack_export`]) as a new engine at `path`; returns the holes to bind in
/// `personal/bindings.json`. It loads on the next boot.
pub async fn pack_import(path: String, files: Vec<(String, String)>) -> Result<Vec<(String, String)>, String> {
    let _ = world();
    if path.split('/').any(|s| s.is_empty() || s == ".." || s == ".") {
        return Err(say("bad engine path"));
    }
    let needs = crate::core::pack::import(&*store(), &format!("engines/{path}"), &files).map_err(say)?;
    Ok(needs.into_iter().map(|(k, v)| (k, v.to_string())).collect())
}

/// A box's messages, oldest first (`user` holds the engines' answers to the user).
pub async fn inbox(path: String) -> Result<Vec<crate::core::board::Message>, String> {
    let _ = world();
    Ok(crate::core::board::board().box_of(&path))
}

#[cfg(feature = "server")]
pub async fn workspace_view(path: String) -> Result<IdeView, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine {path}")))?;
    let spec = e.specs().into_iter().find(|s| s.kind == "workspace");
    let workspace = spec.map(crate::elements::workspace::view_of).transpose().map_err(say)?;
    let jobs = crate::host::workspace::jobs()
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|j| JobView {
            id: j["id"].as_u64().unwrap_or(0),
            command: j["command"].as_str().unwrap_or_default().into(),
            status: j["status"].as_str().map(String::from).unwrap_or_else(|| j["status"].to_string()),
            output: j["output"].as_str().unwrap_or_default().into(),
        })
        .collect();
    Ok(IdeView { workspace, jobs })
}

/// The skills a message to the engine at `path` can name with `$` (`core::skills`): its
/// workspace's own first, then the owner's.
#[cfg(feature = "server")]
pub async fn skills(path: String) -> Result<Vec<super::Skill>, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine {path}")))?;
    let root = e.specs().into_iter().find(|s| s.kind == "workspace").and_then(|s| crate::elements::workspace::view_of(s).ok()).map(|w| w.root);
    Ok(crate::core::skills::find(root.as_deref()).into_iter().map(|f| super::Skill { name: f.name, about: f.about, file: f.file }).collect())
}

/// What the last run of the engine at `path` that changed files changed in its workspace.
#[cfg(feature = "server")]
pub async fn workspace_diff(path: String) -> Result<WorkspaceDiff, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine {path}")))?;
    let Some(spec) = e.specs().into_iter().find(|s| s.kind == "workspace") else { return Ok(WorkspaceDiff::default()) };
    let (run, files) = crate::elements::workspace::changes_of(spec, &path).map_err(say)?;
    Ok(WorkspaceDiff { workspace: true, run, files })
}

/// One file of the engine's workspace, to read (never to write; excluded files are not shown).
#[cfg(feature = "server")]
pub async fn workspace_file(path: String, file: String) -> Result<String, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine {path}")))?;
    let spec = e.specs().into_iter().find(|s| s.kind == "workspace").ok_or_else(|| say(format!("{path} has no workspace")))?;
    crate::elements::workspace::read_of(spec, &file).map_err(say)
}

pub async fn run_engine(path: String, input: String) -> Result<String, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    e.run(&input).await.map_err(say)
}

/// Clear an engine's conversation (history only; notes and learning stay).
pub async fn clear_history(path: String) -> Result<(), String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    e.clear_history();
    Ok(())
}

/// The prompt the engine would send now for `input`, as ordered sections (see `core::ORDER`).
pub async fn engine_prompt(path: String, input: String) -> Result<Vec<crate::core::Section>, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    Ok(e.sections(&e.toolbox(), &input))
}

/// The engine's input budget in tokens (0 = unknown).
pub async fn engine_budget(path: String) -> Result<usize, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    Ok(e.budget().await)
}

/// The engine's conversation, from its history elements (model replies shown as their answer).
pub async fn engine_chat(path: String) -> Result<Vec<ChatTurn>, String> {
    let e = find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?;
    let turns: Vec<(String, String)> = e.elements.held().iter().flat_map(|c| c.transcript()).collect();
    Ok(turns
        .into_iter()
        .map(|(role, raw)| {
            if role != "model" {
                return ChatTurn { role, text: raw, fields: vec![] };
            }
            let reply = e.parse(&raw);
            let text = match (&reply.answer, reply.calls.is_empty()) {
                (Some(a), true) => a.clone(),
                (_, false) => {
                    let calls: Vec<String> = reply.calls.iter().map(|c| format!("→ {}", crate::core::tool::call_sig(&c.tool, &c.args))).collect();
                    calls.join("\n") + &reply.answer.as_ref().map(|a| format!("\n{a}")).unwrap_or_default()
                }
                (None, true) if !reply.fields.is_empty() => String::new(),
                _ => raw,
            };
            ChatTurn { role, text, fields: reply.fields }
        })
        .collect())
}

/// What this build can do and what it cannot, each with a line a person can read.
pub async fn capabilities() -> Result<Vec<crate::core::caps::Cap>, String> {
    world();
    Ok(crate::core::caps::all())
}

/// Every object kind (engine and elements) with docs, category and its four views, drawn from
/// a running object of that kind when one exists (so it carries real state), else an empty one.
pub async fn kinds() -> Result<Vec<KindDoc>, String> {
    use crate::core::node::Size;
    fn all(e: &std::sync::Arc<crate::core::Engine>, out: &mut Vec<std::sync::Arc<crate::core::Engine>>) {
        out.push(e.clone());
        e.subs().iter().for_each(|s| all(s, out));
    }
    let mut engines = vec![];
    world().engines.iter().for_each(|e| all(e, &mut engines));
    let mut out = vec![];
    if let Some(e) = engines.first() {
        out.push(KindDoc {
            params: vec![],
            kind: "engine".into(),
            doc: "A set of elements that make up the prompt; a tool of its parent; live activity: idle, thinking, calling, refocusing, stopped, error.".into(),
            category: "engine".into(),
            views: Size::ALL.iter().map(|s| e.render(*s, &[])).collect(),
        });
    }
    for crate::core::Kind { name: k, params, .. } in crate::core::KINDS {
        let sample = engines.iter().find_map(|e| e.elements.held().iter().find(|c| c.kind() == *k).map(|c| c.spec()));
        let c = crate::core::build(sample.unwrap_or(crate::core::Spec { kind: k.to_string(), name: k.to_string(), ..Default::default() })).unwrap();
        out.push(KindDoc { kind: k.to_string(), doc: c.doc().into(), category: c.category().into(), views: Size::ALL.iter().map(|s| c.render(*s)).collect(),
            params: params.iter().map(|p| (p.key.into(), p.share.as_str().into(), p.doc.into())).collect() });
    }
    Ok(out)
}

/// One engine as an object view at `size` (icon | small | medium | large).
pub async fn engine_object(path: String, size: crate::core::node::Size) -> Result<Node, String> {
    find(&path).map(|e| e.render(size, &[])).ok_or_else(|| say(format!("no engine '{path}'")))
}

pub async fn stop_engine(path: String) -> Result<(), String> {
    find(&path).ok_or_else(|| say(format!("no engine '{path}'")))?.stop();
    Ok(())
}

/// The one live feed: parks until a domain object marks itself changed after `seen` (or ~20 s),
/// then returns the changed keys. No per-object polling: an idle app does no work.
/// `epoch` 0 (a new reader) gets the current position at once and nothing to refresh, since it
/// has just rendered fresh state; a reader from another process (a restart) gets every key.
#[cfg(feature = "server")]
pub async fn changes(epoch: u64, seen: u64) -> Result<Changed, String> {
    use crate::core::changes as c;
    world();
    let now = c::epoch();
    if epoch == 0 {
        return Ok(Changed { epoch: now, seq: c::now(), keys: vec![] });
    }
    let seen = if epoch == now { seen } else { 0 };
    let (seq, keys) = crate::host::changes::wait(seen, std::time::Duration::from_secs(20)).await;
    Ok(Changed { epoch: now, seq, keys })
}

/// Every key of the data store in the standard form (`{key: text}`): a whole backup, loadable
/// as a source (`ASKK_DATA=<file>.json` or `ASKK_DEFAULTS=<file>.json`).
pub async fn export_world() -> Result<std::collections::BTreeMap<String, String>, String> {
    world();
    let mut all = crate::core::store::export(&*store(), "");
    all.remove(crate::core::store::LOCK);
    Ok(all)
}

/// The manifest the world was loaded with: where every kind of object lives, so a view can
/// subscribe to the keys it shows.
pub async fn manifest() -> Result<crate::core::manifest::Manifest, String> {
    world();
    Ok(crate::core::manifest::manifest().clone())
}

/// `data/theme.json`: CSS custom properties that override the built-in tokens.
pub async fn theme() -> Result<std::collections::BTreeMap<String, String>, String> {
    let s = store().get(&crate::core::manifest::manifest().theme).unwrap_or_default();
    Ok(serde_json::from_str(&s).unwrap_or_default())
}

pub async fn save_theme(tokens: std::collections::BTreeMap<String, String>) -> Result<(), String> {
    if let Some(bad) = tokens.keys().find(|k| !k.starts_with("--") || k.contains(['{', '}', ';'])) {
        return Err(say(format!("bad token name '{bad}'")));
    }
    if tokens.values().any(|v| v.contains(['{', '}', ';'])) {
        return Err(say("token values cannot contain { } ;"));
    }
    store().put(&crate::core::manifest::manifest().theme, &serde_json::to_string_pretty(&tokens).unwrap()).map_err(say)
}

pub async fn layout() -> Result<Layout, String> {
    Ok(load_layout())
}

pub async fn save_layout(layout: Layout) -> Result<(), String> {
    store().put(&crate::core::manifest::manifest().layout, &serde_json::to_string_pretty(&layout).unwrap()).map_err(say)
}

/// Paths of all engines, depth first (for the Layout page).
pub async fn engine_paths() -> Result<Vec<String>, String> {
    fn walk(e: &crate::core::Engine, out: &mut Vec<String>) {
        out.push(e.path.clone());
        e.subs().iter().for_each(|s| walk(s, out));
    }
    let mut out = vec![];
    world().engines.iter().for_each(|e| walk(e, &mut out));
    Ok(out)
}

/// Every engine as a [`CardView`], depth first (same order as [`engine_paths`]).
pub async fn engine_cards() -> Result<Vec<CardView>, String> {
    fn walk(e: &crate::core::Engine, out: &mut Vec<CardView>) {
        let f = e.file.held().clone();
        let (status, detail) = e.activity();
        let (phase, summary) = {
            let els = e.elements.held();
            (els.iter().find_map(|el| el.phase()).unwrap_or_default(), els.iter().find_map(|el| el.summary()).unwrap_or_default())
        };
        let new_msgs = crate::core::board::board().new_for(&e.path).len();
        out.push(CardView { path: e.path.clone(), name: f.name, icon: f.icon, status, detail, phase, summary, new_msgs });
        e.subs().iter().for_each(|s| walk(s, out));
    }
    let mut out = vec![];
    world().engines.iter().for_each(|e| walk(e, &mut out));
    Ok(out)
}
