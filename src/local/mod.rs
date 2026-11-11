//! # Local: the browser tab as the host (a spike, `local` build only)
//!
//! The same boot as `host/world.rs` — seed → load → init — with what a tab has instead of a
//! machine:
//!
//! | port | here | the server's |
//! | --- | --- | --- |
//! | store | a bundle in memory that follows to IndexedDB (`store.rs`) | a folder |
//! | lock | a browser lock held for the tab's life | `askk.pid` |
//! | defaults | compiled in by `build.rs` | the `defaults` folder |
//! | infer | `fetch` from the tab (`infer.rs`) | reqwest, or a command |
//! | shared tools | `run_code`: a program in the browser's sandbox (`code.rs`) | `host/tools.rs` |
//! | files, media, harnesses | none (the core's "nothing here" forms) | the disk, programs |
//!
//! Not here yet: alert pollers.
pub mod code;
pub mod infer;
mod page;
pub mod store;

use crate::core::world::World;
use crate::core::{boot, store as data, Fut};
use std::sync::Arc;

/// Run a tab-bound future (anything that touches the browser is not `Send`) on the tab's own
/// loop; only its result crosses, over a channel, so the returned future is `Send` as the
/// core's ports ask.
pub fn on_tab<T: Send + 'static>(f: impl std::future::Future<Output = Result<T, String>> + 'static) -> Fut<Result<T, String>> {
    let (tx, rx) = futures::channel::oneshot::channel();
    wasm_bindgen_futures::spawn_local(async move {
        let _ = tx.send(f.await);
    });
    Box::pin(async move { rx.await.unwrap_or_else(|_| Err("the tab dropped the request".into())) })
}

fn start() -> World {
    // One writer per world: a second tab boots no engines.
    if !store::status().held {
        return World { error: "another tab is running this world; close it, then load this page again".into(), ..Default::default() };
    }
    let data = data::data();
    let packed: std::collections::BTreeMap<String, String> = serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/defaults.json"))).unwrap_or_default();
    let defaults = data::Bundle::memory(packed);
    let mut errors = vec![];
    if let Err(e) = boot::seed(&defaults, &*data) {
        errors.push(format!("seed: {e}"));
    }
    let snap = match boot::load(&*data) {
        Ok(s) => s,
        Err(e) => return World { error: e, ..Default::default() },
    };
    let report = snap.report();
    crate::core::manifest::set(snap.manifest.clone());
    crate::core::board::init(data.clone(), &snap.manifest.board);
    crate::core::tasks::set(Arc::new(Loop));
    // What this build can do, noted beside the lines that make it so (core/caps.rs).
    use crate::core::caps::provided;
    provided("store", "this browser's own storage (IndexedDB)");
    provided("engines", "booted from the browser's storage");
    provided("background", "this tab's own loop, for as long as the tab is open");
    provided("models", "any model server the tab can reach (typed in on the page)");
    provided("code", "programs run in the browser's sandbox (JavaScript, Python)");
    let infer: Arc<dyn crate::core::Infer> = Arc::new(infer::Tab);
    let shared = code::tools();
    let mut engines = vec![];
    for t in snap.engines {
        match boot::init(t, data.clone(), &shared, infer.clone()) {
            Ok(e) => engines.push(e),
            Err(e) => errors.push(e),
        }
    }
    World { engines, report, error: errors.join("\n") }
}

/// Draw the spike's page. This build leaves `dioxus/fullstack` out (see `Cargo.toml`): with it
/// the web renderer always hydrates, and no server rendered anything here.
///
/// The disk is read first (it cannot be read synchronously), then boot is the usual one.
pub fn launch() {
    wasm_bindgen_futures::spawn_local(async {
        store::open().await;
        crate::core::world::boots_with(start);
        dioxus::launch(page::Page);
    });
}

/// Background work runs on the tab's own loop.
struct Loop;

impl crate::core::tasks::Tasks for Loop {
    fn spawn(&self, work: crate::core::Fut<()>) {
        wasm_bindgen_futures::spawn_local(work);
    }
}
