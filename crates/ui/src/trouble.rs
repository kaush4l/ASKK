//! WHAT THE FLEET IS DOING, in the chrome: the last turn that failed (R2-4),
//! and whether anything is running at all (R3-22).
//!
//! Both are read off the same `/board` poll the header already makes
//! (`frame::Heartbeat`), and both belong to the PAGE rather than to a view:
//! they are the two facts a person who walked away comes back to check, and
//! neither was legible from six of the seven views.
//!
//! The failure pill was a modifier on the endpoint pill once. Three things were
//! wrong with that and only the third is about hue:
//!
//! - it read as a fact about the SELECTED agent. It said `⚠ Last turn failed`
//!   two inches from `Agent: author` while `author` had taken zero turns; the
//!   agent that failed was `main`. `x-failed` is a fact about the fleet, and
//!   the fleet's failures have names;
//! - it only announced. The copy told you to check the endpoint in Settings and
//!   the pill was not a route to Settings;
//! - it never went away. It is derived from the board every two seconds, so it
//!   clears the moment that agent runs again — which is not the moment a person
//!   thinks they fixed it.
//!
//! Dismissal is keyed on the INSTANCE, not on the words. Keyed on the words, an
//! agent failing the same way twice said the same sentence, so one press
//! silenced every later instance of that failure for the life of the tab —
//! while the only other global signal, `● workspace ready`, is about the Linux
//! and stayed green through every refused turn (R3-3).

use dioxus::prelude::*;

use crate::ui::Button;
use crate::views::View;

/// What the board's own poll publishes to the chrome. One value, because these
/// four facts come from one response and are read by two pills; `Signal` is
/// `Copy`, so passing it around is free.
#[derive(Clone, Copy, PartialEq)]
pub struct Fleet {
    /// The one-line reason (`failure::reason`), off `x-failed`. Empty means
    /// nothing on the board is failing, and then there is no pill at all.
    pub why: Signal<String>,
    /// The agent whose row is `Failed`, off `x-failed-agent`.
    pub who: Signal<String>,
    /// WHICH failure, off `x-failed-turn` — the agent's turn count, which
    /// rises on every failure including a repeat of an identical one and is
    /// the same number after a reload (R8-4). A dismissal is keyed on it.
    pub stamp: Signal<String>,
    /// Who is working right now, off `x-busy` (a comma-separated list of
    /// names). Empty means nothing is running.
    pub running: Signal<String>,
}

impl Fleet {
    /// The four signals, in one hook call. Named from the shell.
    pub fn new() -> Self {
        Self {
            why: use_signal(String::new),
            who: use_signal(String::new),
            stamp: use_signal(String::new),
            running: use_signal(String::new),
        }
    }
}

/// AN AGENT IS WORKING — where every view can see it (R3-22).
///
/// The sentence existed only under the board, which lives in the rail: the rail
/// folds by default below 1100px and is absent from three views entirely, so
/// opening the Workspace while a run was going showed nothing at all. This is
/// the same fact off the same poll, in the chrome, which is on every screen.
#[component]
pub fn RunPill(fleet: Fleet) -> Element {
    let names = (fleet.running)();
    if names.is_empty() {
        return rsx! {};
    }
    // The NAMES, while they fit in a pill: "an agent is working" is the thing
    // the board said, and the board is right beside a list of agents. Up here
    // the pill is the only mention, so it says which.
    let line = match names.split(", ").count() {
        1 => format!("{names} is working…"),
        n => format!("{n} agents are working…"),
    };
    rsx! { p { class: "pill running", role: "status", "{line}" } }
}

/// WHICH FAILURE HAS BEEN ANSWERED, in this browser (R8-4). A dismissal used to
/// be a signal in this component, so correcting the endpoint, saving, and
/// pressing Dismiss brought the same sentence back on the next reload — about
/// an address Settings was visibly no longer using. It is one short string in
/// the same place the skin's bit lives (`skin.rs`): a preference about this
/// device, never app data (I2), and never the log.
const HUSH: &str = "askk.hushed-failure";

