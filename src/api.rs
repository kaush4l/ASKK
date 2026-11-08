//! # API: what the UI can ask the backend
//!
//! Boot is lazy and happens once: seed `data/` from `defaults/` (for anything missing), scan
//! `data/engines/`, initialise every engine with the shared tools and the models runtime, start
//! one poller per alert. Paths: `ASKK_DATA` (default `data`), `ASKK_DEFAULTS` (default `defaults`).
use crate::compose::Node;
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

/// `data/ui.json`: brand and UI words. Pages and nav are folders (`data/routes`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(default)]
    pub brand: String,
    /// UI words by key (`no-engines`, `no-models`, …); a missing key shows nothing.
    #[serde(default)]
    pub text: std::collections::BTreeMap<String, String>,
}

impl UiConfig {
    pub fn t(&self, key: &str) -> String {
        self.text.get(key).cloned().unwrap_or_default()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct NavLink {
    pub label: String,
    pub to: String,
}

/// `data/layout.json`: how things are arranged (not what they are).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    /// Dashboard columns; 0 = one card per row.
    #[serde(default)]
    pub columns: u8,
    /// Engine paths shown first, in this order; the rest follow by name.
    #[serde(default)]
    pub order: Vec<String>,
    /// Element kinds left out of engine cards.
    #[serde(default)]
    pub hidden: Vec<String>,
}

impl Layout {
    /// Positions of `paths` after applying `order`.
    #[cfg_attr(not(feature = "server"), allow(dead_code))]
    pub fn arrange(&self, paths: &[String]) -> Vec<usize> {
        let mut idx: Vec<usize> = (0..paths.len()).collect();
        let rank = |p: &String| self.order.iter().position(|o| o == p).unwrap_or(usize::MAX);
        idx.sort_by(|&a, &b| rank(&paths[a]).cmp(&rank(&paths[b])).then(paths[a].cmp(&paths[b])));
        idx
    }
}

/// What the dashboard shows: one card per top-level engine, or why there are none.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct WorldView {
    pub engines: Vec<Node>,
    pub columns: u8,
    pub error: String,
}

#[cfg(feature = "server")]
pub use server::*;

#[cfg(feature = "server")]
mod server {
    use crate::core::{boot, tool, Engine, IntoTool, Tool};
    use std::{path::PathBuf, sync::Arc};
    use tokio::sync::OnceCell;

    pub fn data_dir() -> PathBuf {
        PathBuf::from(std::env::var("ASKK_DATA").unwrap_or_else(|_| "data".into()))
    }

    pub fn defaults_dir() -> PathBuf {
        PathBuf::from(std::env::var("ASKK_DEFAULTS").unwrap_or_else(|_| "defaults".into()))
    }

