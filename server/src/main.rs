//! The local server: core over HTTP, plus the built UI.
//! Lifecycle: run → serve → signal → graceful stop → core shutdown → exit 0.

use anyhow::Result;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderValue, StatusCode},
    response::sse::{Event, Sse},
    routing::{get, post},
};
use futures::{Stream, StreamExt};
use askk_core::{Event as Ev, FolderStore, Hub, boot, hub::Stopping};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    convert::Infallible,
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::watch;

mod connectors;
mod reload;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    services::{ServeDir, ServeFile},
};

struct App {
    hub: Hub,
    data: PathBuf,
    stopping: watch::Receiver<bool>,
}

type Shared = Arc<App>;
type Refusal = (StatusCode, Json<Value>);

fn refuse(code: StatusCode, e: impl ToString) -> Refusal {
    (code, Json(json!({ "error": e.to_string() })))
}

fn arg(name: &str, default: &str) -> String {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned()).unwrap_or_else(|| default.to_string())
}

/// Which folder the engines come from, first match wins:
/// `--engines <dir>`, then `$ASKK_ENGINES`, then `./engines` (yours, gitignored) when it holds
/// an engine, else `<data>/engines`. A `<data>/engines` with no engine is first filled with a
/// copy of `./defaults/engines` (committed, never written to), or the built-in seed if that is absent.
fn engines_dir(data: &std::path::Path) -> Result<(PathBuf, &'static str)> {
    let has_engine = |d: &std::path::Path| {
        std::fs::read_dir(d).is_ok_and(|r| r.flatten().any(|e| e.path().join("engine.md").is_file()))
    };
    let flag = arg("--engines", "");
    if !flag.is_empty() {
        return Ok((PathBuf::from(flag), "--engines"));
    }
    if let Ok(v) = std::env::var("ASKK_ENGINES") {
        if !v.is_empty() {
            return Ok((PathBuf::from(v), "ASKK_ENGINES"));
        }
    }
    if has_engine(std::path::Path::new("engines")) {
        return Ok((PathBuf::from("engines"), "local"));
    }
    let scratch = data.join("engines");
    if has_engine(&scratch) {
        return Ok((scratch, "data"));
    }
    let defaults = std::path::Path::new("defaults/engines");
    if has_engine(defaults) {
        copy_dir(defaults, &scratch)?;
        return Ok((scratch, "copied from defaults"));
    }
    Ok((scratch, "seed"))
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)?.flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if src.is_dir() { copy_dir(&src, &dst)? } else { std::fs::copy(&src, &dst).map(|_| ())? }
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let data = PathBuf::from(arg("--data", "data"));
    if data.as_os_str().is_empty() {
        anyhow::bail!("--data must name a folder");
    }
    let port: u16 = arg("--port", "4600").parse()?;
    let ui = PathBuf::from(arg("--ui", "build"));

    let (engines, source) = engines_dir(&data)?;
    let rt = boot(Box::new(FolderStore::with_engines(&data, &engines)?))?;
    println!(
        "boot #{} (last exit: {}) · {} engine(s) · engines {} ({source}) · data {}",
        rt.info["boots"],
        rt.info["last_exit"].as_str().unwrap_or("?"),
        rt.engines().len(),
        engines.display(),
        data.display()
    );

    let (stop_tx, stopping) = watch::channel(false);
    let hub = Hub::new(rt);
    connectors::register(&hub);
    let app: Shared = Arc::new(App { hub: hub.clone(), stopping: stopping.clone(), data: data.clone() });
    let watcher = reload::watch(hub.clone(), engines.clone(), stopping.clone());
    std::fs::create_dir_all(data.join("ui/assets"))?;
    let ui_watcher = reload::watch(hub.clone(), data.join("ui"), stopping);

    let router = Router::new()
        .route("/world", get(world))
        .route("/act", post(act))
        .route("/layout", post(layout))
        .route("/theme", post(theme))
        .route("/events", get(events_stream))
        .route("/ui", post(save_ui))
        .route("/ui/asset", post(save_asset))
        .nest_service("/ui/assets", ServeDir::new(data.join("ui/assets")))
        .fallback_service(ServeDir::new(&ui).fallback(ServeFile::new(ui.join("index.html"))))
        .layer(cors())
        .with_state(app.clone());

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    println!("serving http://127.0.0.1:{port}");
    axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            let why = signal().await;
            println!("stop: {why}");
            let _ = stop_tx.send(true); // end open event streams so the shutdown can finish
        })
        .await?;

    let _ = watcher.await;
    let _ = ui_watcher.await;
    let running = app.hub.running();
    if !running.is_empty() {
        println!("stopping {} task(s): {}", running.len(), running.join(", "));
    }
    app.hub.shutdown().await?;
    println!("stopped clean");
    Ok(())
}

