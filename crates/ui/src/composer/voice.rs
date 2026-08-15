//! Voice in, voice out — and the ONE place in this codebase that touches a
//! browser speech API. It is a child of `composer.rs` because that is the only
//! screen it appears on, and because a module nobody else can reach cannot
//! spread (INVARIANTS.md, I5's written exception).
//!
//! Nothing here goes through the seam. Dictation puts text in the draft the
//! composer already owns and stops; speaking reads a reply the core already
//! rendered. No event kind, no tool, no `Request`: `handle(Request) -> Response`
//! is untouched (I4), and the pure core still tests on the host (I3).
//!
//! ABSENT, NOT BROKEN (I15). Firefox ships no `SpeechRecognition` at all, so
//! the constructor is tried once at mount and the control is simply not drawn
//! when it fails. Nothing here assumes a microphone, a network, or a voice.
//!
//! DICTATION IS THE ONE THING ON THIS PAGE THAT IS NOT LOCAL. In Chrome the
//! audio goes to Google's speech service and comes back as text — this is not
//! on-device computation, whatever the rest of the product's pitch says. The
//! note below the buttons says so in the same breath as the button, because a
//! product whose whole claim is "it runs in your browser" cannot put that
//! sentence in a fold. See INVARIANTS.md I2 and I5.

use std::rc::Rc;

use dioxus::prelude::*;

use crate::ui::Button;

mod mic;
mod speaker;

pub(crate) use speaker::hush;

/// The newest thing the AGENT said in this pane, as text. Read off the DOM the
/// core already rendered rather than re-derived: `.msg.assistant .said` is the
/// class the projection writes and the stylesheet keys off, the same one bit
/// `ui::has_rows` reads. Per agent, because the thread list can hold two
/// conversations at once (THREADS.md §7).
fn last_reply(agent: &str) -> String {
    let Some(doc) = web_sys::window().and_then(|w| w.document()) else {
        return String::new();
    };
    let Ok(rows) = doc.query_selector_all(&format!("#chat-scroll-{agent} .msg.assistant .said"))
    else {
        return String::new();
    };
    match rows.length() {
        0 => String::new(),
        n => rows
            .item(n - 1)
            .and_then(|row| row.text_content())
            .unwrap_or_default(),
    }
}

/// The two voice controls and the sentence that tells the truth about them.
#[component]
pub(crate) fn Voice(agent: String, busy: bool, on_text: EventHandler<String>) -> Element {
    let mut heard = use_signal(String::new);
    let mut listening = use_signal(|| false);
    let mut speaking = use_signal(|| false);
    let mut trouble = use_signal(String::new);
    let ear = use_hook(move || mic::build(heard, listening, on_text).map(Rc::new));
    let has_ear = ear.is_some();
    // NOT "does the object exist" — "is there a voice to speak with", which the
    // browser may only know a moment later (speaker.rs, I15). The watcher is
    // held for the life of the pane so its handler outlives no scope.
    let voiced = use_signal(|| false);
    let _voices = use_hook(move || speaker::watch(voiced).map(Rc::new));
    let has_voice = voiced();
    // …and nothing goes on reading an answer whose pane has left the screen.
    use_drop(hush);

    // A NEW TURN SILENCES THE OLD ANSWER. `busy` is a plain prop, so it is
    // mirrored into a signal an effect can watch; the mirror settles on the
    // next render because the second comparison is equal.
    let mut running = use_signal(|| busy);
    if *running.peek() != busy {
        running.set(busy);
    }
    use_effect(move || {
        if running() {
            hush();
            speaking.set(false);
        }
        // …AND IT CLEARS THE COMPLAINT WITH IT (24-walk F4). "There is no answer
        // in this conversation yet" sat under the button across four view
        // changes after it stopped being true, and it lives in a `role="status"`
        // — a line a screen reader may announce again on the way past.
        trouble.set(String::new());
    });

    let listen = move |_| {
        let Some(mic) = ear.as_ref() else { return };
        heard.set(String::new());
        match listening() {
            true => {
                mic.rec.stop();
                listening.set(false);
            }
            // `start()` throws if it is already running, which the flag above
            // is what prevents; a refused microphone leaves the button alone.
            false => listening.set(mic.rec.start().is_ok()),
        }
    };
    let read = move |_| {
        let text = last_reply(&agent);
        if text.trim().is_empty() {
            trouble.set("There is no answer in this conversation yet.".to_string());
            return;
        }
        trouble.set(String::new());
        hush(); // one answer at a time, even when the button is pressed twice
        speaking.set(speaker::speak(&text, speaking));
    };

    rsx! {
        if has_ear || has_voice {
            div { class: "row hint",
                if has_ear {
                    Button { variant: "ghost", onclick: listen, aria_pressed: "{listening}",
                        if listening() { "Stop dictating" } else { "Dictate" }
                    }
                }
                if has_voice {
                    Button { variant: "ghost", onclick: read, "Read the answer aloud" }
                    if speaking() {
                        Button {
                            variant: "ghost",
                            onclick: move |_| { hush(); speaking.set(false); },
                            "Stop reading"
                        }
                    }
                }
            }
            if !heard.read().is_empty() {
                p { class: "hint", role: "status", "Hearing: {heard}" }
            }
            if !trouble.read().is_empty() {
                p { class: "hint", role: "status", "{trouble}" }
            }
            {plainly(has_ear, has_voice)}
        }
    }
}

/// THE SENTENCE, BESIDE THE BUTTON (increment 19). Not in a disclosure, not in
/// Settings: this page tells people their agents run in their browser, and one
/// of these two controls sends their voice to a company. It is a fn so the
/// component stays under the 40-line rule and so the wording has one home.
fn plainly(has_ear: bool, has_voice: bool) -> Element {
    rsx! {
        if has_ear {
            p { class: "note",
                strong { "Dictation is not local." }
                " Press Dictate and this page hands your microphone audio to your \
                 browser's own speech service — in Chrome, that is Google's servers — \
                 which sends words back. It is the only part of HARNESS that leaves \
                 this browser apart from the model endpoint you set up yourself. Some \
                 browsers can now do this on the device instead; this page cannot tell \
                 which yours does, so assume it leaves. Nothing is sent until you press \
                 the button, and nothing is sent to us."
            }
        }
        if has_voice {
            p { class: "note",
                "Reading aloud uses the voices your browser provides. Some of those \
                 speak on your device and some are fetched from the browser's own \
                 service; this page cannot tell them apart, so assume the same."
            }
        }
    }
}
