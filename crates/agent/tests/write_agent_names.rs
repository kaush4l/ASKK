//! **THE ONE PLACE A TOOL DESCRIPTION IS CHECKED AGAINST THE REAL TOOLBOX.**
//!
//! `write_agent`'s description enumerates the workspace tools an authored agent
//! may be given. That enumeration is a hand-kept copy of a list the machine
//! already holds in `workspace::workspace_tools`, and it has gone wrong twice:
//! once claiming a space "also grants it a real shell", and once by omission —
//! `edit_file` shipped in `0a99e9f` and was granted to the shipped `main` in
//! `5131e0b`, and the description never learned it. For an entire increment, an
//! agent authored THROUGH THE PRODUCT could not be given a tool the product had,
//! and nothing anywhere could go red about it.
//!
//! Fixing the sentence is not the fix. The sentence was correct once before too;
//! what makes it stay correct is that adding a twelfth workspace tool now
//! reddens this file until somebody names it. That is what I16 asks for — where
//! the system holds a fact in a form a machine can read, the prose shown to a
//! model must be checkable against it, and checked.
//!
//! **WHAT IT DOES NOT CHECK, SAID PLAINLY (I17).** It pins that every tool the
//! toolbox HAS is named. It cannot pin that every name in the sentence is a real
//! tool in the other direction with equal force — a name here that no longer
//! exists would be caught by the second test below, but neither test can say
//! whether the sentence's CLAIMS about those tools (that naming a space makes
//! them available, that a non-empty `tools` list then narrows to exactly what it
//! names) are true. Those are `subagent::toolbox_for`'s behaviour and are tested
//! there, not here; this file is about the LIST, and only the list.

use agent::{builtin_tools, workspace_tools};

/// The `write_agent` descriptor as the model receives it.
fn write_agent_description() -> String {
    builtin_tools()
        .get("write_agent")
        .expect("write_agent is a built-in")
        .description
        .clone()
}

/// **EVERY WORKSPACE TOOL IS NAMED, OR THIS GOES RED.**
///
/// Positive control, run and restored: delete `edit_file, ` from the
/// enumeration in `crates/agent/src/tools.rs` and this fails with
/// `write_agent's description does not name edit_file` — which is exactly the
/// state the tree shipped in for one whole increment with nothing complaining.
#[test]
fn write_agent_names_every_workspace_tool_it_offers() {
    let said = write_agent_description();
    assert!(!said.is_empty(), "an empty description would satisfy nothing below");
    let tools = workspace_tools();
    assert!(tools.len() >= 11, "the toolbox shrank unexpectedly: {}", tools.len());
    for tool in &tools {
        assert!(
            said.contains(&tool.name),
            "write_agent's description does not name {} — an agent authored through the \
             product cannot be given a tool the product has (I16). The enumeration is in \
             crates/agent/src/tools.rs, in the_roster().",
            tool.name
        );
    }
}

/// **…AND NAMES NOTHING THAT IS NOT ONE.** The other direction of the same
/// drift: a tool removed from the workspace would leave its name standing in a
/// sentence a model reads and acts on, which is the `real shell` failure again
/// with the sign flipped.
///
/// It reads the WORDS of the enumeration rather than the whole description,
/// because the surrounding prose legitimately names `spawn_agent`, `tools` and
/// `space`, none of which are workspace tools. The enumeration is the clause
/// between the em dashes, which is also why the description keeps that shape.
#[test]
fn the_enumeration_names_nothing_the_workspace_does_not_have() {
    let said = write_agent_description();
    let listed = said
        .split("AVAILABLE TO NAME — ")
        .nth(1)
        .and_then(|rest| rest.split(" — ").next())
        .expect("the enumeration still sits between em dashes; if it moved, move this test");
    let known: Vec<String> = workspace_tools().into_iter().map(|t| t.name).collect();
    for word in listed.split(',').map(str::trim).filter(|w| !w.is_empty()) {
        assert!(
            known.contains(&word.to_string()),
            "write_agent's description offers '{word}', which workspace_tools does not have — \
             a model told to name it would author an agent that cannot be built"
        );
    }
}
