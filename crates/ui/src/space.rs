//! `SpaceInspector` — facts, notes and the workspace path (plan, "UI shape";
//! Python counterpart `core/space.py`). It owns nothing but the fetch: the
//! content is the core's own read of the shared store, so what this shows and
//! what is in every agent's prompt are the same read.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

/// A space changes when ANOTHER Worker writes to it, which happens on nobody's
/// schedule — so this pane keeps its own slow clock while the page is open.
/// 2 s, not 400 ms: a note is read by a person, not raced for.
const TICK_MS: i32 = 2000;

#[component]
pub fn SpaceInspector(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// WHOSE space (09 walk, finding 3). The pane was global, so selecting
    /// the one agent with no space still showed "Space: research" — the same
    /// `x-agent` addressing every other per-agent read uses.
    agent: ReadSignal<String>,
) -> Element {
    let mut panel = use_signal(String::new);
    let read = move || match web.peek().clone() {
        Some(app) => app
            .handle(Request::get("/space").with_header("x-agent", &agent()))
            .body,
        None => String::new(),
    };
    use_effect(move || {
        let _ = (tick(), agent());
        if web.read().is_none() {
            return;
        }
        panel.set(read());
        spawn(async move {
            loop {
                if sleep(TICK_MS).await.is_err() {
                    return;
                }
                panel.set(read());
            }
        });
    });
    rsx! {
        section { class: "panel", aria_label: "Shared space",
            h2 { "Shared space" }
            div { aria_live: "polite", dangerous_inner_html: "{panel}" }
            // Five lines in front of "No shared facts yet." (12b walk, finding
            // D2). The live read comes first now and the paragraph is behind
            // the marker, unchanged.
            details { class: "panel-note",
                summary { "How the shared space is read and written" }
                p { class: "note",
                    "Every agent whose file names this space reads it — each one in its own \
                     Worker, out of one shared store — and writes to it with remember, forget \
                     and post_note. It goes into their prompts before every turn, so a fact \
                     recorded here is one nobody has to be asked for again."
                }
            }
        }
    }
}
