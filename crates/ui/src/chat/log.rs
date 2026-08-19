//! THE CONVERSATION ON SCREEN: the card, the scrolling log inside it, and the
//! two rows a failed or in-flight turn puts underneath. The pane beside this
//! owns the fetching and the sending; this owns the arrangement.

use dioxus::prelude::*;

use super::{header, say, Pane};
use crate::composer::Composer;
use crate::chat::retry_actions::{fix_in_file, last_failed, nothing_said, Recovery};
use crate::ui::{Card, Skeleton};
use crate::shell::views::View;
use crate::chat::inflight_row::waiting_row;

/// WHAT THE CARD IS SHOWING RIGHT NOW, from the one read the body comes from.
struct State {
    /// The projection, and only while it is this agent's.
    mine: bool,
    /// In flight FOR THIS AGENT. Another agent's turn runs in another Worker
    /// and must not lock this composer: a global lock made the page contradict
    /// the board three inches below it (`ux-walker`, increment 07).
    busy: bool,
    /// Nothing has been SAID here yet. A conversation with no user message is
    /// the only genuinely empty one: a turn in flight, a stopped turn and an
    /// orphaned turn all have one above them. The core writes its own one-line
    /// sentence for this case; the EmptyState below says the same thing with
    /// the region's purpose and its one action attached, so the two never both
    /// appear.
    empty: bool,
}

/// The whole card: the thread's own summary row, the log, and everything a
/// turn's state puts under it.
pub(crate) fn conversation(pane: Pane, head: Element) -> Element {
    let shown = pane.turn.shown.read().clone();
    let who = (pane.agent)();
    let state = State {
        mine: shown.who == who,
        busy: shown.who == who && shown.pending,
        empty: !crate::ui::has_rows(&shown.html, "msg user"),
    };
    let note = pane.turn.note;
    rsx! {
        Card {
            // PER AGENT, ALL THREE IDS (THREADS.md §7). `data-chat` is what
            // the stylesheet keys off, since an id that moves cannot be one.
            id: "chat-panel-{who}",
            "data-chat": "{who}",
            // A REGION NAMED BY ITS OWN THREAD ROW, not a tabpanel: the strip
            // that made this the panel-half of the ARIA tabs pattern has left
            // the Chat view (R15-IA), and the summary above it is the control
            // that opens it.
            role: "region",
            aria_labelledby: "thread-{who}",
            // No longer drawn as an `<h2>`: the thread summary above says the
            // same name and more (THREADS.md §5).
            aria_label: "{header::title(&who)}",
            {head}
            EndpointMissingNote { ready: (pane.endpoint_set)(), who: who.clone() }
            {rolling_log(pane, &shown.html, &state)}
            {waiting_row(pane.web, pane.turn, state.busy, who.clone(), shown.stoppable, shown.ceiling.clone())}
            {after_failure(pane, &shown.html, &state, &shown.last_said)}
            if !note.read().is_empty() { p { class: "error", "{note}" } }
            {header::clear_row(pane.web, pane.turn, who.clone(), state.busy, state.empty, pane.arm_clear)}
            Composer {
                busy: state.busy,
                ready: (pane.endpoint_set)(),
                agent: who,
                on_send: move |text: String| say(pane, text),
            }
        }
    }
}

/// The conversation itself. The id is the scroll target: it grows inside a
/// full-height column, so the newest message is below its own fold unless
/// something moves it. Present in all three states.
fn rolling_log(pane: Pane, html: &str, state: &State) -> Element {
    let (who, view) = ((pane.agent)(), pane.view);
    rsx! {
        div { id: "chat-scroll-{who}", class: "chat-log",
            if !state.mine {
                // Was a bare "opening {agent}'s conversation…", which is a
                // sentence in an otherwise empty box — the same shape a
                // broken pane has. A skeleton is the shape of what is coming.
                Skeleton { lines: 3, label: "Opening {who}'s conversation" }
            } else if !state.empty {
                // A FILE THE AGENT NAMES IS A FILE YOU CAN OPEN (R9-4).
                // `main: The file primes.txt has 15 lines.` — and checking
                // that meant typing `cat` into the Workspace's command box,
                // which is the direct reason nobody noticed the file held
                // one line of the model's own malformed JSON. The core
                // marks the names the workspace actually HAS
                // (`markdown::inline`); this opens the one that was pressed
                // and goes to the pane that shows it.
                div {
                    onclick: move |e: Event<MouseData>| {
                        let Some(path) = crate::files::listing::clicked_path(&e) else { return };
                        crate::files::listing::open_path(pane.web, &(pane.agent)(), &path, false);
                        let mut view = view;
                        view.set(View::Workspace);
                    },
                    dangerous_inner_html: "{html}",
                }
            } else {
                {nothing_said(&who, (pane.endpoint_set)(), view)}
            }
        }
    }
}

/// Under the failure, not under the composer: the two actions the failure's own
/// words ask for (F11).
fn after_failure(pane: Pane, html: &str, state: &State, last_said: &str) -> Element {
    if !(state.mine && !state.busy && last_failed(html)) {
        return rsx! {};
    }
    rsx! {
        Recovery {
            view: pane.view,
            // …and the door goes where the fix is: a model id the endpoint
            // does not serve is changed in the agent's file, never in
            // Settings (R18-P1-7).
            file: fix_in_file(html).then(|| (pane.agent)()),
            // Whichever way it failed, the same way out (R3-5).
            last: match last_said.is_empty() {
                true => (pane.last_sent)(),
                false => last_said.to_string(),
            },
            // The same one path a typed message takes, not a second one.
            on_retry: move |text: String| say(pane, text),
        }
    }
}

/// No endpoint, said in the conversation it is stopping.
#[component]
fn EndpointMissingNote(ready: bool, who: String) -> Element {
    if ready {
        return rsx! {};
    }
    rsx! {
        p { class: "pending",
            "No model endpoint yet. Add one in Settings below — a local \
             OpenAI-compatible server, or a provider's base URL and API key — \
             and {who} can answer."
        }
    }
}