/// The dev UI (Vite on :1420) may be opened as localhost or as 127.0.0.1 (what Vite prints).
const UI_ORIGINS: [&str; 2] = ["http://localhost:1420", "http://127.0.0.1:1420"];

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(UI_ORIGINS.map(HeaderValue::from_static)))
        .allow_methods(Any)
        .allow_headers(Any)
}

async fn signal() -> &'static str {
    let ctrl_c = async { tokio::signal::ctrl_c().await.ok() };
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM");
        tokio::select! {
            _ = ctrl_c => "SIGINT",
            _ = term.recv() => "SIGTERM",
        }
    }
    #[cfg(not(unix))]
    {
        ctrl_c.await;
        "Ctrl-C"
    }
}

/// 503 while stopping, else 400 with the reason.
fn refusal(e: anyhow::Error) -> Refusal {
    if e.is::<Stopping>() { refuse(StatusCode::SERVICE_UNAVAILABLE, e) } else { refuse(StatusCode::BAD_REQUEST, format!("{e:#}")) }
}

async fn world(State(app): State<Shared>) -> Result<Json<Value>, Refusal> {
    app.hub.read(|rt| Json(rt.world())).map_err(refusal)
}

#[derive(Deserialize)]
struct Act {
    target: String,
    action: String,
    #[serde(default)]
    args: Value,
}

async fn act(State(app): State<Shared>, Json(req): Json<Act>) -> Result<Json<Value>, Refusal> {
    let twin = app.hub.act(&req.target, &req.action, &req.args).await.map_err(refusal)?;
    Ok(Json(json!({ "twin": twin })))
}

#[derive(Deserialize)]
struct Layout {
    view: String,
    layout: Value,
}

async fn layout(State(app): State<Shared>, Json(req): Json<Layout>) -> Result<Json<Value>, Refusal> {
    app.hub.with(|rt| rt.set_layout(&req.view, &req.layout)).map_err(refusal)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Theme {
    tokens: Value,
}

async fn theme(State(app): State<Shared>, Json(req): Json<Theme>) -> Result<Json<Value>, Refusal> {
    app.hub.set_theme(&req.tokens).map_err(refusal)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Ui {
    view: String,
    tree: Value,
}

async fn save_ui(State(app): State<Shared>, Json(req): Json<Ui>) -> Result<Json<Value>, Refusal> {
    app.hub.set_ui(&req.view, &req.tree).map_err(refusal)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    /// base64 (a `data:` URL prefix is accepted)
    data: String,
}

/// An image for the page background: `data/ui/assets/<name>`, served at `/ui/assets/<name>`.
async fn save_asset(State(app): State<Shared>, Json(req): Json<Asset>) -> Result<Json<Value>, Refusal> {
    let name = asset_name(&req.name).ok_or_else(|| refuse(StatusCode::BAD_REQUEST, "name must be a .png, .jpg, .jpeg, .webp, .gif, .avif or .svg file name"))?;
    let b64 = req.data.split_once("base64,").map(|(_, b)| b).unwrap_or(&req.data);
    let bytes = base64(b64).ok_or_else(|| refuse(StatusCode::BAD_REQUEST, "data is not base64"))?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err(refuse(StatusCode::BAD_REQUEST, "an asset is at most 12 MB"));
    }
    let dir = app.data.join("ui/assets");
    std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(&name), &bytes)).map_err(|e| refuse(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({ "url": format!("/ui/assets/{name}") })))
}

