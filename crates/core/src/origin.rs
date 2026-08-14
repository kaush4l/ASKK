//! WHERE AN AGENT CAME FROM, and what it can therefore do, in one sentence.
//! Split from `authoring.rs`, which owns the three routes that WRITE an agent,
//! so both hold the 200-line rule (I12).
//!
//! It is not a route and it belongs to neither of its two callers: the agent
//! card and the identity panel both draw this line, and the whole point of it
//! being one function is that those two places cannot come to say different
//! things about the same agent. The card's OTHER derived sentence — which
//! tools that agent really has, and which names in its file resolved to
//! nothing (R18-P1-7) — is here for the same reason and to hold I12.

use agent::AgentSpec;

/// WHO wrote this agent, and what it can therefore do (increment 11). A model
/// can now author an agent that runs with real capabilities, so the page
/// states which agents are this browser's rather than leaving it to be
/// inferred — and states the grant honestly: the space IS the grant, and the
/// shell is unrestricted inside the tab's Linux, which is the sandbox. (That
/// `read_file`'s path check is legibility, not containment, is a fact about our
/// code: it stays in this comment and off the card — R10-10.)
///
/// `mine` is `Some(author)`: an empty author is the person at this keyboard, a
/// named one is the agent that wrote it. Both used to read "Authored in this
/// browser", so an agent a model wrote itself was indistinguishable from your
/// own work (11b walk).
pub(crate) fn origin_line(spec: &AgentSpec, mine: Option<&str>) -> String {
    let origin = match mine {
        Some("") => "Written by you in this browser".to_string(),
        Some(author) => format!("Written by the {author} agent, in this browser"),
        // NO REPOSITORY PATH (R4-16). "as public/agents/main/agent.md" is a
        // path in a source tree the reader of this page cannot open, on the
        // first line they read about an agent. Where the file lives is the
        // maintainer's business; where the agent CAME FROM is the reader's.
        None => "Shipped with this site".to_string(),
    };
    // THREE THINGS WERE CALLED "space" (R5-13) and then two (shared space,
    // workspace folder). ONE NOW (R16-1): a WORKSPACE. Naming one in the
    // agent's file is what gives the agent a folder and a shell.
    let Some(space) = agent::Space::named(&spec.space) else {
        return format!(
            "{origin}. Its file names no space, so it has no folder and cannot run \
             commands."
        );
    };
    // …AND WHAT THAT MEANS, NOT HOW IT IS IMPLEMENTED (R10-10). WHICH claim,
    // though, is the toolbox's to make and not the space's: a non-empty
    // `tools:` list can take the folder and leave the shell behind
    // (`subagent::toolbox_for`), which is what a read-only agent IS. Asking the
    // function AFFORDANCES comes from is what stops this promising a refusal.
    let granted = match agent::toolbox_for(spec, &[]).get("exec").is_some() {
        true => "a shell, the four file tools, processes it can start and leave running, and one \
                 question it can ask about the machine itself. Its shell is a full one: it can \
                 read anything in that Linux, not only its own folder, and the Linux in this tab \
                 is as far as it goes",
        false => "reached only through the tools its own file names, which are listed under how \
                  it is set up. There is no shell among them, so it can look at that Linux and \
                  not change it",
    };
    format!(
        "{origin}. It works in the '{}' space: a folder in Linux at {}, and the facts \
         and notes that space shares — {granted}.",
        space.name,
        space.path()
    )
}

/// Built-ins and peers are ONE list to the model on purpose (it is never told
/// which is which — `Tool::from_engine`), but they are not one list to a
/// person: `researcher` read as a fourth built-in tool, when calling it hands a
/// goal to another agent with its own Worker, its own history and its own row
/// on the board (`ux-walker`, increment 06).
pub(crate) fn tool_lines(spec: &AgentSpec, peers: &[AgentSpec]) -> Vec<String> {
    let box_ = agent::toolbox_for(spec, peers);
    let (agents, tools): (Vec<&str>, Vec<&str>) = box_
        .tools
        .iter()
        .map(|t| (t.name.as_str(), t.agent))
        .fold((Vec::new(), Vec::new()), |(mut a, mut t), (name, is_agent)| {
            match is_agent {
                true => a.push(name),
                false => t.push(name),
            }
            (a, t)
        });
    let mut out = Vec::new();
    out.push(match tools.is_empty() {
        true => "No tools".to_string(),
        // "named", because one of them is called `now` and a bare list of
        // names reads as a sentence that has lost its verbs.
        false => format!("Tools it can use, named: {}", tools.join(", ")),
    });
    if !agents.is_empty() {
        out.push(format!(
            "Other agents it can hand work to: {}",
            agents.join(", ")
        ));
    }
    // A NAME THAT RESOLVED TO NOTHING IS SAID, NOT DROPPED (R18-P1-7). `tools:
    // [nope_tool]` produced `No tools` here — the card reporting a silent drop
    // back as a fact about the agent. The list is the file's own words, because
    // the file is where the typo is.
    let missing = agent::unresolved_tools(spec, peers);
    if !missing.is_empty() {
        out.push(format!(
            "Named in its file but not installed here, so it cannot use {}: {}",
            match missing.len() { 1 => "it", _ => "them" },
            missing.join(", ")
        ));
    }
    out
}
