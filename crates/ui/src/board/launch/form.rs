//! THE TASK BOX: the product's primary input, the one press that dispatches an
//! agent, and the examples that go when there is a run to report instead.

use dioxus::prelude::*;

use crate::ui::{enter_submits, key_hint, Button, Field, Form};

/// Describe the whole task, then start the agent.
#[component]
pub(crate) fn TaskForm(
    who: String,
    /// What this agent can do, for the example set (`examples::picks`).
    can: String,
    /// The `/board` projection the card already read.
    board: String,
    on_launch: EventHandler<String>,
) -> Element {
    let task = use_signal(String::new);
    let empty = task.read().trim().is_empty();
    rsx! {
        WalkAwayLead { who: who.clone() }
        TaskEntry { task, who: who.clone(), on_launch, empty }
        StartBlockedNote { empty }
        // …AND THE EXAMPLES DO NOT VANISH ON THE FIRST KEYSTROKE (R8-EX).
        // Typing one character deleted three buttons and a lead: the card
        // collapsed ~330px under the cursor. They go only when there is a
        // RUN to report (R6-6).
        {crate::board::examples::picks(task, &who, &can, &board)}
    }
}

/// THE ROW YOU TYPE IN: the box, the press, and what the keys do. A launch
/// empties the box, because the receipt above the card is where the task is
/// from then on.
#[component]
fn TaskEntry(
    mut task: Signal<String>,
    who: String,
    on_launch: EventHandler<String>,
    empty: bool,
) -> Element {
    let launch = move |_: ()| {
        let text = task.peek().trim().to_string();
        if !text.is_empty() {
            on_launch.call(text);
            task.set(String::new());
        }
    };
    rsx! {
        Form {
            oneline: true,
            onsubmit: move |_| {
                let mut go = launch;
                go(());
            },
            TaskField {
                task,
                who: who.clone(),
                on_enter: move |_| {
                    let mut go = launch;
                    go(());
                },
            }
            StartAgentButton { empty }
            // WHAT THE KEYS DO (R5-5). INSIDE the form, like the composer's:
            // `flex-basis: 100%` means WIDTH in the form's row and HEIGHT in
            // the card's column — outside, it was a 699px paragraph that
            // pushed the examples off screen.
            {key_hint()}
        }
    }
}

/// What pressing Start means, in the one line above the box.
#[component]
fn WalkAwayLead(who: String) -> Element {
    rsx! {
        p { class: "note",
            "Give {who} a task and walk away — it works on its own, and “Agents and \
             what they are doing” below says how far it has got."
        }
    }
}

/// WHY the primary is dead (R3-15). A disabled button was painted a shade off
/// the secondary beside it and explained itself nowhere; `controls.css` paints
/// it, this says it.
#[component]
fn StartBlockedNote(empty: bool) -> Element {
    if !empty {
        return rsx! {};
    }
    rsx! {
        p { class: "note", "Start agent is off until you have typed a task." }
    }
}

/// The product's PRIMARY INPUT, once a 44px line (R4-4).
#[component]
fn TaskField(mut task: Signal<String>, who: String, on_enter: EventHandler<()>) -> Element {
    rsx! {
        Field {
            id: "task-field",
            rows: 3,
            class: "grows",
            value: "{task}",
            aria_label: "Task for {who}",
            placeholder: "Describe the whole task — what to make, where to put it, \
                          and what to tell you when it is done…",
            autocomplete: "off",
            oninput: move |e: FormEvent| task.set(e.value()),
            onkeydown: move |e: KeyboardEvent| {
                if enter_submits(&e) {
                    e.prevent_default();
                    on_enter.call(());
                }
            },
        }
    }
}

/// "Start agent", never "Run" (R2-10): this press dispatches an agent that
/// works on its own for as many steps as it likes, where the Workspace's button
/// runs one shell line. DISABLED until there is a task (R2-9).
#[component]
fn StartAgentButton(empty: bool) -> Element {
    rsx! {
        Button {
            variant: "primary",
            submit: true,
            disabled: empty,
            "Start agent"
        }
    }
}
