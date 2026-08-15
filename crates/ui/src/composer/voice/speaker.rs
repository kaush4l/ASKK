//! The reader — `speechSynthesis` and nothing else. Split from `voice.rs` for
//! the 200-line rule (I12), the same way `mic.rs` was: that file reads as a
//! component, this one as the machine underneath it.
//!
//! TWO WAYS THIS CONTROL CAN LIE, AND BOTH ARE CLOSED HERE (I15).
//!
//! 1. `speechSynthesis` exists on a machine with NO VOICE INSTALLED — a bare
//!    Linux with no speech-dispatcher, an Android WebView with the TTS engine
//!    removed. `speak()` there returns quietly and nothing is ever heard, so
//!    the object's presence is not the capability. `watch` counts the voices
//!    and follows `voiceschanged`, because Chrome fills that list *after* the
//!    page loads and answering "none" early would hide a control that works.
//!
//! 2. A LONG ANSWER STOPS PART-WAY. Chrome cuts a single utterance off after
//!    roughly fifteen seconds of speech, silently and mid-sentence — which is
//!    exactly "claimed it would speak and then did not", just delayed. `chunks`
//!    hands the browser a queue of short pieces instead of one long one.

use dioxus::prelude::*;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys::{SpeechSynthesis, SpeechSynthesisUtterance};

/// Characters per utterance. At an ordinary speaking rate this is about eight
/// seconds, comfortably inside Chrome's cut-off with room for a slow voice.
const CHUNK: usize = 180;

fn synth() -> Option<SpeechSynthesis> {
    web_sys::window().and_then(|w| w.speech_synthesis().ok())
}

/// Stop speaking, now — and drop anything still queued behind it. Called when a
/// new turn starts as well as by the button: a page reading the previous answer
/// over the top of a new one is the defect this control ships with unless
/// something cancels it, and the person who just pressed Send is not going to
/// enjoy racing it.
pub(crate) fn hush() {
    if let Some(voice) = synth() {
        voice.cancel();
    }
}

/// Kept for the life of the composer so the handler outlives no scope, exactly
/// as `Mic` is. Unhooked on the way out: a `voiceschanged` arriving after the
/// pane is gone would write a signal nobody owns.
pub(super) struct Voices {
    synth: SpeechSynthesis,
    _changed: Closure<dyn FnMut()>,
}

impl Drop for Voices {
    fn drop(&mut self) {
        self.synth.set_onvoiceschanged(None);
    }
}

/// Sets `has` to whether a voice is installed, now and again whenever the
/// browser's list changes. `None` means no `speechSynthesis` at all.
pub(super) fn watch(mut has: Signal<bool>) -> Option<Voices> {
    let synth = synth()?;
    has.set(synth.get_voices().length() > 0);
    let later = synth.clone();
    let changed = Closure::<dyn FnMut()>::new(move || {
        let installed = later.get_voices().length() > 0;
        if let Ok(mut has) = has.try_write() {
            *has = installed;
        }
    });
    synth.set_onvoiceschanged(Some(changed.as_ref().unchecked_ref()));
    Some(Voices {
        synth,
        _changed: changed,
    })
}

/// Speak `text`, clearing `speaking` when the last piece finishes. `false` if
/// there was nothing to say or no reader to say it.
pub(super) fn speak(text: &str, mut speaking: Signal<bool>) -> bool {
    let Some(voice) = synth() else { return false };
    let pieces = chunks(text);
    let Some((last, rest)) = pieces.split_last() else {
        return false;
    };
    for piece in rest {
        if let Ok(said) = SpeechSynthesisUtterance::new_with_text(piece) {
            voice.speak(&said);
        }
    }
    let Ok(said) = SpeechSynthesisUtterance::new_with_text(last) else {
        return false;
    };
    // `try_write`, not `set`: this fires whenever the browser finishes or is
    // cancelled, and the pane can be gone by then (switch agents while it
    // reads). Writing a signal whose scope has been dropped panics.
    let done = Closure::<dyn FnMut()>::new(move || {
        if let Ok(mut said) = speaking.try_write() {
            *said = false;
        }
    });
    let _ = said.add_event_listener_with_callback("end", done.as_ref().unchecked_ref());
    // Handed to the browser for the life of one utterance. `forget` and not a
    // stored handle: cancelling fires `end` asynchronously, so anything that
    // dropped the previous closure on the next press would be dropping one JS
    // may still be about to call.
    done.forget();
    voice.speak(&said);
    true
}

/// Break `text` into utterance-sized pieces, losing no word. Breaks land after
/// a sentence once a piece is half-full so the pauses fall where a reader would
/// pause; otherwise at the last word that fits. A single word longer than the
/// budget is left whole — cutting one in half would mispronounce it.
fn chunks(text: &str) -> Vec<String> {
    let (mut out, mut cur) = (Vec::new(), String::new());
    for word in text.split_whitespace() {
        if !cur.is_empty() && cur.len() + 1 + word.len() > CHUNK {
            out.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(word);
        if cur.len() >= CHUNK / 2 && cur.ends_with(['.', '!', '?', '…']) {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{chunks, CHUNK};

    fn essay() -> String {
        "The agent read the file and reported back at length. ".repeat(30)
    }

    #[test]
    fn a_long_answer_is_broken_up_rather_than_cut_off() {
        let pieces = chunks(&essay());
        assert!(pieces.len() > 1, "a 1500-character answer stayed in one piece");
        for piece in &pieces {
            assert!(piece.len() <= CHUNK, "over budget: {} chars", piece.len());
        }
    }

    #[test]
    fn no_word_is_dropped_or_repeated() {
        let text = essay();
        assert_eq!(chunks(&text).join(" "), text.split_whitespace().collect::<Vec<_>>().join(" "));
    }

    #[test]
    fn breaks_land_at_the_end_of_a_sentence() {
        let pieces = chunks(&essay());
        for piece in &pieces {
            assert!(piece.ends_with('.'), "broke mid-sentence: {piece:?}");
        }
    }

    #[test]
    fn a_word_longer_than_the_budget_survives_whole() {
        let long = "x".repeat(CHUNK + 50);
        assert_eq!(chunks(&long), vec![long]);
    }

    #[test]
    fn nothing_to_say_is_no_pieces() {
        assert!(chunks("   \n ").is_empty());
        assert!(chunks("").is_empty());
    }

    #[test]
    fn a_short_answer_is_spoken_in_one_go() {
        assert_eq!(chunks("Done. The file is written."), vec!["Done. The file is written."]);
    }
}
