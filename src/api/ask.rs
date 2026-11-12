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
        workspace_diff(path),
        workspace_file(path, file),
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
        // boxes.rs
        boxes(),
        workspaces(),
        // service.rs
        hello(),
        reload(),
        service_settings(),
        stop_service(),
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
        run_partial(path),
        talks(path),
        talk_new(path),
        talk_open(path, id),
        talk_saved(path, id),
        // terminals.rs
        terminal_open(command, place, cols, rows),
        terminal_screen(id),
        terminal_scrolled(id, back),
        terminal_type(id, keys),
        terminal_resize(id, cols, rows),
        terminal_close(id),
        terminal_layout(),
        save_terminal_layout(layout),
        terminal_sessions(),
        session_layout(session),
        save_session_layout(session, layout),
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
/// The headers that let a page from `origin` read the answer, when that origin is one the
/// owner named (`ASKK_ORIGINS`, or `origins` in settings.json, which holds as soon as it is
/// saved); for any other page none, and its browser refuses the answer.
fn allow(headers: &dioxus::server::axum::http::HeaderMap) -> dioxus::server::axum::http::HeaderMap {
    use dioxus::server::axum::http::{HeaderMap, HeaderValue};
    let mut out = HeaderMap::new();
    let Some(origin) = headers.get("origin").and_then(|o| o.to_str().ok()) else { return out };
    if !crate::core::settings::origins().iter().any(|o| o == origin) {
        return out;
    }
    if let Ok(v) = HeaderValue::from_str(origin) {
        out.insert("access-control-allow-origin", v);
        out.insert("vary", HeaderValue::from_static("Origin"));
        out.insert("access-control-allow-methods", HeaderValue::from_static("GET, POST"));
        out.insert("access-control-allow-headers", HeaderValue::from_static("content-type"));
        // A page on the internet asking a server on this machine: the browser asks this too.
        out.insert("access-control-allow-private-network", HeaderValue::from_static("true"));
    }
    out
}

/// The name in a `Host` header or an origin, without scheme and port, in small letters:
/// `LocalHost:8090` and `http://localhost:8090` are `localhost`; `[::1]:8090` is `[::1]`.
fn host_name(host: &str) -> String {
    let h = host.trim().to_ascii_lowercase();
    let h = h.split_once("://").map(|(_, rest)| rest).unwrap_or(&h);
    let h = h.split('/').next().unwrap_or_default();
    let name = if h.starts_with('[') { h.split_inclusive(']').next() } else { h.split(':').next() };
    name.unwrap_or_default().trim_end_matches('.').to_string()
}

/// The names this machine is asked by from itself, with any port.
const THIS_MACHINE: [&str; 3] = ["127.0.0.1", "localhost", "[::1]"];

/// Whether a request that names `host` (its `Host` header) asks this service as itself: as
/// this machine, or as the host of an origin the owner named. A page on the internet can
/// point a name of its own at 127.0.0.1 and so reach this address from the owner's browser;
/// such a request still carries the page's name, and is refused here.
pub fn asked_as_this_service(host: &str, origins: &[String]) -> bool {
    let name = host_name(host);
    !name.is_empty() && (THIS_MACHINE.contains(&name.as_str()) || origins.iter().any(|o| host_name(o) == name))
}