/// A safe file name: letters, digits, dot, dash, underscore; an image extension; no leading dot.
fn asset_name(n: &str) -> Option<String> {
    let n = n.rsplit(['/', '\\']).next()?.to_ascii_lowercase();
    let ok = !n.starts_with('.') && n.len() <= 80 && n.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    let ext = n.rsplit_once('.').map(|(_, e)| e)?;
    (ok && ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"].contains(&ext)).then_some(n)
}

fn base64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for ch in s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        let v = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

async fn events_stream(State(app): State<Shared>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut stopping = app.stopping.clone();
    let stream = BroadcastStream::new(app.hub.subscribe())
        .filter_map(|e| async move { e.ok() })
        .map(|e| {
            Ok(match e {
                Ev::Twin(id, twin) => Event::default().event("twin").json_data(json!({ "id": id, "twin": twin })).unwrap(),
                Ev::World(w) => Event::default().event("world").json_data(w).unwrap(),
            })
        })
        .take_until(async move {
            let _ = stopping.wait_for(|s| *s).await;
        });
    Sse::new(stream)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("askk-server-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    /// A file written by hand reaches the running app as a `world` event, and a broken one
    /// becomes a failed object instead of an error; the watcher stops with the app.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_watcher_hot_reloads_edits() {
        let dir = temp("watch");
        let hub = Hub::new(boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap());
        let mut events = hub.subscribe();
        let (stop, stopping) = watch::channel(false);
        let task = reload::watch(hub.clone(), dir.join("engines"), stopping);
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let world_with = |id: &'static str| {
            let mut events = events.resubscribe();
            async move {
                loop {
                    if let Ok(Ev::World(w)) = events.recv().await
                        && w.to_string().contains(id)
                    {
                        return w;
                    }
                }
            }
        };
        let t0 = std::time::Instant::now();
        let wait = world_with("askk/egg");
        std::fs::write(dir.join("engines/askk/elements/egg.md"), "---\ntitle: Egg\nkind: timer\nconfig: {seconds: 2}\n---\n").unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(4), wait).await.expect("reloaded");
        println!("hot reload seen after {:?}", t0.elapsed());

        let wait = world_with("failed");
        std::fs::write(dir.join("engines/askk/elements/egg.md"), "---\ntitle: Egg\nkind: nope\n---\n").unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(4), wait).await.expect("broken file reloaded");
        assert_eq!(hub.read(|rt| rt.twin("askk/egg")).unwrap().unwrap()["phase"], "failed");
        while events.try_recv().is_ok() {}

        stop.send(true).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), task).await.expect("watcher stops").unwrap();
        hub.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A page tree edited by hand under data/ui/ reaches the app as a `world` event.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn page_trees_hot_reload() {
        let dir = temp("ui");
        let hub = Hub::new(boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap());
        let mut events = hub.subscribe();
        let (stop, stopping) = watch::channel(false);
        let task = reload::watch(hub.clone(), dir.join("ui"), stopping);
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        std::fs::write(dir.join("ui/canvas.json"), r#"{"c":"Page","children":[{"c":"Canvas","props":{"marker":"m42"}}]}"#).unwrap();
        let seen = tokio::time::timeout(std::time::Duration::from_secs(4), async {
            loop {
                if let Ok(Ev::World(w)) = events.recv().await
                    && w["ui"]["canvas"].to_string().contains("m42")
                {
                    return;
                }
            }
        });
        seen.await.expect("ui reloaded");
        hub.set_ui("dashboard", &json!({ "c": "Page" })).unwrap();
        assert_eq!(hub.read(|rt| rt.world()["ui"]["dashboard"]["c"].clone()).unwrap(), "Page");
        stop.send(true).unwrap();
        let _ = task.await;
        hub.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// POST /ui and POST /theme refuse raw values (px, hex …) with a 400 naming the rule.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ui_and_theme_posts_refuse_raw_values() {
        let dir = temp("rules");
        let hub = Hub::new(boot(Box::new(FolderStore::open(&dir).unwrap())).unwrap());
        let (_stop, stopping) = watch::channel(false);
        let app: Shared = Arc::new(App { hub: hub.clone(), stopping, data: dir.clone() });
        let tree = json!({ "c": "Page", "children": [{ "c": "CardGrid", "props": { "min": 360 } }] });
        let r = save_ui(State(app.clone()), Json(Ui { view: "dashboard".into(), tree })).await;
        let (code, body) = r.err().expect("refused");
        assert_eq!(code, StatusCode::BAD_REQUEST);
        let body = body.0["error"].to_string();
        assert!(body.contains("width step"), "{body}");
        let r = theme(State(app.clone()), Json(Theme { tokens: json!({ "light": { "bg": "url(x)" } }) })).await;
        assert!(r.err().expect("refused").1.0["error"].to_string().contains("light.bg"));
        let ok = json!({ "c": "Page", "children": [{ "c": "CardGrid", "props": { "min": "lg", "gap": 2 } }] });
        assert!(save_ui(State(app), Json(Ui { view: "dashboard".into(), tree: ok })).await.is_ok());
        hub.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn asset_names_and_base64() {
        assert_eq!(asset_name("../x/Wall.PNG").as_deref(), Some("wall.png"));
        assert_eq!(asset_name(".hidden.png"), None);
        assert_eq!(asset_name("a.exe"), None);
        assert_eq!(base64("aGVsbG8=").unwrap(), b"hello");
        assert!(base64("??").is_none());
    }

    #[tokio::test]
    async fn cors_allows_both_dev_origins() {
        for origin in UI_ORIGINS {
            let app = Router::new().route("/world", get(|| async { "{}" })).layer(cors());
            let res = app.oneshot(Request::get("/world").header("origin", origin).body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(res.headers().get("access-control-allow-origin").unwrap(), origin);
        }
    }
}
