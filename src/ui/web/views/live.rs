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
//!
//! A page outlives one run of the service. Whenever the listener has been away, or the change
//! feed started over, it asks `hello` and holds the answer against the one it had; what that
//! means is decided once for every UI (`ui/features/service.rs`), and done here: a service
//! that restarted is asked for everything again, a service that was built again makes the
//! page load itself again, so that page and service are always the same build.
use crate::core::changes::matches;
use crate::core::manifest::Manifest;
use crate::core::service::Hello;
use crate::ui::features::service::{made_for, seen as held_against, Seen};
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

/// Load this page again, because the service that answers was made from other source than
/// this page (`build` names the service's). Once per build of the service and no more: a
/// browser that keeps handing out the old page must not make it load for ever.
fn load_again(build: &str) {
    let build = serde_json::to_string(build).unwrap_or_default();
    let _ = document::eval(&format!(
        "try {{ const k = 'askk-loaded-for', b = {build}; if (sessionStorage.getItem(k) !== b) {{ sessionStorage.setItem(k, b); location.reload(); }} }} catch (e) {{}}"
    ));
}

/// Start the tab's one listener and provide [`Live`] to every view below.
pub fn use_live_provider() -> Live {
    let mut keys = use_signal(BTreeMap::<String, u64>::new);
    let mut reset = use_signal(|| 0u64);
    let mut away = use_signal(|| false);
    let live = use_context_provider(|| Live { keys, reset, away });
    use_future(move || async move {
        let (mut epoch, mut seen) = (0u64, 0u64);
        // Who answered last time this page asked.
        let mut known: Option<Hello> = None;
        loop {
            match crate::api::changes(epoch, seen).await {
                Ok(c) => {
                    let back = *away.peek();
                    if back {
                        away.set(false);
                    }
                    let mut again = epoch != 0 && c.epoch != epoch;
                    // First answer, back from being away, or the feed started over: is this
                    // still the askk this page was made for and was talking to?
                    if known.is_none() || back || again {
                        let now = crate::api::hello().await.ok();
                        match held_against(known.as_ref(), now.as_ref()) {
                            Seen::Rebuilt => load_again(now.as_ref().map(|h| h.build.as_str()).unwrap_or_default()),
                            Seen::Restarted => again = true,
                            Seen::Same | Seen::Gone => {}
                        }
                        // A browser may have kept a page from before the service was built.
                        if let Some(h) = now.as_ref().filter(|h| known.is_none() && !made_for(crate::core::places::BUILD, h)) {
                            load_again(&h.build);
                        }
                        known = now.or(known);
                    }
                    if again {
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
