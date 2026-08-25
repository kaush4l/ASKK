//! THE STARTER TASKS, AS A PROPERTY OF WHAT THE AGENT CAN DO (R6-1, 29, 32).
//!
//! A first task is the whole of a first session, and "Build me a thing" is a
//! placeholder nobody can act on. Three whole tasks an agent can finish is the
//! fix, and it was the right fix for the wrong subject three times: constants
//! (`summarizer` offered a file it cannot write); the FOLDER (read-only
//! `critic` offered `uname -a`); then `data-can` alone (29).
//!
//! ONE WORD CANNOT CARRY THREE EXAMPLES (32). `author`, whose one job is writing
//! agents, was told it "answers rather than builds" over three tasks that asked
//! it to describe, summarise and explain — while `main`, `builder` and
//! `researcher` got three BYTE-IDENTICAL tasks, teaching a reader that three
//! different agents are one agent. The subject is now the RESOLVED TOOL NAMES
//! and the pass ceiling, both off the agent's own board row: every task below
//! names the fact that makes it finishable, and an agent gets the first three
//! whose fact its file makes true. Nothing here reads an agent NAME.
//!
//! The ROW is here too: the sets and their buttons are one job.

use dioxus::prelude::*;

use crate::ui::Button;

/// Every starter task, each with the ONE fact that makes it finishable: a tool
/// name the toolbox must hold, or `laps` for a file whose turn may walk its
/// stages twice. Order is priority — top is the task fewest agents can be
/// offered, so an agent's three are the three most its own.
const CANDIDATES: [(&str, &str); 5] = [
    ("laps", "Write a shell script that counts the words in every .md file in the folder, run \
              it, and if the total looks wrong read the script back and fix it — keep going \
              until the number it prints is one you can defend, then report it."),
    ("write_agent", "Write me an agent that takes an error message I paste in and suggests three \
                     things to try, install it, then tell me its name and one thing to ask it."),
    ("exec", "Run `uname -a` in the folder and tell me, in one sentence, what machine this is."),
    ("write_file", "Write a file called notes.md in the folder with three bullet points about \
                    what you can do, then tell me what you wrote."),
    ("post_note", "Read what the shared space already holds, leave one note there that would \
                   save the next agent a step, and tell me what you wrote."),
];

/// …and the filler, for an agent with fewer than three tasks of its own. Both
/// are answerable from the message alone — no file, no shell, no folder to read
/// back — and complete as written, so pressing one starts a whole task.
const ANSWERS: [&str; 2] = [
    "In three sentences, tell me what you are for, and name one thing people ask \
     you for that you cannot do.",
    "Summarise these notes in five bullet points, keeping every name and number: \
     this page runs its agents in the browser; only an agent whose file names a \
     space gets a folder in Linux; a turn is one stretch of work an agent has taken.",
];

/// WHAT THIS AGENT'S FILE MAKES TRUE, off its own board row: the tools it really
/// resolved to, and how many laps one turn may take. `None` is the board not
/// having answered — NOT an empty toolbox (`summarizer` has none).
fn facts(board: &str, who: &str) -> (Option<String>, u16) {
    let laps = crate::board::read_attrs::cell(board, who, "data-laps").and_then(|n| n.parse().ok());
    (crate::board::read_attrs::cell(board, who, "data-toolset"), laps.unwrap_or(1))
}

/// The three to offer and the sentence saying why these three — or `None`, for
/// an agent that can neither change nor run and for a roster that has not
/// loaded. `can` decides whether there is a task; `tools` and `laps` WHICH.
pub(crate) fn offered(
    who: &str, can: &str, tools: &str, laps: u16,
) -> Option<(String, Vec<&'static str>)> {
    let named = |name: &str| tools.split(", ").any(|t| t == name);
    // An agent that can run or change has at least one tool, so an empty list
    // is a projection that has not arrived — and a guess is the defect.
    if tools.is_empty() || can == "read" || can.is_empty() {
        return None;
    }
    // The looping task writes a file and runs a command on later laps, so an
    // agent that laps without a shell is not offered it.
    let true_of = |fact: &str| match fact {
        "laps" => laps > 1 && named("exec") && named("write_file"),
        name => named(name),
    };
    let mut set: Vec<&'static str> =
        CANDIDATES.iter().filter(|(f, _)| true_of(f)).map(|(_, t)| *t).take(3).collect();
    set.extend(ANSWERS.iter().take(3usize.saturating_sub(set.len())));
    let lead = match can {
        "run" => format!(
            "Not sure what to ask? Each of these three is a whole task {who}'s own tools can \
             finish — it runs commands in its folder in Linux:"
        ),
        _ => format!(
            "Not sure what to ask? {who} runs no commands, but each of these three is a whole \
             task its own tools can finish:"
        ),
    };
    Some((lead, set))
}

