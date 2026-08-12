//! The FRAME's live parts: the workspace's readiness, the page's pulse, and
//! the token meter. Split from `dash.rs`, which owns the shell's furniture and
//! its boot plumbing, so both hold the 200-line rule (I12).
//!
//! What these three have in common is that they belong to the PAGE and not to
//! any view: they are on screen whichever surface is open, and two of them are
//! the reason a run you launched and walked away from is still observed.

use std::rc::Rc;

use adapters_web::{sleep, Warmth, WebApp};
use dioxus::prelude::*;
use kernel::Request;

/// How often the pill re-reads the workspace's boot state. Nothing pushes: the
/// state is a value on a JS module global, so this polls it — half a second is
/// invisible to a person and free next to a disk streaming over a socket.
const WARM_MS: i32 = 500;

/// The workspace's readiness, in the header, from the moment the page paints.
///
/// This is the visible half of the background boot: the VM starts fetching
/// before anybody asks for it, and this says how far it got. It never blocks
/// and it never gates anything — a page whose workspace failed is a page you
/// can still chat in, which is why the failure is a status line and not an
/// error region.
#[component]
pub fn WorkspaceWarmth() -> Element {
    let mut state = use_signal(adapters_web::warmth);
    use_future(move || async move {
        adapters_web::prewarm();
        loop {
            let now = adapters_web::warmth();
            if *state.peek() != now {
                let done = now == Warmth::Ready;
                state.set(now);
                if done {
                    return;
                }
            }
            if sleep(WARM_MS).await.is_err() {
                return;
            }
        }
    });
    let (word, class) = match &*state.read() {
        Warmth::Idle => ("workspace idle".to_string(), "warmth idle"),
        Warmth::Booting => ("workspace starting…".to_string(), "warmth booting"),
        Warmth::Ready => ("workspace ready".to_string(), "warmth ready"),
        Warmth::Failed(why) => (format!("workspace unavailable: {why}"), "warmth failed"),
    };
    rsx! { p { class: "{class}", role: "status", "{word}" } }
}

/// How often the page checks on itself. Two seconds: slower than a turn's own
/// poll and fast enough that a status is never a minute stale.
const HEARTBEAT_MS: i32 = 2000;

/// The page's own pulse, independent of which view is open.
///
/// Every Worker fact — an agent's status, what it wrote, what its window holds
/// — reaches the log through `WebApp::handle`, which drains the Workers'
/// queues on ANY seam call. So "is anything observing the fleet" was really
/// "does the current view happen to mount a panel that polls": the board is on
/// three views of seven and inside the rail, which folds by default below
/// 1100px. Launch a task (15L), switch to Workspace, and nothing on the page
/// called the seam again — the run continued in its Worker and the page went
/// quiet about it, which is precisely the thing a launcher must not do.
///
/// One call, from the shell, forever. It is a GET, so it no longer grows the
/// log (15M), and bumping `tick` is what every panel already redraws from.
#[component]
pub fn Heartbeat(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// The frame's meter. It used to move only on the chat pane's poll, so a
    /// task launched from the Dashboard spent tokens the number never showed.
    tokens: Signal<u64>,
) -> Element {
    use_future(move || async move {
        loop {
            if sleep(HEARTBEAT_MS).await.is_err() {
                return;
            }
            let Some(app) = web.peek().clone() else { continue };
            // The board is the fleet's own projection, and asking for it is
            // what drains the Workers' reports into the log.
            let res = app.handle(Request::get("/board"));
            if let Some(spent) = res
                .headers
                .iter()
                .find(|(k, _)| k == "x-tokens")
                .and_then(|(_, v)| v.parse::<u64>().ok())
            {
                let mut tokens = tokens;
                if *tokens.peek() != spent {
                    tokens.set(spent);
                }
            }
            let mut tick = tick;
            let n = tick.peek().to_owned();
            tick.set(n + 1);
        }
    });
    rsx! {}
}

/// What this page has spent, in the frame, from the log (I8).
///
/// It is the one thing present in the permanent chrome of every console with a
/// real agent behind it, and VIEWS.md §6 called its absence "the tell for a
/// console built by someone who does not run agents". It shows tokens and not
/// money: a price per model is a table this build does not have, and a made-up
/// dollar figure is worse than none. Nothing at all until the first turn
/// reports usage — an endpoint that reports none must not read as free.
#[component]
pub fn TokenMeter(tokens: ReadSignal<u64>) -> Element {
    let spent = tokens();
    let text = match spent {
        0 => return rsx! {},
        n if n < 10_000 => format!("{n} tokens"),
        n => format!("{:.1}k tokens", n as f64 / 1000.0),
    };
    rsx! {
        p {
            class: "meter",
            role: "status",
            title: "Every token this page has spent, summed from the event log. \
                    Turns whose provider reported no usage are not counted.",
            "{text}"
        }
    }
}

