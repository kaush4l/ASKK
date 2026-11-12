//! The spike's one page: pick an engine, say something, see the run and what it wrote.
//! Bare on purpose. It asks through `api/` like any window: the same plain functions the
//! server answers with, called directly because here the host is this tab.
use super::infer::{self, Target};
use crate::core::{changes, store, Toolbox};
use crate::ui::features::talk;
use dioxus::prelude::*;

/// What one run left behind.
#[derive(Clone, Default, PartialEq)]
struct Outcome {
    answer: String,
    ms: u64,
    /// Store keys written during the run.
    wrote: Vec<String>,
    /// What the loop did, a line per stage of each step (`step 1 · Act: run_code → …`).
    steps: Vec<String>,
    /// The engine's conversation after the run: `(who, text)`, oldest first.
    history: Vec<(String, String)>,
}

/// The loop's own record of its last run, and the conversation it kept, read through `api/`.
async fn record(path: String) -> (Vec<String>, Vec<(String, String)>) {
    let last = crate::api::engine_runs(path.clone()).await.unwrap_or_default().last().map(|r| r.id);
    let steps = match last {
        Some(id) => crate::api::engine_run(path.clone(), id).await.map(|run| talk::stages(&run)).unwrap_or_default(),
        None => vec![],
    };
    let history = talk::turns(crate::api::engine_chat(path).await.unwrap_or_default());
    (steps, history)
}

