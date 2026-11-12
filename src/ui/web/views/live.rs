//! # Live: backend change marks → signals (P8)
//!
//! One listener per tab ([`use_live_provider`], in the shell) holds the last sequence it saw
//! and asks [`crate::api::changes`] what changed after it; the server parks until a domain
//! object marks itself changed, so nothing is fetched on a timer. Each changed key lands in one
//! signal map.
//!
//! A view subscribes to the keys it shows with [`use_live`]: a memo over that map, filtered by
//! prefix, that only moves when a matching key does. A resource that reads it re-runs then and
//! only then — the dashboard does not refetch when the theme changes, an engine page does not
//! refetch when another engine thinks.
use crate::core::changes::matches;
use crate::core::manifest::Manifest;
use dioxus::prelude::*;
use std::collections::BTreeMap;

/// The keys changed in this tab's lifetime (key → sequence of its last change), and a reset
/// counter bumped when the server restarted (every view refreshes then).
#[derive(Clone, Copy)]
pub struct Live {
    keys: Signal<BTreeMap<String, u64>>,
    reset: Signal<u64>,
    /// Whether the last ask got no answer (the host is away).
    away: Signal<bool>,
}

impl Live {
    /// Whether the host is away. Reading it subscribes.
    pub fn away(&self) -> bool {
        (self.away)()
    }
}

/// Start the tab's one listener and provide [`Live`] to every view below.
pub fn use_live_provider() -> Live {
    let mut keys = use_signal(BTreeMap::<String, u64>::new);
    let mut reset = use_signal(|| 0u64);
    let mut away = use_signal(|| false);
    let live = use_context_provider(|| Live { keys, reset, away });
    use_future(move || async move {
        let (mut epoch, mut seen) = (0u64, 0u64);
        loop {
            match crate::api::changes(epoch, seen).await {
                Ok(c) => {
                    if *away.peek() {
                        away.set(false);
                    }
                    if epoch != 0 && c.epoch != epoch {
                        keys.write().clear();
                        reset += 1;
                    }
                    (epoch, seen) = (c.epoch, c.seq);
                    if !c.keys.is_empty() {
                        let mut k = keys.write();
                        for (key, s) in c.keys {
                            k.insert(key, s);
                        }
                    }
                }
                // Server away (restarting): try again shortly, not in a tight loop.
                Err(_) => {
                    if !*away.peek() {
                        away.set(true);
                    }
                    let _ = document::eval("await new Promise(r => setTimeout(r, 2000)); return 0;").await;
                }
            }
        }
    });
    live
}

/// A version of everything at or below `prefix` (the empty prefix: everything). Reading it
/// subscribes; it changes only when a matching key is marked changed.
pub fn use_live(prefix: impl Fn() -> String + 'static) -> Memo<(u64, u64)> {
    let live = use_context::<Live>();
    use_memo(move || {
        let p = prefix();
        let newest = live.keys.read().iter().filter(|(k, _)| matches(&p, k)).map(|(_, s)| *s).max().unwrap_or(0);
        ((live.reset)(), newest)
    })
}

/// The manifest the world was loaded with (provided by the shell).
pub fn use_manifest() -> Manifest {
    try_use_context::<Manifest>().unwrap_or_default()
}

/// A value rendered on the server (hydrated, no loading flash) and kept fresh after: when a key
/// under `prefix` is marked changed, it is fetched again into the same signal **without
/// suspending** — re-running a server future would suspend this component and remount
/// everything below it (a shell refetching its theme would reload the page under it).
pub fn use_live_server<T, F>(prefix: impl Fn() -> String + 'static, fetch: impl Fn() -> F + Clone + 'static) -> Result<Signal<Option<T>>, RenderError>
where
    T: Clone + PartialEq + serde::Serialize + serde::de::DeserializeOwned + 'static,
    F: std::future::Future<Output = Result<T, ServerFnError>> + 'static,
{
    let f0 = fetch.clone();
    let first = use_server_future(move || f0())?;
    let init = first.peek().as_ref().and_then(|r| r.as_ref().ok()).cloned();
    let mut value = use_signal(|| init);
    let live = use_live(prefix);
    let mut last = use_signal(|| None::<(u64, u64)>);
    use_effect(move || {
        let v = live();
        let before = *last.peek();
        last.set(Some(v));
        // The first value is already fresh; only a later change refetches.
        if before.is_none() || before == Some(v) {
            return;
        }
        let f = fetch.clone();
        spawn(async move {
            if let Ok(x) = f().await {
                value.set(Some(x));
            }
        });
    });
    Ok(value)
}
