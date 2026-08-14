//! `ChatPane` — one agent's conversation (plan, "UI shape"; Python counterpart
//! `Engine.messages`). It owns the draft you are typing and nothing else: every
//! message on screen is the core's own projection of the event log (I8).
//!
//! The heading and the transcript are two halves of ONE read (`turn::Shown`),
//! so nothing this pane can be handed shows one agent's conversation under
//! another agent's name. One instance per agent, and since THREADS.md the
//! document can hold two: every id it plants carries the agent's name.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::composer::Composer;
use crate::recover::{fix_in_file, last_failed, nothing_said, Recovery};
use crate::turn::{show, to, Shown, Turn};
use crate::watch::follow;
use crate::views::View;
use crate::wait::waiting_row;
use crate::ui::{Card, Skeleton};

#[component]
pub fn ChatPane(
    web: Signal<Option<Rc<WebApp>>>,
    endpoint_set: Signal<bool>,
    tick: Signal<u32>,
    /// The page's token meter — written here because this pane's poll is the
    /// projection that carries it, read by the header (`main::shell`).
    tokens: Signal<u64>,
    /// The roster's fingerprint (`main::shell`). Read by the effect below, so
    /// an agent swapped under this pane re-projects the conversation. It moves
    /// only when an agent's identity does, so it cannot loop against `tick`.
    roster: ReadSignal<String>,
    /// WHICH agent this pane is the conversation with. A `ReadSignal` so
    /// switching agents re-projects: the same component, one instance per
    /// agent, never a mode flag (plan: `ChatPane` owns one conversation).
    agent: ReadSignal<String>,
    /// Where "Open Settings" goes when a turn fails (F11). The same signal the
    /// nav sets: the failure copy says to check the endpoint in Settings, and
    /// nothing on the failed screen took you there.
    view: Signal<View>,
    /// The thread's own summary row (`thread::summary`), rendered where the
    /// `<h2>` used to be. It says the agent's name and what that agent is
    /// doing, off the board — so the heading `Chat · main` would be a second,
    /// thinner copy of the first three words of it, and it goes.
    head: Element,
) -> Element {
    let turn = Turn {
        shown: use_signal(Shown::default),
        note: use_signal(String::new),
        elapsed: use_signal(|| 0),
        stopped: use_signal(|| false),
        halting: use_signal(|| false),
        tick,
        tokens,
    };
    let mut note = turn.note;
    // The region's accessible name, from the PROP and not from the last
    // response: it must name the agent you just switched to before that
    // agent's transcript has arrived. `· {name}` is the one pattern five cards
    // use for "this card is about that agent" (R6-12); it is no longer drawn
    // as an `<h2>`, because the thread summary above it says the same name and
    // more (THREADS.md §5).
    let title = match agent().is_empty() {
        true => "Chat · no agent loaded".to_string(),
        false => format!("Chat · {}", agent()),
    };
    // The ONE read the body comes from — and only while it is this agent's.
    let shown = turn.shown.read().clone();
    let mine = shown.who == agent();
    // In flight FOR THIS AGENT. Another agent's turn runs in another Worker and
    // must not lock this composer: a global lock made the page contradict the
    // board three inches below it (`ux-walker`, increment 07).
    let busy = mine && shown.pending;
    // Nothing has been SAID here yet. A conversation with no user message is
    // the only genuinely empty one: a turn in flight, a stopped turn and an
    // orphaned turn all have one above them. The core writes its own one-line
    // sentence for this case; the EmptyState below says the same thing with
    // the region's purpose and its one action attached, so the two never both
    // appear.
    let empty = !crate::ui::has_rows(&shown.html, "msg user");

    let watching = use_signal(|| false); // one poller per pane (`watch::follow`)

    // First paint, AND every arrival back at this view (R3-1). The pane stays
    // MOUNTED on every route (`stage`), so it fetched once, at boot, on an empty
    // conversation — and a Dashboard launch runs in that agent's Worker with
    // nothing here watching: "Read the reply" landed on "No messages yet".
    use_effect(move || {
        let (who, _, _) = (agent(), roster(), view());
        if let Some(app) = web.read().clone() {
            note.set(String::new());
            show(&who, app.handle(to(&who, Request::get("/chat"))), turn);
            if turn.shown.peek().pending {
                follow(web, turn, agent, who, watching);
            }
        }
    });

    // What the last turn was carrying, so a failed one can be sent again
    // without retyping it (F11). The projection's own `x-last-said` is the
    // truth — it survives a reload and a launch from another surface — and
    // this only covers the instant between the press and the next projection.
    let mut last_sent = use_signal(String::new);

    let send = move |text: String| {
        let Some(app) = web.peek().clone() else { return };
        let who = agent.peek().clone();
        last_sent.set(text.clone());
        note.set(String::new());
        let req = to(&who, Request::post_form("/chat", &[("message", &text)]));
        show(&who, app.handle(req), turn);
        follow(web, turn, agent, who, watching);
    };

    rsx! {
        Card {
            // PER AGENT, ALL THREE IDS (THREADS.md §7). `data-chat` is what
            // the stylesheet keys off, since an id that moves cannot be one.
            id: "chat-panel-{agent}",
            "data-chat": "{agent}",
            // A REGION NAMED BY ITS OWN THREAD ROW, not a tabpanel: the strip
            // that made this the panel-half of the ARIA tabs pattern has left
            // the Chat view (R15-IA), and the summary above it is the control
            // that opens it.
            role: "region",
            aria_labelledby: "thread-{agent}",
            aria_label: "{title}",
            {head}
            if !endpoint_set() {
                p { class: "pending",
                    "No model endpoint yet. Add one in Settings below — a local \
                     OpenAI-compatible server, or a provider's base URL and API key — \
                     and {agent} can answer."
                }
            }
            // The id is the scroll target: the conversation grows inside a
            // full-height column, so the newest message is below its own fold
            // unless something moves it. Present in all three states.
            div { id: "chat-scroll-{agent}", class: "chat-log",
                if !mine {
                    // Was a bare "opening {agent}'s conversation…", which is a
                    // sentence in an otherwise empty box — the same shape a
                    // broken pane has. A skeleton is the shape of what is
                    // coming.
                    Skeleton { lines: 3, label: "Opening {agent}'s conversation" }
                } else if !empty {
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
                            let Some(path) = crate::listing::clicked_path(&e) else { return };
                            crate::listing::open_path(web, &agent(), &path, false);
                            let mut view = view;
                            view.set(View::Workspace);
                        },
                        dangerous_inner_html: "{shown.html}",
                    }
                } else {
                    {nothing_said(&agent(), endpoint_set(), view)}
                }
            }
            {waiting_row(web, turn, busy, agent(), shown.stoppable, shown.ceiling.clone())}
            // Under the failure, not under the composer: the two actions the
            // failure's own words ask for (F11).
            if mine && !busy && last_failed(&shown.html) {
                Recovery {
                    view,
                    // …and the door goes where the fix is: a model id the
                    // endpoint does not serve is changed in the agent's file,
                    // never in Settings (R18-P1-7).
                    file: fix_in_file(&shown.html).then(|| agent()),
                    // Whichever way it failed, the same way out (R3-5).
                    last: match shown.last_said.is_empty() {
                        true => last_sent(),
                        false => shown.last_said.clone(),
                    },
                    // `send` is Copy (every capture is a signal); this is the
                    // same one path a typed message takes, not a second one.
                    on_retry: move |text: String| { let mut again = send; again(text) },
                }
            }
            if !note.read().is_empty() { p { class: "error", "{note}" } }
            Composer {
                busy,
                ready: endpoint_set(),
                agent: agent(),
                on_send: send,
            }
        }
    }
}
