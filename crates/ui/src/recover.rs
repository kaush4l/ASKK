//! The way OUT of a failed turn (F11) — and, since R7-2, the way IN to an
//! empty one: both are the same job, an action attached to a state the
//! conversation cannot leave on its own.
//!
//! The failure card the core renders is a good one: it names the cause and it
//! tells you to check the endpoint in Settings. It just did not offer either of
//! the two things a person then wants — the same message sent again, and the
//! Settings the copy names — so the only route out of a dead endpoint was to
//! find the nav, open Settings, fix it, come back, and retype the question.
//!
//! Its own file so `chat.rs` holds the 200-line rule (I12). Nothing here talks
//! to the core: Retry re-sends through the pane's own `send`, and Open Settings
//! sets the same `View` signal the nav sets — navigation, not a new route.

use dioxus::core::spawn_forever;
use dioxus::prelude::*;

use crate::ui::{focus, Button, EmptyState};
use crate::views::View;

/// Whether the NEWEST message in the transcript is a failure.
///
/// Not "does the transcript contain one": an error five turns back, answered
/// since, is history and offering to retry it would be wrong. The projection is
/// in log order, so the last `class="msg …"` in it is the newest message —
/// the same one-bit read of a class the core already writes that `has_rows`
/// makes everywhere else in this crate.
pub(crate) fn last_failed(html: &str) -> bool {
    match html.rfind("class=\"msg ") {
        // A PREFIX match: a recurrence of a failure already explained in full is
        // `msg error repeat` (R2-5), and it is still the failure you want out of.
        Some(at) => html[at..].starts_with("class=\"msg error"),
        None => false,
    }
}

/// …AND WHETHER THE FIX IS IN THE AGENT'S FILE RATHER THAN IN SETTINGS
/// (R18-P1-7). A model id the endpoint does not serve answered `Open Settings`,
/// where nothing about it can be changed. `core::failure::card` writes the class
/// off the typed variant; this is the same one-bit read of it `last_failed`
/// makes, over the same newest message.
pub(crate) fn fix_in_file(html: &str) -> bool {
    match html.rfind("class=\"msg ") {
        Some(at) => html[at..].starts_with("class=\"msg error fix-file"),
        None => false,
    }
}

/// The two actions, under the failure that needs them.
#[component]
pub(crate) fn Recovery(
    view: Signal<View>,
    /// The last thing the person said in this conversation — the core's own
    /// `x-last-said`, so it survives a reload and is there whichever way the
    /// turn failed. It used to be what this page remembered sending, and a
    /// page that had sent nothing offered no way out at all (R3-5).
    last: String,
    /// Whether the failure this is under is being read OUTSIDE the conversation
    /// — the Dashboard's launch card (R8-13). Its copy says "the conversation
    /// says why" and then offered a retry and Settings, naming a destination
    /// and giving no door to it. Absent in the transcript, where the pair is
    /// already inside the conversation it would be pointing at.
    chat: Option<bool>,
    /// The agent whose FILE holds the fix, when the failure's own remedy is a
    /// line in one (R18-P1-7). `None` keeps the Settings door, which is right
    /// for every other failure this card is shown under.
    file: Option<String>,
    on_retry: EventHandler<String>,
) -> Element {
    let in_file = file.clone();
    // NAME IT WHAT IT WAS (29). This pair is rendered under a failed TASK as
    // well as under a failed message, and there it read `Send the message
    // again` over something started with `Start agent`, from a field labelled
    // "Describe the whole task", in a card titled "Run a task" — nothing had
    // called it a message until it failed. `chat` is already the one bit that
    // says which side of that line this is on.
    let again = match chat.unwrap_or(false) {
        true => "Start the task again",
        false => "Send the message again",
    };
    rsx! {
        div { class: "recovery", role: "group", aria_label: "Recover from the failed turn",
            if chat.unwrap_or(false) {
                Button {
                    variant: "secondary",
                    onclick: move |_| {
                        let mut view = view;
                        view.set(View::Chat);
                    },
                    "Read the conversation"
                }
            }
            if !last.is_empty() {
                // "Retry" promised to re-run the failed turn and could not: it
                // sends the message again, which appends a second `You: …` and
                // a second failure, and a first-timer read that as having
                // double-sent by accident (R3-4). Re-running in place would be
                // a new request across the seam, and this round is copy and
                // layout — so the control says what it actually does. The
                // failure it produces folds into the same "Same error (×n)"
                // every other repeat does.
                Button {
                    // …AND IN THE DESIGN SYSTEM (R7-10). It carried no class at
                    // all, so `controls.css`'s bare-`button` fill painted it
                    // `rgb(201,164,255)` on `rgb(26,15,43)` while every other
                    // primary in the product is `btn-primary` at
                    // `rgba(201,164,255,0.886)` on `rgb(39,28,57)` — near
                    // identical, measurably different, and the only drift a
                    // critic hunting for drift could find.
                    variant: "primary",
                    onclick: move |_| on_retry.call(last.clone()),
                    "{again}"
                }
            }
            match in_file {
                Some(who) => rsx! {
                    Button {
                        variant: "secondary",
                        onclick: move |_| {
                            let mut view = view;
                            view.set(View::Agents);
                        },
                        "Open {who}'s file"
                    }
                },
                None => rsx! {
                    Button {
                        variant: "secondary",
                        onclick: move |_| {
                            let mut view = view;
                            view.set(View::Settings);
                        },
                        "Open Settings"
                    }
                },
            }
        }
    }
}

/// A conversation nobody has spoken in. Its own fn so `ChatPane` stays one job
/// (I12).
///
/// THE ONE ACTION ALWAYS DOES SOMETHING (R7-2). It used to render DISABLED
/// with no endpoint configured — the first thing a new user clicks on an empty
/// agent, dead, with no explanation of why — and focusing the composer would
/// not have helped, because that field is disabled for the same reason. So the
/// button follows the state: with an endpoint it puts the cursor in the
/// composer, without one it goes where the endpoint is set. One control, two
/// honest jobs, and the label says which one it is doing.
pub(crate) fn nothing_said(who: &str, ready: bool, view: Signal<View>) -> Element {
    rsx! {
        EmptyState {
            title: "No messages yet",
            // ONE SENTENCE (R8-EMPTY).
            sentence: "This is your whole conversation with {who} — every question, every \
                       answer and every tool it calls — kept in this browser after a reload.",
            // …AND ONLY WHEN IT GOES SOMEWHERE ELSE (R15-P1-8). With an
            // endpoint set this read `Write the first message` and put the
            // cursor in a composer 300px below it, in the same card: a primary
            // action duplicating a control already on screen. Without one it
            // goes to Settings, which is off this view, so that half stays.
            if !ready {
            Button {
                variant: "secondary",
                onclick: move |_| {
                    let mut view = view;
                    view.set(View::Settings);
                    // Routing UNMOUNTS this pane, so the focus that follows
                    // belongs to no scope (see `space.rs`).
                    spawn_forever(async move {
                        let _ = adapters_web::sleep(30).await;
                        focus("endpoint-base");
                    });
                },
                "Set a model endpoint first"
            }
            }
        }
    }
}