    /// Tools any engine may select with a `tools` element.
    pub fn shared_tools() -> Vec<Arc<dyn Tool>> {
        let comps = crate::compose::dir();
        vec![
            tool("now", "current unix time in seconds", serde_json::Value::Null, |_| {
                Ok(serde_json::json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()))
            }),
            crate::compose::CreateComponent(comps.clone()).into_tool(),
            crate::compose::ListComponents(comps).into_tool(),
            crate::routes::CreateView(crate::routes::dir()).into_tool(),
            crate::routes::ListViews(crate::routes::dir()).into_tool(),
            Quote.into_tool(),
        ]
    }

    /// Tool: last price of a symbol (Yahoo chart endpoint, no key).
    pub struct Quote;

    impl Tool for Quote {
        fn name(&self) -> String {
            "quote".into()
        }
        fn description(&self) -> String {
            "latest market price of a ticker".into()
        }
        fn args(&self) -> serde_json::Value {
            serde_json::json!({"symbol": "e.g. AAPL"})
        }
        fn invoke(&self, args: serde_json::Value, _: crate::core::Toolbox) -> crate::core::Fut<Result<serde_json::Value, String>> {
            Box::pin(async move {
                let sym = args["symbol"].as_str().ok_or("symbol missing")?.to_uppercase();
                let url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d");
                let v: serde_json::Value = reqwest::Client::new()
                    .get(&url)
                    .header("user-agent", "askk/0.1")
                    .send()
                    .await
                    .map_err(|e| e.to_string())?
                    .json()
                    .await
                    .map_err(|e| e.to_string())?;
                v["chart"]["result"][0]["meta"]["regularMarketPrice"].as_f64().map(|p| serde_json::json!(p)).ok_or_else(|| format!("no price for {sym}"))
            })
        }
    }

    /// Boot at process start on its own runtime, so engines and alert pollers run before any
    /// page is opened.
    pub fn boot_now() {
        std::thread::spawn(|| {
            let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
            rt.block_on(async {
                let w = world().await;
                eprintln!("askk: {} engine(s) booted{}", w.engines.len(), if w.error.is_empty() { String::new() } else { format!("; errors: {}", w.error) });
                std::future::pending::<()>().await
            });
        });
    }

    pub struct World {
        pub engines: Vec<Arc<Engine>>,
        pub error: String,
    }

    static WORLD: OnceCell<World> = OnceCell::const_new();

    fn start() -> World {
        if let Err(e) = boot::seed(&defaults_dir(), &data_dir()) {
            eprintln!("seed: {e}");
        }
        let shared = shared_tools();
        let infer: Arc<dyn crate::core::Infer> = Arc::new(crate::infer::ModelsInfer);
        let trees = match boot::scan(&data_dir().join("engines")) {
            Ok(t) => t,
            Err(e) => return World { engines: vec![], error: e },
        };
        let mut engines = vec![];
        let mut errors = vec![];
        for t in trees {
            match boot::init(t, &shared, infer.clone()) {
                Ok(e) => engines.push(e),
                Err(e) => errors.push(e),
            }
        }
        for e in &engines {
            watch_all(e.clone());
        }
        World { engines, error: errors.join("\n") }
    }

    /// One poller per alert, for this engine and its sub-engines.
    fn watch_all(e: Arc<Engine>) {
        for w in e.watches() {
            let e = e.clone();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(std::time::Duration::from_millis(w.every_ms));
                loop {
                    tick.tick().await;
                    let v = match e.toolbox().call(&w.source.tool, w.source.args.clone()).await {
                        Ok(v) => v.as_f64(),
                        Err(err) => {
                            eprintln!("askk: alert {}/{}: {err}", e.path, w.name);
                            continue;
                        }
                    };
                    let Some(v) = v else { continue };
                    for input in e.observe(&w.name, v) {
                        let e = e.clone();
                        tokio::spawn(async move {
                            let _ = e.run(&input).await;
                        });
                    }
                }
            });
        }
        for s in &e.subs {
            watch_all(s.clone());
        }
    }

    pub async fn world() -> &'static World {
        WORLD.get_or_init(|| async { start() }).await
    }

    pub async fn find(path: &str) -> Option<Arc<Engine>> {
        let root = path.split('/').next().unwrap_or_default();
        world().await.engines.iter().find(|e| e.path == root).and_then(|e| e.find(path))
    }
}

#[server]
pub async fn ui_config() -> Result<UiConfig, ServerFnError> {
    world().await;
    let s = std::fs::read_to_string(data_dir().join("ui.json")).unwrap_or_default();
    Ok(serde_json::from_str(&s).unwrap_or_default())
}

#[server]
pub async fn world_view() -> Result<WorldView, ServerFnError> {
    let w = world().await;
    let l = load_layout();
    let paths: Vec<String> = w.engines.iter().map(|e| e.path.clone()).collect();
    let engines = l.arrange(&paths).into_iter().map(|i| w.engines[i].view_with(&l.hidden)).collect();
    Ok(WorldView { engines, columns: l.columns, error: w.error.clone() })
}

#[server]
pub async fn engine_view(path: String) -> Result<Node, ServerFnError> {
    find(&path).await.map(|e| e.view_with(&load_layout().hidden)).ok_or_else(|| ServerFnError::new(format!("no engine '{path}'")))
}

