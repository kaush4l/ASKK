//! L3 (ARCHITECTURE §4): the Dioxus app, replacing htmx and `transport.js`.
//! An event handler calls `core::handle` directly through `WebApp::handle`, so
//! the seam is unchanged (I4) and no application logic is left in JS (I5).
//!
//! This crate owns layout and nothing else — every byte of content in `main`
//! comes back from the core as a fragment (I8).

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

fn main() {
    dioxus::launch(shell);
}

/// Boot is async (IndexedDB), so the shell paints immediately and the main
/// region fills when the core is up. A boot failure is shown, never swallowed.
fn shell() -> Element {
    let booted = use_resource(|| async { WebApp::boot().await.map_err(|e| format!("{e:?}")) });
    let mut fragment = use_signal(String::new);
    let mut failure = use_signal(String::new);

    // The first trip through the seam: `GET /` is the dashboard route the
    // registry already owns. Runs once, when the resource resolves.
    use_effect(move || match &*booted.read() {
        Some(Ok(web)) => fragment.set(web.handle(Request::get("/")).body),
        Some(Err(e)) => failure.set(e.clone()),
        None => {}
    });

    rsx! {
        header {
            h1 { "ASKK" }
        }
        main {
            if !failure.read().is_empty() {
                p { class: "error", "core failed to boot: {failure}" }
            } else if fragment.read().is_empty() {
                p { class: "pending", "booting the core…" }
            } else {
                // The fragment is built by the core's escaping primitives
                // (module::view) — the one scar the htmx design leaves.
                div { dangerous_inner_html: "{fragment}" }
            }
        }
    }
}
