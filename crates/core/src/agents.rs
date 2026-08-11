//! The agents module: the one route that shows what got loaded. Installing
//! them onto the running app is `install.rs`; this file only renders.

use agent::AgentSpec;
use kernel::{ModuleId, Request, Response, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};

/// How this agent names its model — a catalogue key, never a URL.
fn model_line(spec: &AgentSpec) -> String {
    match spec.model.is_empty() {
        true => "default model".to_string(),
        false => format!("model: {}", spec.model),
    }
}

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("agents".into()),
        name: "Agents".into(),
        version: Version(1),
        description: "Every loaded agent — shipped or authored here — and the writing of one."
            .into(),
        capabilities: vec![kernel::CapabilityId::Emit],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/agents".into(),
            },
            RouteSpec {
                method: "GET".into(),
                path: "/agents/file".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/agents".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/agents/delete".into(),
            },
        ],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/agents/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn agents(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/agents") => listing(ctx),
        ("GET", "/agents/file") => crate::authoring::file(req, ctx),
        ("POST", "/agents") => crate::authoring::write(req, ctx),
        ("POST", "/agents/delete") => crate::authoring::delete(req, ctx),
        _ => error_fragment(404, "agents: unknown subroute"),
    }
}

fn listing(ctx: &Ctx) -> Response {
    let mut list = FragmentBuilder::new("div").id("agent-list");
    if ctx.agents.is_empty() {
        list = list.child(
            FragmentBuilder::new("p")
                .class("pending")
                .text("No agents loaded. public/agents/index.json is the manifest — an agent folder that is not listed there is never fetched.")
                .build(),
        );
    }
    for spec in &ctx.agents {
        list = list.child(card(spec, &ctx.agents, &ctx.authored));
    }
    for problem in &ctx.agent_problems {
        list = list.child(
            FragmentBuilder::new("p")
                .class("error")
                .text(&format!("Skipped — {problem}"))
                .build(),
        );
    }
    html(200, list.build().into_html())
}

/// The settings line: what the file asked for, and — for tools — what that
/// actually RESOLVES to. The card used to print the frontmatter's `tools:`
/// while the phase table decided the real toolbox, so it said "no tools yet"
/// about an agent with three (`ux-walker`, increment 05). It now prints the
/// same list `step` renders into AFFORDANCES, so the card cannot be wrong
/// without the model being wrong too.
fn meta_line(spec: &AgentSpec, peers: &[AgentSpec]) -> String {
    let temperature = spec
        .temperature
        .map(|t| format!(", temperature {t}"))
        .unwrap_or_default();
    let box_ = agent::toolbox_for(spec, peers);
    // Built-ins and peers are ONE list to the model on purpose (it is never
    // told which is which — `Tool::from_engine`), but they are not one list to
    // a person: `researcher` read as a fourth built-in tool, when calling it
    // hands a goal to another agent with its own Worker, its own history and
    // its own row on the board (`ux-walker`, increment 06).
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
    let tools = match (tools.is_empty(), agents.is_empty()) {
        (true, true) => "no tools".to_string(),
        (true, false) => format!("agents it can call: {}", agents.join(", ")),
        (false, true) => format!("tools: {}", tools.join(", ")),
        (false, false) => format!(
            "tools: {}, agents it can call: {}",
            tools.join(", "),
            agents.join(", ")
        ),
    };
    let space = match spec.space.is_empty() {
        true => "no space".to_string(),
        false => format!("space: {}", spec.space),
    };
    format!(
        "{}{temperature}, engine: {}, {space}, {tools}",
        model_line(spec),
        spec.engine
    )
}

/// The prompt disclosure's own name. Named per agent: two disclosures with the
/// same accessible name are indistinguishable to a screen reader (`ux-walker`,
/// increment 03), and WHO wrote it belongs in that name too (11b walk).
fn disclosure(spec: &AgentSpec, mine: Option<&str>) -> String {
    let origin = match mine {
        Some("") => "written by you in this browser".to_string(),
        Some(by) => format!("written by the {by} agent"),
        None => format!("from public/agents/{}/agent.md", spec.name),
    };
    format!("System prompt for {} ({origin})", spec.name)
}

/// One agent, as its file declares it. The prompt is shown verbatim behind a
/// disclosure: it is the whole point of the file, and also the longest part.
fn card(spec: &AgentSpec, peers: &[AgentSpec], authored: &[(String, String)]) -> Fragment {
    let mine = authored
        .iter()
        .find(|(n, _)| *n == spec.name)
        .map(|(_, by)| by.as_str());
    let mut card = FragmentBuilder::new("div")
        .class("agent-card")
        .attr("data-agent", &spec.name)
        .attr("data-origin", match mine {
            Some("") => "authored",
            Some(_) => "authored-by-agent",
            None => "shipped",
        })
        .child(FragmentBuilder::new("h3").text(&spec.name).build());
    // An agent file with no `description:` gets no empty paragraph pretending
    // to be one (12 walk, finding 4 — the same absence rendered `note-taker — `
    // in the chat header).
    if !spec.description.trim().is_empty() {
        card = card.child(FragmentBuilder::new("p").text(&spec.description).build());
    }
    card.child(
            FragmentBuilder::new("p")
                .class("agent-origin")
                .text(&crate::authoring::origin_line(spec, mine))
                .build(),
        )
        .child(
            FragmentBuilder::new("p")
                .class("agent-meta")
                .text(&meta_line(spec, peers))
                .build(),
        )
        .child(
            FragmentBuilder::new("details")
                .child(FragmentBuilder::new("summary").text(&disclosure(spec, mine)).build())
                .child(FragmentBuilder::new("pre").text(&spec.prompt).build())
                .build(),
        )
        .build()
}
