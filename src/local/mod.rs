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
    let defaults = crate::core::store::packed();
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
    crate::core::code::set(Arc::new(code::Sandbox));
    let shared: Vec<Arc<dyn crate::core::Tool>> = vec![Arc::new(crate::core::code::RunCode)];
    let mut engines = vec![];
    for t in snap.engines {
        match boot::init(t, data.clone(), &shared, infer.clone()) {
            Ok(e) => engines.push(e),
            Err(e) => errors.push(e),
        }
    }
    // A post wakes its engine, as on a machine.
    crate::core::world::wire_board();
    World { engines, report, error: errors.join("\n") }
}

/// The address's query (`?model=…&ask=…`), read before anything is drawn.
#[wasm_bindgen::prelude::wasm_bindgen(inline_js = "export function query() { return location.search; }")]
extern "C" {
    fn query() -> String;
}

/// Draw `app`: the same window as a page served by askk, handed in by `main.rs` (the tab does
/// not know who draws), its questions answered by this tab. An address that asks a question
/// (`?ask=…`, how `scripts/landmark.sh` and a shared link ask with no hand on the page) gets
/// the bare page that runs it once (`page.rs`).
///
/// This build leaves `dioxus/fullstack` out (see `Cargo.toml`): with it the web renderer always
/// hydrates, and no server rendered anything here. The disk is read first (it cannot be read
/// synchronously), then boot is the usual one.
pub fn launch(app: fn() -> dioxus::prelude::Element) {
    wasm_bindgen_futures::spawn_local(async move {
        store::open().await;
        crate::core::world::boots_with(start);
        // Messages left from before the tab was closed are still new.
        crate::core::world::wake_pending();
        if query().contains("ask=") {
            dioxus::launch(page::Page);
        } else {
            dioxus::launch(app);
        }
    });
}

/// Background work runs on the tab's own loop.
struct Loop;

impl crate::core::tasks::Tasks for Loop {
    fn spawn(&self, work: crate::core::Fut<()>) {
        wasm_bindgen_futures::spawn_local(work);
    }
}
