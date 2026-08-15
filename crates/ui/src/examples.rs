//! THE STARTER TASKS, AS A PROPERTY OF WHAT THE AGENT CAN DO (R6-1, 29).
//!
//! A first task is the whole of a first session, and "Build me a thing" is a
//! placeholder nobody can act on: it names no tool, no file and no command, so
//! the one thing a stranger has to supply is the one thing they have no way to
//! guess. Three whole tasks an agent can finish and report on is the fix, and it
//! was the right fix for the wrong subject — twice.
//!
//! First the three were constants: with `summarizer` selected the card beside
//! them correctly read *"summarizer has no workspace folder, so it runs no
//! commands"*, and the page then offered `Write a file called notes.md…` and
//! `Run \`uname -a\`…`. A critic pressed the first, it "finished", and the reply
//! said *"The file notes.md was successfully created with these points."* It was
//! not.
//!
//! Then the set was chosen by whether the agent had a FOLDER — and that is how
//! `critic`, whose three tools all read, came to be offered `Run \`uname -a\` in
//! the folder` under the words *"critic has a folder in Linux, so all three of
//! these work"*, two views away from the Commands pane saying *"critic has no
//! shell"*. Having a folder is not permission to write in it or run anything in
//! it. The subject is `data-can`, the card's own answer to what its RESOLVED
//! tools let it do (`core::origin::can`), and for the agent that can do neither
//! the honest number of starter tasks is none.
//!
//! The ROW is here too: the sets and the buttons that offer them are one job,
//! and `launch.rs` had no room left for both (I12).

use dioxus::prelude::*;

use crate::ui::Button;

/// Three tasks that exercise the three things a shell and a folder give an
/// agent: write a file, run a command, read a file back.
const RUNS: [&str; 3] = [
    "Write a file called notes.md in the folder with three bullet points about \
     what you can do, then tell me what you wrote.",
    "Run `uname -a` in the folder and tell me, in one sentence, what machine \
     this is.",
    "List the files in the folder, read the most interesting one, and summarise it.",
];

/// …and three for an agent that cannot run one. Every one is answerable from the
/// message alone: no file, no shell, no folder to read back — and each is
/// complete as written, so pressing one and pressing Start agent is a whole task
/// and not a template to fill in.
const ANSWERS: [&str; 3] = [
    "In three sentences, tell me what you are for, and name one thing people ask \
     you for that you cannot do.",
    "Summarise these notes in five bullet points, keeping every name and number: \
     this page runs its agents in the browser; four of them are loaded; only an \
     agent whose file names a space gets a folder in Linux; a turn is one \
     stretch of work an agent has taken.",
    "Explain what an AI agent is to somebody who has never used one — one short \
     paragraph, then the same thing in one line.",
];

/// The three to offer, and the sentence that says why these three — or `None`,
/// which is the answer for an agent that can neither change nor run anything.
/// The lead names the fact the set was chosen by, so a person who switches agent
/// and sees the list change is told what changed with it.
///
/// `can` is the card's `data-can`: `run`, `change` or `read`. An empty string is
/// the roster not having loaded yet, and it offers nothing rather than guessing
/// — a wrong guess here is the whole defect this file exists to hold shut.
pub(crate) fn offered(who: &str, can: &str) -> Option<(String, &'static [&'static str; 3])> {
    match can {
        "run" => Some((
            format!("Not sure what to ask? {who} can run commands in its folder in Linux, so all \
                     three of these work:"),
            &RUNS,
        )),
        "change" => Some((
            format!("Not sure what to ask? {who} runs no commands, so it answers rather than \
                     builds — these three need nothing run:"),
            &ANSWERS,
        )),
        _ => None,
    }
}

/// The sentence itself, apart from the rendering so it can be asserted on the
/// host (I3 — `crates/ui` has no lib target and this is the testable half).
fn no_task_said(who: &str) -> String {
    format!(
        "{who} cannot change anything and cannot run anything — every tool it has reads — so \
         there is no task to start here. Ask it in chat instead: a question it can answer from \
         what it reads, or finished work you want read over."
    )
}

/// WHAT THERE IS INSTEAD OF A TASK (29): the missing control said in words, and
/// the door to the place this agent DOES take work. A control that is simply
/// absent explains nothing, and a disabled one explains no more (R2-12, R3-15).
pub(crate) fn no_task(who: &str) -> Element {
    let (said, to) = (no_task_said(who), who.to_string());
    rsx! {
        p { class: "note", "{said}" }
        Button {
            variant: "secondary",
            onclick: move |_| crate::route::show(crate::views::View::Chat, &to),
            "Open {who}'s chat"
        }
    }
}

/// The example row — WHICHEVER three this agent can actually finish (R6-1).
/// Pressing one FILLS the field rather than launching: the press that starts an
/// agent is the person's and stays theirs.
pub(crate) fn picks(mut task: Signal<String>, who: &str, can: &str) -> Element {
    let Some((lead, set)) = offered(who, can) else {
        return rsx! {};
    };
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

#[cfg(test)]
mod tests {
    /// 29: the set is chosen by what the tools DO. A read-only agent is offered
    /// nothing, and neither of the sets it is not offered may reach it: two of
    /// the three `RUNS` tasks are impossible for `critic` and the page said all
    /// three worked.
    #[test]
    fn nothing_that_writes_or_runs_is_offered_to_an_agent_that_cannot() {
        assert!(super::offered("critic", "read").is_none(), "read-only gets no starter task");
        let (lead, set) = super::offered("main", "run").expect("a shell agent gets the three");
        assert!(lead.contains("can run commands"), "{lead}");
        assert!(set.iter().any(|t| t.contains("uname -a")), "{set:?}");
        let (lead, set) = super::offered("author", "change").expect("it can act, so it is asked");
        assert!(lead.contains("runs no commands"), "{lead}");
        for task in set {
            assert!(!task.contains("uname"), "no command: {task}");
            assert!(!task.contains("Write a file"), "no file: {task}");
        }
        // The roster has not loaded: no answer, so no offer — never a guess.
        assert!(super::offered("main", "").is_none());
    }

    /// …and the absence is explained rather than left as a gap (R2-12).
    #[test]
    fn the_agent_with_no_task_is_told_what_to_do_instead() {
        let said = super::no_task_said("critic");
        assert!(said.contains("cannot change anything and cannot run anything"), "{said}");
        assert!(said.contains("chat"), "it names the place that does work: {said}");
    }
}
