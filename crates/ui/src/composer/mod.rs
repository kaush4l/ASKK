//! The composer — the one control that starts a turn. Its own module because
//! starting a turn and showing one are two jobs: `chat/mod.rs` owns the
//! conversation this sends into, and `voice.rs` below is the only way in that
//! is not typing.

use std::collections::{HashMap, HashSet};

use dioxus::prelude::*;

use crate::ui::{enter_submits, key_hint, Button, Field, Form, COMPOSER_ID};

/// Voice in and voice out, the only screen either appears on (increment 19).
mod voice;

/// The composer: a real form, so Enter submits and the button is a submit
/// button — with the default navigation prevented, because the seam is the only
/// transport. That is what stops the message becoming a query string. With no
/// endpoint configured it does not send: the first-run path is a sentence, not
/// a request that cannot work.
///
/// It is NOT disabled while a turn runs. It was, for as long as a turn was one
/// model call; an agent that may now work for sixty-four rounds (15C) cannot
/// also be a thing you are locked out of for the duration. A message typed
/// mid-run is steering: the pure machine appends it to the history and the
/// agent reads it on its next step (`agent::step`), so the only thing that
/// changes here is the word on the button.
#[component]
pub fn Composer(busy: bool, ready: bool, agent: String, on_send: EventHandler<String>) -> Element {
    // The field says who it is addressing: two panes with the same accessible
    // name would be indistinguishable to a screen reader.
    let label = match agent.is_empty() {
        true => "Message to the agent".to_string(),
        false => format!("Message to {agent}"),
    };
    // One draft PER AGENT. A single signal survived the agent prop changing —
    // the component keeps its position in the tree, so the text did too: type
    // to `author`, switch to `main`, press Send, and author's sentence went to
    // main (13d walk). A half-written message belongs to the conversation it
    // was being written to, the same way the transcript does.
    let mut drafts = use_signal(HashMap::<String, String>::new);
    let draft = drafts.read().get(&agent).cloned().unwrap_or_default();
    // WHOSE DRAFT WAS BEGUN INSIDE A RUN (R17-P1-4). Type mid-run and this
    // control means steering: the placeholder says so and the button reads
    // `Send to the run`. When the run ends under your fingers both change
    // silently, and the sentence you were halfway through writing is now the
    // start of a new turn instead. The text is kept — that was never the bug —
    // but nothing said the meaning had moved.
    //
    // Recorded where the typing happens rather than inferred from a busy→idle
    // edge: the handler already knows both facts and there is no transition to
    // miss. Keyed by agent and cleared with the draft, like the draft.
    let mut mid_run = use_signal(HashSet::<String>::new);
    let moved = !busy && mid_run.read().contains(&agent) && !draft.trim().is_empty();
    // Three names, three handlers, one draft map. `send` is a plain fn rather
    // than a closure because two handlers call it now — the form's submit and
    // the textarea's Enter (R4-4) — and a closure that owns the key String is
    // not `Copy`, so the second capture would move it.
    fn send(
        mut drafts: Signal<HashMap<String, String>>,
        mut mid_run: Signal<HashSet<String>>,
        key: &str,
        ready: bool,
        on_send: &EventHandler<String>,
    ) {
        let text = drafts.read().get(key).cloned().unwrap_or_default();
        let text = text.trim().to_string();
        if text.is_empty() || !ready {
            return;
        }
        drafts.write().remove(key);
        mid_run.write().remove(key);
        // NOTHING READS THE OLD ANSWER OVER THE NEW ONE (increment 19). The
        // answer being spoken belongs to the turn that just ended; the moment
        // this starts another, it is stale.
        voice::hush();
        on_send.call(text);
    }
    let (typed, on_enter, on_submit) = (agent.clone(), agent.clone(), agent.clone());
    // WHO THIS PANE IS ADDRESSING, AND WHETHER ITS RUN IS GOING — as a signal,
    // because the voice control's handler is built once at mount while this
    // component keeps its place in the tree as both facts change under it. A
    // captured pair would send every dictated phrase to the agent who happened
    // to be selected the first time the composer was drawn (THREADS.md §7), and
    // would mark the wrong side of the busy edge (R17-P1-4).
    let mut dictated = use_signal(|| (agent.clone(), busy));
    if *dictated.peek() != (agent.clone(), busy) {
        dictated.set((agent.clone(), busy));
    }
    rsx! {
        // ONE LINE, ABOVE THE FIELD, ONLY WHEN THE MEANING MOVED (R17-P1-4).
        // Above rather than below because the button underneath is the thing
        // whose word changed, and the notice has to be read before it is
        // pressed. It goes away as soon as the draft is sent or cleared.
        if moved {
            p { class: "note", role: "status",
                "The run ended while you were typing. Sending this starts a new turn."
            }
        }
        Form {
            oneline: true,
            onsubmit: move |_| send(drafts, mid_run, &on_submit, ready, &on_send),
            Field {
                // The one field a turn starts from, so it has a stable id:
                // every EmptyState in the rail answers "what would put
                // something here" by sending focus to exactly this control.
                id: COMPOSER_ID,
                // A TEXTAREA, three rows, growing with what is in it (R4-4).
                // The core act of this product is writing an instruction, and
                // the field it was written in showed about ninety characters
                // of it at a time — you could not read back what you had just
                // typed. `class: "grows"` is the auto-height rule in
                // `controls.css`; the three rows are the floor.
                rows: 3,
                class: "grows",
                value: "{draft}",
                aria_label: "{label}",
                placeholder: match (ready, busy) {
                    (false, _) => "Set a model endpoint first",
                    (true, true) => "Steer the run — the agent reads this on its next step…",
                    (true, false) => "Ask the agent something…",
                },
                autocomplete: "off",
                disabled: !ready,
                oninput: move |e: FormEvent| {
                    drafts.write().insert(typed.clone(), e.value());
                    if busy {
                        mid_run.write().insert(typed.clone());
                    }
                },
                // The submit behaviour the form gave an `<input>` for free.
                onkeydown: move |e: KeyboardEvent| {
                    if enter_submits(&e) {
                        e.prevent_default();
                        send(drafts, mid_run, &on_enter, ready, &on_send);
                    }
                },
            }
            Button {
                variant: "primary",
                submit: true,
                // …and on an empty draft (R2-9): pressing Send with nothing
                // typed returned silently, which reads as a broken button.
                disabled: !ready || draft.trim().is_empty(),
                // The word says what pressing it does. "Sending…" during a run
                // described the LAST message; this one describes this one.
                if busy { "Send to the run" } else { "Send" }
            }
            // The same binding, the same sentence, one source (R5-5).
            {key_hint()}
            // SPEECH FILLS THIS FIELD; IT DOES NOT SEND IT (increment 19).
            // Dictation is another way of writing the draft, so it belongs to
            // the draft's own control and lands in the same map — including
            // the mid-run mark, because a phrase dictated during a run has
            // exactly the same moved meaning a typed one has (R17-P1-4).
            voice::Voice {
                agent: agent.clone(),
                busy,
                on_text: move |said: String| {
                    let (who, running) = dictated.peek().clone();
                    let mut held = drafts.write();
                    let draft = held.entry(who.clone()).or_default();
                    if !draft.is_empty() && !draft.ends_with(' ') {
                        draft.push(' ');
                    }
                    draft.push_str(said.trim());
                    drop(held);
                    if running {
                        mid_run.write().insert(who);
                    }
                },
            }
        }
    }
}
