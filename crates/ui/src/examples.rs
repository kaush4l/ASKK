//! THE STARTER TASKS, AS A PROPERTY OF THE AGENT (R6-1).
//!
//! A first task is the whole of a first session, and "Build me a thing" is a
//! placeholder nobody can act on: it names no tool, no file and no command, so
//! the one thing a stranger has to supply is the one thing they have no way to
//! guess. Three whole tasks an agent can finish and report on is the fix, and
//! it was the right fix for the wrong subject — the three were constants.
//!
//! With `summarizer` selected, the card beside them correctly read *"summarizer
//! has no workspace folder, so it runs no commands"*, and the page then offered
//! `Write a file called notes.md…`, `Run \`uname -a\`…` and `List the files in
//! the workspace…`. A critic pressed the first. It "finished", and the reply
//! said *"The file notes.md was successfully created with these points."* It
//! was not. The product knew that task could not work, printed it as a
//! suggestion, and then let the model narrate a success over the top of it.
//!
//! So the set is chosen by the one fact that decides it: whether this agent has
//! a workspace folder at all (`roster::has_workspace` — the folder belongs to
//! the shared space, and an agent whose file names none has neither). Nothing
//! here is a capability the agent lacks, and every line is runnable as it
//! stands rather than a template with a hole in it.
//!
//! The ROW is here too: the sets and the buttons that offer them are one job,
//! and `launch.rs` had no room left for both (I12).

use dioxus::prelude::*;

use crate::ui::Button;

/// Three tasks that exercise the three things a workspace gives an agent:
/// write a file, run a command, read a file back.
const WITH_WORKSPACE: [&str; 3] = [
    "Write a file called notes.md in the folder with three bullet points about \
     what you can do, then tell me what you wrote.",
    "Run `uname -a` in the folder and tell me, in one sentence, what machine \
     this is.",
    "List the files in the folder, read the most interesting one, and summarise it.",
];

/// …and three for an agent that has none. Every one is answerable from the
/// message alone: no file, no shell, no folder to read back — and each is
/// complete as written, so pressing one and pressing Start agent is a whole
/// task and not a template to fill in.
const NO_WORKSPACE: [&str; 3] = [
    "In three sentences, tell me what you are for, and name one thing people ask \
     you for that you cannot do.",
    "Summarise these notes in five bullet points, keeping every name and number: \
     this page runs its agents in the browser; four of them are loaded; only an \
     agent whose file names a space gets a folder in Linux; a turn is one \
     stretch of work an agent has taken.",
    "Explain what an AI agent is to somebody who has never used one — one short \
     paragraph, then the same thing in one line.",
];

/// The three to offer, and the sentence that says why these three. The lead is
/// part of the answer: it names the fact the set was chosen by, so a person who
/// switches agent and sees the list change is told what changed with it.
pub(crate) fn offered(who: &str, workspace: bool) -> (String, &'static [&'static str; 3]) {
    match workspace {
        true => (
            format!("Not sure what to ask? {who} has a folder in Linux, so all three of these work:"),
            &WITH_WORKSPACE,
        ),
        false => (
            format!(
                "Not sure what to ask? {who} has no folder, so it answers rather than \
                 builds — these three need none:"
            ),
            &NO_WORKSPACE,
        ),
    }
}

/// The example row — WHICHEVER three this agent can actually finish (R6-1).
/// Pressing one FILLS the field rather than
/// launching: the press that starts an agent is the person's and stays theirs.
pub(crate) fn picks(mut task: Signal<String>, who: &str, workspace: bool) -> Element {
    let (lead, set) = offered(who, workspace);
    rsx! {
        div { class: "examples",
            p { class: "note", "{lead}" }
            div { class: "editor-picks",
                for (n, text) in set.iter().enumerate() {
                    Button {
                        key: "{n}",
                        variant: "ghost",
                        class: "example",
                        onclick: move |_| {
                            task.set(set[n].to_string());
                            crate::ui::focus("task-field");
                        },
                        "{text}"
                    }
                }
            }
        }
    }
}