#[component]
pub fn Page() -> Element {
    let paths = use_resource(|| async { crate::api::engine_paths().await.unwrap_or_default() });
    let engines = paths().unwrap_or_default();
    let caps = use_resource(|| async { crate::api::capabilities().await.unwrap_or_default() });
    let glance = use_resource(|| async { crate::api::glance().await.unwrap_or_default() });
    let world = crate::core::world::world();
    let mut pick = use_signal(|| None::<usize>);
    // The engine that answers by writing and running a program is the one to try first.
    let chosen = pick().or_else(|| talk::first_choice(&engines)).unwrap_or(0);
    let mut input = use_signal(|| "What is the sum of the squares of the first 20 prime numbers?".to_string());
    let mut base = use_signal(String::new);
    let mut model = use_signal(String::new);
    let mut token = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut out = use_signal(|| None::<Outcome>);
    let mut keys = use_signal(|| store::export(&*store::data(), "").len());
    let mut disk = use_signal(super::store::status);

    // A page opened as `…/?model=<server>&ask=<question>` fills those two in and runs once.
    // It is how a test (or a link someone shares) asks without a hand on the page.
    use_future(move || async move {
        let asked = document::eval(
            r#"const q = new URLSearchParams(location.search); return [q.get("model") || "", q.get("ask") || ""];"#,
        );
        let Ok((server, question)) = asked.join::<(String, String)>().await else { return };
        if question.is_empty() {
            return;
        }
        base.set(server);
        input.set(question);
        // The button's own handler runs the question, once the page has drawn the values.
        let _ = document::eval(r#"setTimeout(() => document.getElementById("run")?.click(), 300);"#).await;
    });

    let mut language = use_signal(|| "js".to_string());
    let mut code = use_signal(|| "[1, 2, 3].map(x => x * x)".to_string());
    let mut code_busy = use_signal(|| false);
    let mut code_out = use_signal(String::new);
    // The same call an engine makes when its `tools` element selects `run_code`.
    let run_code = move |_| {
        code_busy.set(true);
        let args = serde_json::json!({"language": language(), "code": code()});
        spawn(async move {
            let t = web_time::Instant::now();
            let text = match Toolbox::new(vec![crate::core::IntoTool::into_tool(crate::core::code::RunCode)]).call("run_code", args).await {
                Ok(v) => format!("{v:#}"),
                Err(e) => format!("error: {e}"),
            };
            code_out.set(format!("{text}\n({} ms)", t.elapsed().as_millis()));
            code_busy.set(false);
        });
    };

    let run = {
        let engines = engines.clone();
        move |_| {
            let Some(path) = engines.get(chosen).cloned() else { return };
            infer::set(Target { base: base(), model: model(), token: token() });
            busy.set(true);
            let text = input();
            spawn(async move {
                let seen = changes::now();
                let t = web_time::Instant::now();
                let answer = match crate::api::run_engine(path.clone(), text).await {
                    Ok(a) => a,
                    Err(err) => format!("error: {err}"),
                };
                let mut wrote: Vec<String> = changes::since(seen).1.into_iter().map(|(k, _)| k).collect();
                wrote.sort();
                let ms = t.elapsed().as_millis() as u64;
                let (steps, history) = record(path).await;
                out.set(Some(Outcome { answer, ms, wrote, steps, history }));
                keys.set(store::export(&*store::data(), "").len());
                disk.set(super::store::status());
                busy.set(false);
            });
        }
    };

    rsx! {
        main { style: "font: 14px/1.5 system-ui; max-width: 760px; margin: 32px auto; padding: 0 16px;",
            h1 { style: "font-size: 18px;", "askk — engine in this tab" }
            p { id: "boot", "booted: {world.report}; store holds {keys} keys" }
            if let Some(g) = glance() {
                p { id: "asked", "asked through api/: {engines.len()} engines, {g.running} running, {g.waiting} messages waiting" }
            }
            if let Some(caps) = caps() {
                p { id: "caps", style: "margin-bottom: 0;", "this build:" }
                ul { style: "margin-top: 4px;",
                    for c in caps {
                        li { if c.here { "✓ " } else { "— " } b { "{c.name}" } ": {c.note}" }
                    }
                }
            }
            p { id: "disk",
                "disk (IndexedDB): {disk().restored} keys read at start; "
                if disk().persisted { "eviction-protected; " } else { "may be evicted under storage pressure; " }
                "{disk().flushes} transactions written "
                // Only the tab that holds the world may delete it.
                if disk().held {
                    button { id: "reset", onclick: move |_| super::store::wipe(), "reset world" }
                }
            }
            if !disk().error.is_empty() {
                pre { id: "disk-error", style: "color: #b00; white-space: pre-wrap;", "{disk().error}" }
            }
            if !world.error.is_empty() {
                pre { id: "boot-error", style: "color: #b00; white-space: pre-wrap;", "{world.error}" }
            }
            label { "engine " }
            select { id: "engine", onchange: move |e| pick.set(e.value().parse().ok()),
                for (i, e) in engines.iter().enumerate() {
                    option { value: "{i}", selected: i == chosen, "{e}" }
                }
            }
            p { style: "margin-bottom: 4px;", "model server: an askk server (http://127.0.0.1:8090/ask) or an OpenAI-style one (https://…/v1). Empty = built-in echo; a token stays in memory" }
            div { style: "display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px;",
                input { id: "base", placeholder: "http://127.0.0.1:8090/ask", value: base, oninput: move |e| base.set(e.value()) }
                input { id: "model", placeholder: "model", value: model, oninput: move |e| model.set(e.value()) }
                input { id: "token", r#type: "password", placeholder: "token", value: token, oninput: move |e| token.set(e.value()) }
            }
            textarea { id: "input", style: "width: 100%; height: 72px; margin-top: 12px; box-sizing: border-box;", value: input, oninput: move |e| input.set(e.value()) }
            button { id: "run", disabled: busy(), onclick: run, if busy() { "running…" } else { "run" } }
            if let Some(o) = out() {
                h2 { style: "font-size: 15px;", "answer ({o.ms} ms)" }
                pre { id: "answer", style: "white-space: pre-wrap; background: #f4f4f4; padding: 12px;", "{o.answer}" }
                h2 { style: "font-size: 15px;", "what the loop did ({o.steps.len()} stages)" }
                pre { id: "steps", style: "white-space: pre-wrap; background: #f4f4f4; padding: 12px;", {o.steps.join("\n")} }
                h2 { style: "font-size: 15px;", "history ({o.history.len()} turns)" }
                div { id: "history",
                    for (who, text) in o.history.iter() {
                        p { style: "margin: 4px 0; white-space: pre-wrap;", b { "{who}: " } "{text}" }
                    }
                }
                h2 { style: "font-size: 15px;", "store keys written by this run ({o.wrote.len()})" }
                pre { id: "wrote", style: "white-space: pre-wrap;", {o.wrote.join("\n")} }
            }
            h2 { style: "font-size: 15px; margin-top: 28px;", "tool: run_code (sandboxed frame + worker)" }
            select { id: "language", onchange: move |e| language.set(e.value()),
                option { value: "js", "js" }
                option { value: "python", "python (first run downloads the runtime)" }
            }
            textarea { id: "code", style: "width: 100%; height: 96px; margin-top: 8px; box-sizing: border-box; font-family: ui-monospace, monospace;", value: code, oninput: move |e| code.set(e.value()) }
            button { id: "run-code", disabled: code_busy(), onclick: run_code, if code_busy() { "running…" } else { "run code" } }
            if !code_out().is_empty() {
                pre { id: "code-out", style: "white-space: pre-wrap; background: #f4f4f4; padding: 12px;", "{code_out}" }
            }
        }
    }
}
