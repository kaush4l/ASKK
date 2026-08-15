//! The dictation machine, and nothing else. Split from `voice.rs` for the
//! 200-line rule (I12); it is the half that talks to `SpeechRecognition`, so
//! the half above it reads as a component and this one reads as a wiring
//! diagram.

use dioxus::prelude::*;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys::{SpeechRecognition, SpeechRecognitionEvent};

/// Built ONCE per composer and started and stopped many times, so its two
/// handlers live exactly as long as the component does: a recogniser built per
/// press would have to drop its own `onend` closure from inside that closure,
/// which is how a JS callback gets destroyed mid-call.
pub(super) struct Mic {
    pub(super) rec: SpeechRecognition,
    _result: Closure<dyn FnMut(SpeechRecognitionEvent)>,
    _end: Closure<dyn FnMut()>,
}

/// UNHOOK BEFORE YOU LET GO. Switching agents unmounts this composer and drops
/// the `Mic`, closures and all — and a dictation still running would then fire a
/// handler whose Rust side no longer exists, into signals the scope no longer
/// owns. Clearing the two handlers first means the worst case is a session that
/// ends silently, which is what unmounting should look like.
impl Drop for Mic {
    fn drop(&mut self) {
        self.rec.set_onresult(None);
        self.rec.set_onend(None);
        self.rec.abort();
    }
}

/// `None` means this browser has no speech recognition — the constructor is
/// the whole feature test, and building one asks for no permission and opens
/// no microphone (I15: advertise less, do not fail more). Chrome and Safari
/// expose it only as `webkitSpeechRecognition`; the one line in
/// `web/index.html` that aliases the two is why this can name it once.
pub(super) fn build(
    mut heard: Signal<String>,
    mut on: Signal<bool>,
    on_text: EventHandler<String>,
) -> Option<Mic> {
    let rec = SpeechRecognition::new().ok()?;
    // Interim results so the row shows words as they are said; continuous so a
    // pause in the middle of a sentence does not end the session.
    rec.set_interim_results(true);
    let _ = rec.set_continuous(true);
    let result =
        Closure::<dyn FnMut(SpeechRecognitionEvent)>::new(move |e: SpeechRecognitionEvent| {
            let Some(list) = e.results() else { return };
            let (mut settled, mut hearing) = (String::new(), String::new());
            // From `result_index`, not from zero: the list is cumulative and
            // re-reading it from the start appends every sentence twice.
            for i in e.result_index()..list.length() {
                let Some(r) = list.get(i) else { continue };
                let Some(alt) = r.get(0) else { continue };
                match r.is_final() {
                    true => settled.push_str(&alt.transcript()),
                    false => hearing.push_str(&alt.transcript()),
                }
            }
            heard.set(hearing);
            // NOTHING IS SENT. A finished phrase lands in the draft, where it
            // can be corrected; the person still presses Send.
            if !settled.trim().is_empty() {
                on_text.call(settled);
            }
        });
    rec.set_onresult(Some(result.as_ref().unchecked_ref()));
    // The browser ends a session on its own after enough silence, so the word
    // on the button has to follow it or it lies.
    let end = Closure::<dyn FnMut()>::new(move || {
        on.set(false);
        heard.set(String::new());
    });
    rec.set_onend(Some(end.as_ref().unchecked_ref()));
    Some(Mic {
        rec,
        _result: result,
        _end: end,
    })
}