/// Invoke an engine (it is a tool: input in, answer out).
#[server]
pub async fn run_engine(path: String, input: String) -> Result<String, ServerFnError> {
    let e = find(&path).await.ok_or_else(|| ServerFnError::new(format!("no engine '{path}'")))?;
    e.run(&input).await.map_err(ServerFnError::new)
}

/// A component kind and its own documentation.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct KindDoc {
    pub kind: String,
    pub doc: String,
}

/// The catalog: every registered component kind with its docs.
#[server]
pub async fn kinds() -> Result<Vec<KindDoc>, ServerFnError> {
    Ok(crate::core::KINDS
        .iter()
        .map(|(k, _)| {
            let c = crate::core::build(crate::core::Spec { kind: k.to_string(), name: k.to_string(), ..Default::default() }).unwrap();
            KindDoc { kind: k.to_string(), doc: c.doc().to_string() }
        })
        .collect())
}

#[server]
pub async fn stop_engine(path: String) -> Result<(), ServerFnError> {
    find(&path).await.ok_or_else(|| ServerFnError::new(format!("no engine '{path}'")))?.stop();
    Ok(())
}

/// Long-poll for live updates: returns as soon as the change counter of `path` (empty = all
/// engines) differs from `seen`, or after ~20 s.
#[server]
pub async fn wait_change(path: String, seen: u64) -> Result<u64, ServerFnError> {
    for _ in 0..80 {
        let now = if path.is_empty() {
            world().await.engines.iter().map(|e| e.total_version()).sum()
        } else {
            find(&path).await.map(|e| e.total_version()).unwrap_or(0)
        };
        if now != seen {
            return Ok(now);
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Ok(seen)
}

/// `data/theme.json`: CSS custom properties that override the built-in tokens.
#[server]
pub async fn theme() -> Result<std::collections::BTreeMap<String, String>, ServerFnError> {
    let s = std::fs::read_to_string(data_dir().join("theme.json")).unwrap_or_default();
    Ok(serde_json::from_str(&s).unwrap_or_default())
}

#[server]
pub async fn save_theme(tokens: std::collections::BTreeMap<String, String>) -> Result<(), ServerFnError> {
    if let Some(bad) = tokens.keys().find(|k| !k.starts_with("--") || k.contains(['{', '}', ';'])) {
        return Err(ServerFnError::new(format!("bad token name '{bad}'")));
    }
    if tokens.values().any(|v| v.contains(['{', '}', ';'])) {
        return Err(ServerFnError::new("token values cannot contain { } ;"));
    }
    std::fs::write(data_dir().join("theme.json"), serde_json::to_string_pretty(&tokens).unwrap()).map_err(|e| ServerFnError::new(e.to_string()))
}

#[cfg(feature = "server")]
fn load_layout() -> Layout {
    std::fs::read_to_string(data_dir().join("layout.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

#[server]
pub async fn layout() -> Result<Layout, ServerFnError> {
    Ok(load_layout())
}

#[server]
pub async fn save_layout(layout: Layout) -> Result<(), ServerFnError> {
    std::fs::write(data_dir().join("layout.json"), serde_json::to_string_pretty(&layout).unwrap()).map_err(|e| ServerFnError::new(e.to_string()))
}

/// Paths of all engines, depth first (for the Layout page).
#[server]
pub async fn engine_paths() -> Result<Vec<String>, ServerFnError> {
    fn walk(e: &crate::core::Engine, out: &mut Vec<String>) {
        out.push(e.path.clone());
        e.subs.iter().for_each(|s| walk(s, out));
    }
    let mut out = vec![];
    world().await.engines.iter().for_each(|e| walk(e, &mut out));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_orders_listed_engines_first_then_by_name() {
        let l = Layout { order: vec!["z".into(), "b".into()], ..Default::default() };
        let paths: Vec<String> = ["a", "b", "c", "z"].map(String::from).to_vec();
        let got: Vec<&str> = l.arrange(&paths).into_iter().map(|i| paths[i].as_str()).collect();
        assert_eq!(got, ["z", "b", "a", "c"]);
    }
}
