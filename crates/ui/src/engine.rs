//! WHICH Linux, as a setting (increment 18). The same shape as `skin.rs`: one
//! stored bit, a control in Settings, and no application logic anywhere near
//! it — `adapters_web::engine` owns the storage, this owns the switch.
//!
//! A SELECT, NOT A TOGGLE. `skin.rs` is a toggle because its bit has an off
//! state (a glow you turn on). Neither engine is the absence of the other, and
//! a switch labelled `container2wasm: off` would be naming one of two things
//! as the negation of the other — DESIGN.md §8's field, `select` variant.
//!
//! IT SAYS WHAT IT COSTS, BEFORE YOU PRESS IT. The two engines differ on where
//! the code comes from, how fast the guest is, and whether files survive a
//! reload — and the third changes a promise the rest of the product makes.
//!
//! …AND THE OPTIONS CARRY IT (R10-7). They read `CheerpX` and `container2wasm`:
//! two product names a first-timer has never heard, so the only way to learn
//! what one was was to select it. The trade is in the label now, and the files —
//! the consequence that matters — are their own line rather than body copy
//! shouting in capitals.

use std::rc::Rc;

use adapters_web::{engine, set_engine, stored, Engine, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::{Button, Card, SelectField};

/// What each engine is. Prose lives here, not in `adapters_web`: it is copy.
fn described(which: Engine) -> &'static str {
    match which {
        Engine::Cheerpx => "Streams its disk from Leaning Tech's servers and loads their engine \
             from their CDN, under a community licence. It compiles hot code as it runs, so it is \
             the faster of the two.",
        Engine::C2w => "Runs an image this site hosts itself — no third-party server and no \
             licence. It is an emulator with no compiler, so commands take noticeably longer. The \
             first load fetches about 48 MB.",
    }
}

/// The one sentence about files, on its own line — the fact that decides whether
/// you can trust this thing with your work — and the class that says whether it
/// is a promise or a cost. `.warn` is the product's existing warning line, and
/// using it for the engine that KEEPS files would make the colour mean nothing.
fn files_said(which: Engine) -> (&'static str, &'static str) {
    match which {
        Engine::Cheerpx => (
            "note",
            "Files you write are kept in this browser and are still there after a reload.",
        ),
        Engine::C2w => (
            "warn",
            "Its filesystem is in memory: everything written in this Linux is lost when the \
             page reloads, including anything an agent is part-way through.",
        ),
    }
}

/// The picker's own label — the name, then the trade a reader weighs.
fn option_label(which: Engine) -> &'static str {
    match which {
        Engine::Cheerpx => "CheerpX — faster, keeps your files, loads from a third party",
        Engine::C2w => "container2wasm — ours alone, slower, forgets files on reload",
    }
}

fn from_key(key: &str) -> Engine {
    match key {
        "c2w" => Engine::C2w,
        _ => Engine::Cheerpx,
    }
}

fn reload() {
    if let Some(w) = web_sys::window() {
        let _ = w.location().reload();
    }
}

/// Whether a turn is in flight — the board's own `x-busy`, the fact the header
/// pill reads. A reload during one kills it (R10-4).
fn working(web: &Signal<Option<Rc<WebApp>>>) -> String {
    let Some(app) = web.peek().clone() else {
        return String::new();
    };
    app.handle(Request::get("/board"))
        .headers
        .iter()
        .find(|(k, _)| k == "x-busy")
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// The picker. `chosen` is what the select shows; `engine()` is what this page
/// is actually running, and the gap between them is the whole reason the card
/// has a status line.
#[component]
pub fn LinuxEngine(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// Whose workspace is counted when this card says what a reload destroys
    /// (R11-7). The page's subject, the same name every other pane is scoped to.
    agent: ReadSignal<String>,
) -> Element {
    let running = engine();
    let mut chosen = use_signal(stored);
    let mut armed = use_signal(|| false);
    let pending = chosen() != running;
    let _ = tick(); // the busy read below is a projection, so it follows the beat
    let busy = working(&web);
    let files = files_said(chosen());
    // WHAT THE RELOAD COSTS, before it happens, COUNTED, and about the engine
    // this page is RUNNING rather than the one it is about to run (R10-4,
    // R11-7, R11-8). `enginecost.rs` owns the arithmetic and the wording.
    let loses = crate::enginecost::cost(&web, &agent(), &busy, running);
    rsx! {
        Card { title: "Linux engine", aria_label: "Linux engine", variant: "flat reading",
            p { class: "note",
                "The agent's shell runs in a Linux inside this tab. There are two, and they are \
                 not the same trade: one is faster and comes from somebody else's servers, the \
                 other is ours and forgets."
            }
            SelectField {
                id: "workspace-engine",
                label: "Which Linux this page runs",
                value: "{chosen().key()}",
                onchange: move |e: FormEvent| {
                    let picked = from_key(&e.value());
                    chosen.set(picked);
                    set_engine(picked);
                    armed.set(false);
                },
                option {
                    value: "cheerpx",
                    selected: chosen() == Engine::Cheerpx,
                    "{option_label(Engine::Cheerpx)}"
                }
                option {
                    value: "c2w",
                    selected: chosen() == Engine::C2w,
                    "{option_label(Engine::C2w)}"
                }
            }
            p { class: "note", "{described(chosen())}" }
            // ITS OWN LINE, IN THE ONE COLOUR THAT MEANS "THIS COSTS YOU
            // SOMETHING" (R10-7) — not capitals inside a paragraph.
            p { class: "{files.0}", "{files.1}" }
            // ONE REGION, ONE MESSAGE (the pattern `settings_view.rs` arrived
            // at): either this page is running what the select says, or it is
            // not, and the second case is the only one worth a status.
            if pending {
                p { class: "file-state dirty", role: "status",
                    "Saved. This page is still running {running.label()} — the engine is chosen \
                     once, when the page loads, so reload to switch to {chosen().label()}."
                }
                {reload_control(armed, loses)}
            } else {
                p { class: "note", role: "status", "This page is running {running.label()}." }
            }
        }
    }
}

/// THE RELOAD, AND WHAT IT TAKES WITH IT (R10-4). It was a `btn-secondary` peer
/// of `Open Chat` while the header read `main is working…`, and one press killed
/// a run in flight and every file with it. With something to lose it is `danger`
/// and it ARMS — the two-press shape Settings' reset has, with the consequence
/// stated before the press. With nothing to lose it stays a secondary: red spent
/// on a harmless press stops meaning anything.
///
/// THE COST IS ABOVE THE BUTTONS AND IT IS COUNTED (R11-7). It used to sit
/// under both of them, so the reader met `Yes — reload and lose that` before
/// anything on the card had said what *that* was — a pronoun whose antecedent
/// was below it — and the sentence would not name the three files and the one
/// process the page was holding at that moment. The warning comes first, and
/// the button says the loss in its own words.
fn reload_control(mut armed: Signal<bool>, loses: Option<crate::enginecost::Cost>) -> Element {
    let Some(cost) = loses else {
        return rsx! { Button { variant: "secondary", onclick: move |_| reload(), "Reload the page" } };
    };
    let (said, verb) = (cost.said, cost.verb);
    rsx! {
        if armed() {
            p { class: "error", role: "status", "⚠ {said}" }
        }
        Button {
            variant: "danger",
            onclick: move |_| {
                let ready = armed.peek().to_owned();
                armed.set(!ready);
                if ready {
                    reload();
                }
            },
            if armed() { "Yes — reload and {verb}" } else { "Reload the page" }
        }
        if armed() {
            Button { variant: "ghost", onclick: move |_| armed.set(false), "Cancel" }
        }
    }
}
