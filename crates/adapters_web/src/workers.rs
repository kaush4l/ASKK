//! The page's side of one-Worker-per-agent: spawn one Worker per loaded
//! sub-agent at boot, and hand it a goal by `postMessage` when the lead calls
//! it (ADR-008 — the transport is messages, and there is no shared memory to
//! be tempted by). This is the `AgentPort` the core sees; the core names an
//! agent and waits, and cannot reach into its loop even by accident.
//!
//! One agent takes ONE turn at a time — the Python's per-agent loop is serial
//! too — so a Worker has at most one call outstanding and the reply needs no
//! correlation id. Two DIFFERENT agents called on one line run at the same
//! time, which is the whole point.

use std::cell::RefCell;
use std::collections::HashMap;

use js_sys::{Object, Promise, Reflect};
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{MessageEvent, Worker, WorkerOptions, WorkerType};

use kernel::{AgentPort, BoxFuture, DelegateError};

/// Where the Worker gets this build's Wasm from. Trunk fingerprints both files
/// and writes them into `index.html` as preload links, so the page can read
/// its own bundle's URLs instead of anyone hardcoding a hash. The snippet
/// links Dioxus adds are skipped by name.
fn bundle_urls() -> Option<(String, String)> {
    let document = web_sys::window()?.document()?;
    let links = document.query_selector_all("link[rel=modulepreload]").ok()?;
    let mut glue = None;
    for i in 0..links.length() {
        let href = links
            .item(i)?
            .dyn_into::<web_sys::Element>()
            .ok()?
            .get_attribute("href")?;
        if !href.contains("/snippets/") {
            glue = Some(href);
            break;
        }
    }
    let wasm = document
        .query_selector("link[type='application/wasm']")
        .ok()??
        .get_attribute("href")?;
    Some((glue?, wasm))
}

/// One Worker per agent, spawned once. A Worker that will not start is a
/// missing agent, not a broken page (I15): the lead is told the agent is not
/// loaded, in words, and everything else keeps working.
pub struct AgentWorkers {
    workers: RefCell<HashMap<String, Worker>>,
}

impl AgentWorkers {
    pub fn none() -> AgentWorkers {
        AgentWorkers {
            workers: RefCell::new(HashMap::new()),
        }
    }

    /// Start a Worker for every agent except the one the page itself is.
    /// `agents_json`, `models_json` and `profile_json` are forwarded whole, so
    /// a sub-agent boots from exactly the files and endpoint the page did.
    pub fn spawn(
        &self,
        names: &[String],
        lead: &str,
        agents_json: &str,
        models_json: &str,
        profile_json: &str,
    ) {
        let Some((glue, wasm)) = bundle_urls() else {
            web_sys::console::warn_1(&"no wasm bundle links found; no sub-agents".into());
            return;
        };
        for name in names.iter().filter(|n| n.as_str() != lead) {
            match start(name, &glue, &wasm, agents_json, models_json, profile_json) {
                Ok(worker) => {
                    self.workers.borrow_mut().insert(name.clone(), worker);
                }
                Err(e) => web_sys::console::warn_1(
                    &format!("agent '{name}' has no Worker: {e:?}").into(),
                ),
            }
        }
    }
}

/// Spawn one Worker and send it its boot message. The message is a plain
/// object because `postMessage` structured-clones it — no Wasm memory, no
/// handles, nothing shared (ADR-008).
fn start(
    name: &str,
    glue: &str,
    wasm: &str,
    agents_json: &str,
    models_json: &str,
    profile_json: &str,
) -> Result<Worker, JsValue> {
    let options = WorkerOptions::new();
    options.set_type(WorkerType::Module);
    options.set_name(&format!("agent-{name}"));
    let worker = Worker::new_with_options("agent-worker.js", &options)?;
    let message = Object::new();
    let set = |k: &str, v: &str| Reflect::set(&message, &k.into(), &v.into());
    set("kind", "boot")?;
    set("name", name)?;
    set("glue", glue)?;
    set("wasm", wasm)?;
    set("agents", agents_json)?;
    set("models", models_json)?;
    set("profile", profile_json)?;
    worker.post_message(&message)?;
    Ok(worker)
}

/// Send one goal and resolve when that Worker answers. The reply handler is
/// installed per call, which is safe precisely because one agent has one turn
/// in flight at a time.
fn ask(worker: &Worker, goal: &str) -> Promise {
    let goal = goal.to_string();
    let worker = worker.clone();
    Promise::new(&mut |resolve, reject| {
        let refuse = reject.clone();
        let on_message = Closure::once(move |e: MessageEvent| {
            let data = e.data();
            let read = |k: &str| Reflect::get(&data, &k.into()).unwrap_or(JsValue::UNDEFINED);
            let text = read("text").as_string().unwrap_or_default();
            match read("ok").as_bool().unwrap_or(false) {
                true => resolve.call1(&JsValue::UNDEFINED, &text.into()),
                false => reject.call1(&JsValue::UNDEFINED, &text.into()),
            }
            .ok();
        });
        worker.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
        on_message.forget();
        let message = Object::new();
        let sent = Reflect::set(&message, &"kind".into(), &"run".into())
            .and_then(|_| Reflect::set(&message, &"goal".into(), &goal.as_str().into()))
            .and_then(|_| worker.post_message(&message));
        if let Err(e) = sent {
            refuse.call1(&JsValue::UNDEFINED, &e).ok();
        }
    })
}

impl AgentPort for AgentWorkers {
    fn delegate<'a>(
        &'a self,
        agent: &'a str,
        goal: &'a str,
    ) -> BoxFuture<'a, Result<String, DelegateError>> {
        let worker = self.workers.borrow().get(agent).cloned();
        Box::pin(async move {
            let Some(worker) = worker else {
                return Err(DelegateError::Unknown {
                    agent: agent.to_string(),
                });
            };
            JsFuture::from(ask(&worker, goal))
                .await
                .map(|v| v.as_string().unwrap_or_default())
                .map_err(|e| DelegateError::Failed {
                    agent: agent.to_string(),
                    message: crate::wire::js_message(&e),
                })
        })
    }
}
