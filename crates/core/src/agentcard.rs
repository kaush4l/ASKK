//! ONE AGENT, as a card. Split from `agents.rs` — which owns the route and the
//! listing — so both hold the 200-line rule (I12) once the settings moved
//! behind a disclosure.
//!
//! R2-16: the card read `model: local, temperature 0.2, engine: react, no
//! space, tools: now, list_agents, read_agent, write_agent` in full, directly
//! under a one-line human description that was the best sentence on the page.
//! A first-time reader has no way to learn what `engine: react` is (the words
//! appear nowhere else in the product), `no space` reads like a layout note,
//! and `now` reads like an adverb. So: the sentence stays visible, the settings
//! go behind the same disclosure the prompt already uses, and every term that
//! survives says what it means in ordinary words.
//!
//! The TOOL NAMES are printed verbatim, because a tool's name is what the
//! model is told and what the trace shows; what changed is that the line says
//! they are names.

use agent::AgentSpec;
use module::view::{Fragment, FragmentBuilder};

/// What `engine:` means, in the words the rest of this interface uses.
///
/// THE THIRD ARM IS GONE (increment 19). It printed `How it works: reakt` — the
/// file's own word, dressed as a fact about the machine — for a value that
/// selected nothing, next to two sentences that also described a choice the
/// machine did not make. `spec::set_field` now refuses anything but these two
/// and `subagent::resolve` makes `base` mean what this line says, so both
/// sentences are enforced and there is no unrecognised value left to print.
/// AND NEITHER SAYS "ENGINE" (R16-4): Settings calls the Linux an engine.
fn engine_line(engine: &str) -> String {
    match engine {
        agent::ENGINE_BASE => "Answers in one reply, without calling tools".into(),
        _ => "Works in steps: calls a tool, reads the result, then decides again".into(),
    }
}

/// The settings line: what the file asked for, and — for tools — what that
/// actually RESOLVES to. The card used to print the frontmatter's `tools:`
/// while the phase table decided the real toolbox, so it said "no tools yet"
/// about an agent with three (`ux-walker`, increment 05). It prints the same
/// list `step` renders into AFFORDANCES, so the card cannot be wrong without
/// the model being wrong too.
pub(crate) fn meta_line(
    spec: &AgentSpec,
    peers: &[AgentSpec],
    found: Option<(&str, &str)>,
) -> String {
    let mut parts = vec![crate::origin::model_line(spec, found)];
    if let Some(t) = spec.temperature {
        parts.push(format!("Temperature {t}"));
    }
    parts.push(engine_line(&spec.engine));
    parts.push(match spec.space.is_empty() {
        true => "No space, so it works alone".to_string(),
        false => format!("Space: {}", spec.space),
    });
    parts.extend(crate::origin::tool_lines(spec, peers));
    parts.join(" · ")
}

/// The prompt disclosure's own name. Named per agent: two disclosures with the
/// same accessible name are indistinguishable to a screen reader (`ux-walker`,
/// increment 03), and WHO wrote it belongs in that name too (11b walk).
fn disclosure(spec: &AgentSpec, mine: Option<&str>) -> String {
    let origin = match mine {
        Some("") => "written by you in this browser".to_string(),
        Some(by) => format!("written by the {by} agent"),
        None => "shipped with this site".to_string(),
    };
    format!("System prompt for {} ({origin})", spec.name)
}

/// THE TWO THINGS YOU CAN DO WITH AN AGENT (R15-P1-9). The roster was six
/// cards you could only read: every route to doing something with the agent you
/// had just read about went through the nav and the agent strip. These are
/// plain buttons carrying the destination on `data-open`; the shell's one
/// delegated handler (`ui/roster.rs`) turns a press into the route that already
/// exists. Named for the DESTINATION, never "Start" — nothing here starts a
/// turn (R5-3). `editor-picks` is the existing "a row of buttons in a card"
/// class (controls.css) rather than a seventh one nobody agreed to.
fn doors(name: &str) -> Fragment {
    let door = |to: &str, label: &str| {
        FragmentBuilder::new("button")
            .attr("type", "button")
            .class("btn-secondary")
            .attr("data-open", to)
            .text(label)
            .build()
    };
    FragmentBuilder::new("p")
        .class("editor-picks")
        .child(door("chat", &format!("Talk to {name}")))
        .child(door("task", &format!("Give {name} a task")))
        .build()
}