/// The sentence itself, apart from the rendering so it can be asserted on the
/// host (I3). NO TOOLS IS SAID AS NO TOOLS (32): "every tool it has reads" is a
/// claim about a toolbox, and `summarizer`'s holds nothing to read with.
fn no_task_said(who: &str, tools: Option<&str>) -> String {
    if tools == Some("") {
        return format!(
            "{who} has no tools at all — it cannot run, change or read anything here, so there \
             is no task to start. Everything it does, it does from the message you send it. Ask \
             it in chat instead."
        );
    }
    format!(
        "{who} cannot change anything and cannot run anything — every tool it has reads — so \
         there is no task to start here. Ask it in chat instead: a question it can answer from \
         what it reads, or finished work you want read over."
    )
}

/// WHAT THERE IS INSTEAD OF A TASK (29): the missing control said in words and
/// the door to the place this agent DOES take work (R2-12, R3-15).
pub(crate) fn no_task(who: &str, board: &str) -> Element {
    let (tools, _) = facts(board, who);
    let (said, to) = (no_task_said(who, tools.as_deref()), who.to_string());
    rsx! {
        p { class: "note", "{said}" }
        Button {
            variant: "secondary",
            onclick: move |_| crate::shell::route::show(crate::shell::views::View::Work, &to),
            "Open {who}'s chat"
        }
    }
}

/// The example row — WHICHEVER three this agent can finish (R6-1). Pressing one
/// FILLS the field: the press that starts an agent is the person's and stays so.
pub(crate) fn picks(mut task: Signal<String>, who: &str, can: &str, board: &str) -> Element {
    let (tools, laps) = facts(board, who);
    let Some((lead, set)) = offered(who, can, tools.as_deref().unwrap_or_default(), laps) else {
        return rsx! {};
    };
    rsx! {
        div { class: "examples",
            p { class: "note", "{lead}" }
            div { class: "editor-picks",
                for (n, text) in set.into_iter().enumerate() {
                    Button {
                        key: "{n}",
                        variant: "ghost",
                        class: "example",
                        onclick: move |_| {
                            task.set(text.to_string());
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
    /// 29: a read-only agent is offered nothing, nor is one whose projections
    /// have not arrived — never a guess.
    #[test]
    fn nothing_that_writes_or_runs_is_offered_to_an_agent_that_cannot() {
        assert!(super::offered("critic", "read", "read_file, list_files", 1).is_none());
        assert!(super::offered("main", "", "exec", 1).is_none(), "no answer yet");
        assert!(super::offered("main", "run", "", 1).is_none(), "no toolset yet");
    }

    /// 32: the tasks follow from the tools, so three toolboxes are three sets.
    #[test]
    fn the_tasks_follow_from_the_tools_and_no_two_toolboxes_get_one_set() {
        let set = |t: &str, laps| super::offered("x", "run", t, laps).expect("can act").1;
        let (shell, builder) = ("exec, write_file, post_note, read_file", 4);
        assert!(set(shell, builder)[0].contains("keep going until"), "laps first");
        assert_ne!(set(shell, builder), set(shell, 1), "the pass ceiling is a difference");
        let researcher = set("write_agent, exec, write_file, read_file", 1);
        assert_ne!(researcher, set(shell, 1), "so is a tool one of them does not have");
        assert!(researcher[0].contains("Write me an agent"), "{researcher:?}");
        // A laps agent with no shell is not offered the shell task (I15).
        assert!(!set("write_agent, post_note", 4)[0].contains("keep going until"), "no shell");
        // …and nothing is offered a task its toolbox cannot finish.
        let author =
            super::offered("author", "change", "list_agents, read_agent, write_agent", 1)
                .expect("it can act, so it is asked");
        assert!(author.0.contains("runs no commands"), "{}", author.0);
        assert!(author.1[0].contains("Write me an agent"), "its one job: {:?}", author.1);
        for task in &author.1 {
            assert!(!task.contains("uname") && !task.contains("notes.md"), "{task}");
        }
    }

    /// …and the absence is explained rather than left a gap (R2-12), in the
    /// words true of THIS agent (32).
    #[test]
    fn the_agent_with_no_task_is_told_what_to_do_instead() {
        let said = super::no_task_said("critic", Some("read_file, list_files"));
        assert!(said.contains("cannot change anything and cannot run anything"), "{said}");
        assert!(said.contains("chat"), "it names the place that does work: {said}");
        let none = super::no_task_said("summarizer", Some(""));
        assert!(none.contains("no tools at all"), "{none}");
        assert!(!none.contains("every tool it has reads"), "it has none to read with: {none}");
    }
}
