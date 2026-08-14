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

/// The SANDBOX's readiness, in the header, from the moment the page paints.
///
/// The visible half of the background boot: the VM starts fetching before
/// anybody asks, and this says how far it got. It never blocks and never gates
/// — a page whose sandbox failed is one you can still chat in, which is why
/// the failure is a status line and not an error region.
///
/// IT ANSWERS FOR THE SELECTED AGENT (R6-2), AND KEEPS THE LINUX'S OWN STATE.
///
/// R5-2 saw the defect — `● workspace ready` two inches from `Agent: author`,
/// an agent every other pane correctly said cannot run a command — and fixed
/// the WORDING, which does not scope a pill: `● Linux sandbox ready` under
/// `Agent: summarizer` is still a green dot in the chrome of a page whose
/// subject cannot run a command, and a first-timer concludes it can.
///
/// So the pill is one honest sentence about THIS agent, and the Linux's own
/// state is the second half of it when there is a workspace to have a state —
/// and the `title` when there is not, where it is a fact about the page rather
/// than a promise about the subject. The dot follows: grey for an agent with
/// no folder, never green.
#[component]
pub fn WorkspaceWarmth(
    /// The page's subject. The pill is in the header beside `Agent: {who}`,
    /// so it is read as a statement about that name whatever it says.
    who: ReadSignal<String>,
    /// The `/agents` projection — `roster::has_workspace` is the one read of
    /// "does this agent have a folder in the Linux", shared with the launcher
    /// and the shared-space card so the three cannot disagree.
    agents: Signal<String>,
) -> Element {
    let mut state = use_signal(adapters_web::warmth);
    use_future(move || async move {
        adapters_web::prewarm();
        // FOREVER, not until `Ready` (R11-1a). This used to stop the first time
        // it saw a booted workspace, which was defensible while `Ready` was the
        // last thing that could happen to one. It is not: a booted workspace
        // goes busy and comes back, all afternoon, and a poll that has returned
        // cannot say so. Half a second, and a `set` only on a change — an
        // unchanged value would redraw the chrome twice a second forever.
        loop {
            let now = adapters_web::warmth();
            if *state.peek() != now {
                state.set(now);
            }
            if sleep(WARM_MS).await.is_err() {
                return;
            }
        }
    });
    let (sandbox, class) = match &*state.read() {
        Warmth::Idle => ("idle".to_string(), "pill warmth idle"),
        // …AND WHAT IT IS DOING (increment 18). c2w's first load moves ~48 MB
        // and boots in three phases; one motionless `starting…` for a minute
        // and a half is true and tells nobody anything.
        Warmth::Booting(phase) => (phase.clone(), "pill warmth booting"),
        Warmth::Ready => ("ready".to_string(), "pill warmth ready"),
        Warmth::Busy => ("busy with a command".to_string(), "pill warmth busy"),
        // The abandoned command, in the pill (R12-1); the hint says the rest.
        Warmth::Occupied => (
            "occupied by the command you stopped waiting for".to_string(),
            "pill warmth busy",
        ),
        Warmth::Failed(why) => (format!("unavailable: {why}"), "pill warmth failed"),
    };
    // …AND WHAT HAPPENS NEXT (R12-1): no room in the pill, room in the hint.
    let tail = match &*state.read() {
        Warmth::Occupied => " It takes the next command when that one ends.",
        _ => "",
    };
    let subject = who();
    // TWO PARTS, SO IT CAN SHRINK INSTEAD OF DROPPING (R7-12). Below 48rem the
    // strip used to delete this pill whole, and on a phone nothing on the page
    // then said whether the Linux was ready — the one status that decides
    // whether the agent can do anything at all. The subject and the noun are
    // the `.pill-label`; the state word is not, so what is left at a phone
    // width is the dot and one word (`● ready`).
    let (lead, word, class, hint) = match crate::roster::has_workspace(&agents.read(), &subject) {
        // ONE SENTENCE, TWO NOUNS (R18-P1-2): whose FOLDER, and what the LINUX
        // holding it is doing — `ready` alone read as the agent being ready.
        true => (
            format!("{subject}'s folder · "),
            format!("Linux {sandbox}"),
            class,
            crate::statusbar::workspace_hint(&subject, &sandbox) + tail,
        ),
        // …and NO STATE AT ALL when there is nothing to have one. The Linux's
        // own readiness is still here, in the hint, where it is a fact about
        // the page and not a green light on this agent.
        false => (
            format!("{subject} has "),
            "no folder".to_string(),
            "pill warmth",
            crate::statusbar::no_workspace_hint(&subject, &sandbox) + tail,
        ),
    };
    rsx! {
        // NEVER A STATUS WORD WITHOUT ITS SUBJECT (R9-5). Dropping the whole
        // `.pill-label` below 48rem left a bare `● ready` in the chrome, which
        // reads as "the agent is ready" — a claim about the wrong thing, made
        // by the only status a phone still shows. The label shrinks to the
        // NAME rather than vanishing: `main: ready`, at every width where the
        // sentence will not fit.
        p { class: "{class}", role: "status", title: "{hint}",
            span { class: "pill-label", "{lead}" }
            span { class: "pill-short", "{subject}: " }
            "{word}"
        }
    }
}

/// How often the page checks on itself. Two seconds: slower than a turn's own
/// poll and fast enough that a status is never a minute stale.
const HEARTBEAT_MS: i32 = 2000;

/// The page's own pulse, independent of which view is open.
///
/// Every Worker fact reaches the log through `WebApp::handle`, which drains the
/// Workers' queues on ANY seam call — so "is anything observing the fleet" was
/// really "does the current view mount a panel that polls".
///
/// One call, from the shell, forever — a GET, so it does not grow the log
/// (15M), and bumping `tick` is what every panel already redraws from.
#[component]
pub fn Heartbeat(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    /// The frame's meter. It used to move only on the chat pane's poll, so a
    /// task launched from the Dashboard spent tokens the number never showed.
    tokens: Signal<u64>,
    /// What the board says about the fleet — what failed, whose it was, which
    /// instance it is, and who is working (`trouble::Fleet`). Two pills in the
    /// chrome read it, and this is the poll it comes off.
    fleet: crate::trouble::Fleet,
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
            let header = |name: &str| {
                res.headers
                    .iter()
                    .find(|(k, _)| k == name)
                    .map(|(_, v)| v.clone())
                    .unwrap_or_default()
            };
            // Four facts, one response. `set` only on a change: every one of
            // these is read by a pill, and rewriting an unchanged value would
            // redraw the chrome twice a second forever.
            for (mut signal, now) in [
                (fleet.why, header("x-failed")),
                (fleet.who, header("x-failed-agent")),
                (fleet.stamp, header("x-failed-turn")),
                (fleet.running, header("x-busy")),
            ] {
                if *signal.peek() != now {
                    signal.set(now);
                }
            }
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