fn storage() -> Option<web_sys::Storage> {
    web_sys::window()?.local_storage().ok().flatten()
}

/// The failure this browser has already been answered about, or empty.
fn hushed() -> String {
    storage()
        .and_then(|s| s.get_item(HUSH).ok().flatten())
        .unwrap_or_default()
}

fn hush(news: &str) {
    if let Some(s) = storage() {
        let _ = s.set_item(HUSH, news);
    }
}

/// SAVING AN ENDPOINT ANSWERS THE FAILURE ABOUT THE OLD ONE (R8-4).
///
/// The board keeps an agent in `Failed` until it runs again, which is right —
/// nothing on this page calls the endpoint on its own, and Settings says so in
/// as many words. What was wrong was the header repeating `the endpoint was
/// unreachable` after the address had been corrected, with no such caveat and
/// no way to make it stop. A save is a person answering it, so the save hushes
/// the instance standing at the time. A LATER failure has a later `since` and
/// raises the banner again — including one against the new address, which is
/// the fact a person who just typed it most needs.
pub(crate) fn hush_current(app: &adapters_web::WebApp) {
    let res = app.handle(kernel::Request::get("/board"));
    let header = |name: &str| {
        res.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let why = header("x-failed");
    if !why.is_empty() {
        hush(&format!(
            "{}|{}|{why}",
            header("x-failed-turn"),
            header("x-failed-agent")
        ));
    }
}

#[component]
pub fn TroublePill(fleet: Fleet, view: Signal<View>, tick: Signal<u32>) -> Element {
    // WHY THIS READS THE PAGE'S TICK (R8-4). The dismissal is in this browser's
    // storage, not in a signal, so it survives a reload — and storage is not
    // reactive. `tick` is: the heartbeat bumps it, and so does a save in
    // Settings, which is the other thing that silences a banner. Reading it
    // here is what makes this component re-render and re-read the dismissal.
    let _ = tick();
    let (who, why, stamp) = ((fleet.who)(), (fleet.why)(), (fleet.stamp)());
    // THIS failure, not this kind of failure: the timestamp is what tells two
    // identical sentences apart, and without it a second one stayed silenced.
    let news = format!("{stamp}|{who}|{why}");
    if why.is_empty() || hushed() == news {
        return rsx! {};
    }
    let line = match who.is_empty() {
        true => format!("⚠ The last turn failed: {why}"),
        false => format!("⚠ {who}'s last turn failed: {why}"),
    };
    let dismissed = news.clone();
    rsx! {
        // ITS OWN ROW, UNDER THE HEADER (R8-2). It was a pill inside the
        // header's strip, which meant the strip had to evict pills to fit it —
        // and the two it evicted were the spend and the model line, so being
        // told the endpoint was unreachable removed the only place the page
        // said WHICH endpoint. An error may add a row; it may not subtract a
        // fact. `banner`, not `pill`: it is as wide as the page and it wraps.
        div { class: "banner problem", role: "status",
            span { class: "problem-line", "{line}" }
            Button {
                variant: "ghost",
                onclick: move |_| {
                    let (mut view, mut tick) = (view, tick);
                    hush(&news);
                    let n = *tick.peek();
                    tick.set(n + 1);
                    view.set(View::Settings);
                },
                "Open Settings"
            }
            Button {
                variant: "ghost",
                // The label is a word, not a glyph: `✕` alone is the control
                // this product's own design page keeps refusing. And it hides
                // THIS failure — the next one raises the banner again, in this
                // tab and in the next one, because the press is stored.
                onclick: move |_| {
                    let mut tick = tick;
                    hush(&dismissed);
                    let n = *tick.peek();
                    tick.set(n + 1);
                },
                "Dismiss"
            }
        }
    }
}