/// A `<details>` with a named summary. Both of the card's folds are this.
fn fold(summary: &str, body: Fragment) -> Fragment {
    FragmentBuilder::new("details")
        .child(FragmentBuilder::new("summary").text(summary).build())
        .child(body)
        .build()
}

/// One agent, as its file declares it. What is VISIBLE is the name, the human
/// sentence and where the file came from; the settings and the prompt — the
/// two longest parts, and the two nobody reads first — are one press away.
pub(crate) fn card(
    spec: &AgentSpec,
    peers: &[AgentSpec],
    authored: &[(String, String)],
    found: Option<(&str, &str)>,
) -> Fragment {
    let mine = authored
        .iter()
        .find(|(n, _)| *n == spec.name)
        .map(|(_, by)| by.as_str());
    let mut card = FragmentBuilder::new("div")
        .class("agent-card")
        .attr("data-agent", &spec.name)
        // WHICH SHARED SPACE, as a fact and not only as prose (R6-1/R6-2). An
        // agent's space is what decides whether it has a workspace folder at
        // all — whether it can run a command, write a file, or be offered a
        // starter task that needs one — and the answer was legible only inside
        // the settings fold's sentence. Emitted EMPTY when there is none rather
        // than omitted, so a reader scanning one card's attributes cannot fall
        // through to the next card's value.
        .attr("data-space", &spec.space)
        .attr("data-origin", match mine {
            Some("") => "authored",
            Some(_) => "authored-by-agent",
            None => "shipped",
        })
        .child(FragmentBuilder::new("h3").text(&spec.name).build());
    // SOMETHING HONEST IN THAT SLOT (R5-19). Three of five cards had no
    // `description:` and jumped from the name straight to provenance, so the
    // roster's rhythm broke on more cards than it held — one line of prose,
    // then two lines of metadata, then nothing, then two. The fix is not to
    // invent a description: it is to say what IS known, which is how the agent
    // works, in the same sentence `engine_line` already writes for the
    // settings fold. The absence is named rather than papered over, and the
    // 12-walk rule stands — no empty paragraph pretending to be one.
    card = card.child(match spec.description.trim().is_empty() {
        false => FragmentBuilder::new("p").text(&spec.description).build(),
        true => FragmentBuilder::new("p")
            .class("agent-unsaid")
            .text(&format!(
                "Its file gives no description. {}.",
                engine_line(&spec.engine)
            ))
            .build(),
    });
    let meta = FragmentBuilder::new("p")
        .class("agent-meta")
        .text(&meta_line(spec, peers, found))
        .build();
    // THE LOOP, AND WHO IT CAN HAND WORK TO — ON THE FACE OF THE CARD (21).
    // Everything about how an agent RUNS was behind `How {name} is set up`, so
    // the declared loop and the delegation edge were each one press and one
    // scroll from anybody who had not been told they existed. This is the same
    // `agent-meta` line the fold uses, promoted; nothing is duplicated inside.
    let mut runs = crate::origin::loop_line(spec);
    if let Some(peer) = crate::origin::peer_line(spec, peers) {
        runs.push_str(" · ");
        runs.push_str(&peer);
    }
    card = card.child(FragmentBuilder::new("p").class("agent-meta").text(&runs).build());
    card.child(
            FragmentBuilder::new("p")
                .class("agent-origin")
                .text(&crate::origin::origin_line(spec, mine))
                .build(),
        )
        .child(doors(&spec.name))
        .child(fold(&format!("How {} is set up", spec.name), meta))
        .child(fold(
            &disclosure(spec, mine),
            FragmentBuilder::new("pre").text(&spec.prompt).build(),
        ))
        .build()
}
