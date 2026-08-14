//! THE THREAD LIST — every loaded agent's conversation on one view, the routed
//! one open (docs/THREADS.md). A composition, not a component: every element in
//! it is `Card`, `Button`, `Badge` or `ChatPane`, which is what `ui/` is for.
//!
//! It is not a second board (R15-IA). It writes no sentence of its own: every
//! word on a collapsed row is the board row's `data-line`, the one string
//! `boardrow.rs` composes precisely so a second surface can quote it — the same
//! thing `runstatus::LaunchedRun` does with the same read.
//!
//! THREE COST RULES (§6), all three visible in this file:
//! 1. ONE `/board` read per LIST, not one per row — one `String` down to every
//!    summary, and no read at all while the Chat view is not the one on screen.
//! 2. Only the focused thread has a `ChatPane`, so only it polls. Nothing else
//!    here holds a clock; the collapsed rows re-project on the shell's 2 s
//!    heartbeat, which every panel already redraws from.
//! 3. Openness is written NOWHERE — not a fact, not a KV key, not a preference.
//!    In this increment it is not even a signal: the open thread is the one the
//!    hash names. Every request this file adds is a GET that appends nothing
//!    (15M: seam GETs that appended made polling dearer forever).

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::boardcell::cell;
use crate::ui::{Badge, Button, Card};
use crate::views::View;

/// The row's own status WORD, and the rest of its sentence. One string in, the
/// same string out: the word goes in the `Badge` — the one element that draws
/// `--tone` next to a label — and everything after the first separator is the
/// board's sentence, untouched. Nothing here re-words anything (R8-8).
fn said(line: &str) -> (String, String) {
    match line.split_once(" · ") {
        Some((word, rest)) => (word.to_string(), rest.to_string()),
        None => (line.to_string(), String::new()),
    }
}

/// One thread's summary: the control that opens it, and everything the board
/// knows about that agent. A `Button`, because it needs `aria-expanded`,
/// `aria-controls`, an `id` and the 44px floor, and all four pass through it.
///
/// NOT a `<details>`: openness here is routed state, and a disclosure the user
/// toggles behind the signal's back desynchronises the two (THREADS.md §5).
fn summary(who: &str, board: &str, open: bool, mut selected: Signal<String>) -> Element {
    let line = cell(board, who, "data-line").unwrap_or_default();
    let status = cell(board, who, "data-status").unwrap_or_else(|| "idle".to_string());
    let (word, rest) = said(&line);
    let name = who.to_string();
    rsx! {
        Button {
            id: "thread-{who}",
            class: "thread-summary",
            variant: "ghost",
            aria_expanded: if open { "true" } else { "false" },
            // …only while there IS a panel: `aria-controls` naming an id no
            // element carries is a promise to a screen reader that nothing
            // keeps. A collapsed thread has no pane in the document at all.
            aria_controls: open.then(|| format!("chat-panel-{who}")),
            onclick: move |_| {
                // ONE GESTURE, ONE MEANING (§3): opening a thread focuses it,
                // which is the same `selected.set` the tab strip has always
                // done, and the hash follows from the shell's own effect.
                if *selected.peek() != name {
                    selected.set(name.clone());
                }
            },
            // Disclosure state in a glyph AND in `aria-expanded`, because the
            // glyph is what survives the stylesheet being off.
            span { class: "thread-mark", aria_hidden: "true", if open { "▾ " } else { "▸ " } }
            strong { class: "thread-who", "{who}" }
            if !word.is_empty() { Badge { status: status.clone(), label: word.clone() } }
            if !rest.is_empty() { span { class: "thread-line", "{rest}" } }
        }
    }
}

/// One row per LOADED agent, in roster order — the same list the tab strip
/// renders — and the conversation with the routed one, open in place.
#[component]
#[allow(clippy::too_many_arguments)]
pub fn ThreadList(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
    tokens: Signal<u64>,
    roster: ReadSignal<String>,
    loaded: Signal<Vec<String>>,
    /// The FOCUSED thread: the one the hash names, and the only one open here.
    selected: Signal<String>,
    view: Signal<View>,
) -> Element {
    let mut board = use_signal(String::new);
    // RULE 1. One GET for the whole list, on the heartbeat every other panel
    // already redraws from — and none at all off-route: this list is mounted on
    // every view, because the pane inside it must be (its poller belongs to a
    // turn in flight), and a summary nobody can see is not worth a request.
    use_effect(move || {
        let _ = tick();
        if view() != View::Chat {
            return;
        }
        let Some(app) = web.read().clone() else { return };
        let now = app.handle(Request::get("/board")).body;
        if *board.peek() != now {
            board.set(now);
        }
    });

    let projection = board.read().clone();
    let here = selected.read().clone();
    let mut names = loaded.read().clone();
    // Before the roster has arrived — and after a hash naming an agent the
    // roster does not have, which `route::listen` is on its way to correcting —
    // the focused thread still gets its row and its pane. Exactly one pane is
    // mounted at all times, which is what `tokens` is published from.
    if !names.contains(&here) {
        names.insert(0, here.clone());
    }
    rsx! {
        div { class: "threads",
            for name in names {
                {
                    let open = name == here;
                    let head = summary(&name, &projection, open, selected);
                    rsx! {
                        if open {
                            crate::chat::ChatPane {
                                key: "{name}",
                                web, endpoint_set, tick, tokens, roster,
                                agent: selected, view, head,
                            }
                        } else {
                            Card { key: "{name}", {head} }
                        }
                    }
                }
            }
        }
    }
}
