//! # Ask: every question a window may ask, by name
//!
//! The answers are plain functions (`answers.rs`). The Dioxus windows reach them through
//! generated server functions; this file is the door for everything else: each question once
//! more, in a plain table, so that any UI can ask it and get the same answer:
//!
//! | who asks | how |
//! | --- | --- |
//! | the Dioxus windows (browser, Mac, phone) | the functions themselves, as before |
//! | code in the server's own process (a terminal UI) | [`ask`] |
//! | a UI in another language (Next, Svelte, a script) | `POST /ask/<name>` with the arguments as one JSON object |
//!
//! ```text
//! GET  /ask                       → [{"name": "engine_view", "args": ["path"]}, …]
//! POST /ask/engine_view {"path": "askk"}
//!                                 → 200 {"ok": …}   or   4xx {"error": "no engine 'askk'"}
//! ```
//!
//! The answer is the same value the Dioxus window gets, as JSON. An error is one sentence.
//! `changes` (held open until something changes) is how such a UI hears that it must redraw.
//!
//! A new answer needs one line in [`table`]; a test in `structure.rs` fails when it is missing.
use crate::core::Fut;
use dioxus::prelude::ServerFnError;
use serde_json::Value;

/// One question: its name, the names of its arguments, and how to ask it with JSON.
pub struct Ask {
    pub name: &'static str,
    pub args: &'static [&'static str],
    call: fn(Value) -> Fut<Result<Value, String>>,
}

/// The argument `name` out of the JSON object a caller sent.
fn arg<T: serde::de::DeserializeOwned>(args: &Value, question: &str, name: &str) -> Result<T, String> {
    let v = args.get(name).ok_or_else(|| format!("'{question}' needs the argument '{name}'"))?;
    serde_json::from_value(v.clone()).map_err(|e| format!("'{question}': the argument '{name}' is not what is expected: {e}"))
}

/// The sentence inside a server function's error, without the library's wrapping.
fn sentence(e: ServerFnError) -> String {
    match e {
        ServerFnError::ServerError { message, .. } => message,
        other => other.to_string(),
    }
}

macro_rules! asks {
    ($($name:ident($($arg:ident),*)),* $(,)?) => {
        vec![$(Ask {
            name: stringify!($name),
            args: &[$(stringify!($arg)),*],
            call: |_args| Box::pin(async move {
                $(let $arg = arg(&_args, stringify!($name), stringify!($arg))?;)*
                let out = $name($($arg),*).await.map_err(sentence)?;
                serde_json::to_value(out).map_err(|e| e.to_string())
            }),
        }),*]
    };
}

/// Every question, in the order of the files they are written in.
pub fn table() -> Vec<Ask> {
    use super::models::{discover_models, infer, list_models, save_models};
    use super::*;
    asks![
        // mod.rs
        ui_config(),
        world_view(),
        engine_view(path),
        post_message(path, text),
        post_wake(path, text, by),
        engine_asks(path),
        pack_export(path),
        pack_import(path, files),
        inbox(path),
        workspace_view(path),
        run_engine(path, input),
        clear_history(path),
        engine_prompt(path, input),
        engine_budget(path),
        engine_chat(path),
        kinds(),
        capabilities(),
        engine_object(path, size),
        stop_engine(path),
        changes(epoch, seen),
        export_world(),
        manifest(),
        theme(),
        save_theme(tokens),
        layout(),
        save_layout(layout),
        engine_paths(),
        engine_cards(),
        // components.rs
        list_components(),
        create_component(args),
        // models.rs
        list_models(),
        save_models(models),
        discover_models(method, base_url, token_env),
        infer(model, prompt),
        // rooms.rs
        rooms(),
        room_open(plan),
        room_design(wish, harness),
        room_curation(),
        room_view(wish, harness),
        room_say(id, text),
        // routes.rs
        resolve_route(path),
        nav_links(),
        // sessions.rs
        harnesses(),
        sessions(),
        session_open(harness, title, project),
        session_prompt(id, text),
        // surfaces.rs
        surfaces(),
        glance(),
        // talk.rs
        talk(path),
        engine_run(path, id),
        engine_runs(path),
        modes(),
        busy(),
        media_begin(name, mime),
        media_piece(id, data),
        media_done(id),
        media_picture(id),
    ]
}

/// Ask the question `name` with `args` (one JSON object, an entry per argument).
pub async fn ask(name: &str, args: Value) -> Result<Value, String> {
    let Some(q) = table().into_iter().find(|q| q.name == name) else {
        return Err(format!("no question is called '{name}' (GET /ask lists them)"));
    };
    (q.call)(args).await
}

/// The plain HTTP form, added to the server's own routes.
pub fn routes(router: dioxus::server::axum::Router) -> dioxus::server::axum::Router {
    use dioxus::server::axum::{extract::Path, http::StatusCode, routing, Json};
    async fn list() -> Json<Value> {
        Json(table().iter().map(|q| serde_json::json!({"name": q.name, "args": q.args})).collect())
    }
    // The body must be sent as JSON (`content-type: application/json`): a page from another
    // site cannot send that to this address without the browser asking first, and is refused.
    async fn call(Path(name): Path<String>, Json(args): Json<Value>) -> (StatusCode, Json<Value>) {
        let known = table().iter().any(|q| q.name == name);
        match ask(&name, args).await {
            Ok(v) => (StatusCode::OK, Json(serde_json::json!({"ok": v}))),
            Err(e) => (if known { StatusCode::BAD_REQUEST } else { StatusCode::NOT_FOUND }, Json(serde_json::json!({"error": e}))),
        }
    }
    router.route("/ask", routing::get(list)).route("/ask/{name}", routing::post(call))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_wrong_question_or_argument_is_refused_in_a_sentence() {
        assert_eq!(ask("nope", serde_json::json!({})).await.unwrap_err(), "no question is called 'nope' (GET /ask lists them)");
        assert_eq!(ask("engine_view", serde_json::json!({})).await.unwrap_err(), "'engine_view' needs the argument 'path'");
        assert!(ask("engine_budget", serde_json::json!({"path": 7})).await.unwrap_err().starts_with("'engine_budget': the argument 'path' is not what is expected"));
    }

    #[test]
    fn every_name_is_there_once() {
        let mut names: Vec<&str> = table().iter().map(|q| q.name).collect();
        let all = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), all, "a question is listed twice");
    }
}