/// Refuse every request that does not ask this service as itself ([`asked_as_this_service`]),
/// whatever it asks for: `/ask`, a server function, a page. The service starts programs
/// (`terminal_open`), so who may ask is checked before anything is answered.
pub fn guarded(router: dioxus::server::axum::Router) -> dioxus::server::axum::Router {
    use dioxus::server::axum::{extract::Request, http::StatusCode, middleware, response::IntoResponse, response::Response, Json};
    async fn guard(req: Request, next: middleware::Next) -> Response {
        // The name the request was sent to: its `Host` line, or the address itself where the
        // connection carries it there instead.
        let host = req.headers().get("host").and_then(|h| h.to_str().ok()).map(String::from).or_else(|| req.uri().authority().map(|a| a.to_string())).unwrap_or_default();
        if asked_as_this_service(&host, &crate::core::settings::origins()) {
            return next.run(req).await;
        }
        let said = format!("askk answers only when it is asked as this machine (127.0.0.1, localhost) or as a host its owner named in `origins` (settings.json); this request named '{host}'");
        (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": said}))).into_response()
    }
    router.layer(middleware::from_fn(guard))
}

pub fn routes(router: dioxus::server::axum::Router) -> dioxus::server::axum::Router {
    use dioxus::server::axum::{extract::Path, http::HeaderMap, http::StatusCode, routing, Json};
    async fn list(headers: HeaderMap) -> (HeaderMap, Json<Value>) {
        (allow(&headers), Json(table().iter().map(|q| serde_json::json!({"name": q.name, "args": q.args})).collect()))
    }
    // The body must be sent as JSON (`content-type: application/json`): a page from another
    // site cannot send that to this address without the browser asking first (`may`), and
    // the browser is told yes only for the origins the owner named.
    async fn call(Path(name): Path<String>, headers: HeaderMap, Json(args): Json<Value>) -> (StatusCode, HeaderMap, Json<Value>) {
        let known = table().iter().any(|q| q.name == name);
        match ask(&name, args).await {
            Ok(v) => (StatusCode::OK, allow(&headers), Json(serde_json::json!({"ok": v}))),
            Err(e) => (if known { StatusCode::BAD_REQUEST } else { StatusCode::NOT_FOUND }, allow(&headers), Json(serde_json::json!({"error": e}))),
        }
    }
    async fn may(headers: HeaderMap) -> (StatusCode, HeaderMap) {
        (StatusCode::NO_CONTENT, allow(&headers))
    }
    router.route("/ask", routing::get(list).options(may)).route("/ask/{name}", routing::post(call).options(may))
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
    fn only_a_request_that_names_this_machine_or_a_host_the_owner_named_is_answered() {
        let none: Vec<String> = vec![];
        for here in ["127.0.0.1:8090", "127.0.0.1", "localhost:3000", "LocalHost:8090", "localhost.:8090", "[::1]:8090", "[::1]"] {
            assert!(asked_as_this_service(here, &none), "{here} is this machine");
        }
        // A name of somebody else's that resolves to this machine, and near misses.
        for foreign in ["evil.example:8090", "127.0.0.1.evil.example", "localhost.evil.example:8090", "evil.example", "", "   ", "[::2]:8090", "0.0.0.0:8090", "192.168.1.5:8090"] {
            assert!(!asked_as_this_service(foreign, &none), "'{foreign}' is not this machine");
        }
        let named = vec!["https://pages.example".to_string(), "http://192.168.1.5:8090/".to_string()];
        assert!(asked_as_this_service("192.168.1.5:8090", &named), "the host of a named origin is the owner's own");
        assert!(asked_as_this_service("pages.example", &named));
        assert!(!asked_as_this_service("other.example", &named) && !asked_as_this_service("pages.example.evil.example", &named));
    }

    /// The rule as the service applies it: asked through the real router, a request under a
    /// foreign name gets 403 and one sentence, and the same request as this machine is let
    /// through to the answer.
    #[tokio::test]
    async fn a_request_under_a_foreign_name_is_refused_before_anything_is_answered() {
        use dioxus::server::axum::{routing, Router};
        let app = guarded(Router::new().route("/ask", routing::get(|| async { "answered" })));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let at = listener.local_addr().unwrap();
        tokio::spawn(async move { dioxus::server::axum::serve(listener, app).await });
        let ask = |host: &'static str| async move {
            let res = reqwest::Client::new().get(format!("http://{at}/ask")).header("host", host).send().await.unwrap();
            (res.status().as_u16(), res.text().await.unwrap())
        };
        assert_eq!(ask("localhost:8090").await, (200, "answered".to_string()));
        let (status, said) = ask("evil.example:8090").await;
        assert_eq!(status, 403);
        assert!(said.contains("this request named 'evil.example:8090'") && said.contains("`origins`"), "{said}");
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
