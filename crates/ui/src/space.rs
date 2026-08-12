//! `SpaceInspector` — facts, notes and the workspace path (plan, "UI shape";
//! Python counterpart `core/space.py`). It owns nothing but the fetch: the
//! content is the core's own read of the shared store, so what this shows and
//! what is in every agent's prompt are the same read.

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::{focus, Button, Card, Disclosure, EmptyState, Skeleton, COMPOSER_ID};

/// A space changes when ANOTHER Worker writes to it, which happens on nobody's
/// schedule — so this pane keeps its own slow clock while the page is open.
/// 2 s, not 400 ms: a note is read by a person, not raced for.
const TICK_MS: i32 = 2000;

/// A space that exists and holds nothing. Its own fn so `SpaceInspector`
/// stays one job (I12).
fn nothing_shared(who: &str) -> Element {
    rsx! {
        EmptyState {
            glyph: "◈",
            title: "Nothing has been recorded here yet",
            sentence: "A space is the memory every agent whose file names it shares. Facts \
                       and notes written here are read into all of their prompts before \
                       every turn, so something recorded once is something nobody has to be \
                       asked for again. {who} fills it with remember and post_note while a \
                       turn is running.",
            Button {
                variant: "secondary",
                onclick: move |_| focus(COMPOSER_ID),
                "Ask {who} to remember something"
            }
        }
    }
}

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
    let projection = panel.read().clone();
    let who = agent();
    // The core counts what it rendered onto the panel element — this only
    // reads the numbers back, the same contract `terminal::commands_in` has
    // with `data-commands`. A space with no facts and no notes is the only
    // genuinely empty one; the two other nothing-to-show cases (this agent
    // names no space, this page reads a different space) carry the core's own
    // agent-specific sentence, which says more than any generic state could.
    let bare = projection.contains("data-facts=\"0\"") && projection.contains("data-notes=\"0\"");
    rsx! {
        Card { title: "Shared space", aria_label: "Shared space",
            div { aria_live: "polite",
                if projection.is_empty() {
                    Skeleton { lines: 3, label: "Reading the shared space" }
                } else if bare {
                    {nothing_shared(&who)}
                } else {
                    div { dangerous_inner_html: "{projection}" }
                }
            }
            // Five lines in front of "No shared facts yet." (12b walk, finding
            // D2). The live read comes first now and the paragraph is behind
            // the marker, unchanged.
            Disclosure { summary: "How the shared space is read and written",
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
