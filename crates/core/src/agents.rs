//! The agents module: who is loaded, from where, and with what prompt.
//!
//! Agents are DATA, not code — `public/agents/<name>/agent.md`, served as
//! static assets and fetched at boot, so editing a file and redeploying
//! changes an agent's behaviour with no rebuild. This file owns the two
//! halves the core needs: installing the fetched files onto the running app,
//! and the one route that shows what got loaded.

use agent::AgentSpec;
use kernel::{EventKind, ModuleId, Request, Response, Version};
use module::view::{Fragment, FragmentBuilder};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::app::App;
use crate::dispatch::{error_fragment, html, Ctx};

/// Agents compiled into the binary, so a first paint (or a failed fetch) is
/// never an app with no agents at all. The summarizer is the Python
/// project's built-in — `core/agents/summarizer` there, the same file here.
/// It is listed FIRST wherever it is merged, which is what makes a project
/// agent of the same name replace it (Python `registry._agent_dirs`).
pub fn builtin_files() -> Vec<(String, String)> {
    vec![(
        "summarizer".into(),
        include_str!("../../../public/agents/summarizer/agent.md").into(),
    )]
}

/// Install the fetched `public/agents/` files: built-ins first so a project
/// agent of the same name wins, malformed files skipped (they cost that one
/// agent, never the boot), and `main`'s prompt adopted by the running agent.
/// Called by the composition root right after `boot`.
pub fn install_agents(app: &mut App, fetched: Vec<(String, String)>) {
    let files = builtin_files().into_iter().chain(fetched);
    let (specs, problems) = agent::load_agents(files);
    app.agents = specs;
    app.agent_problems = problems;
    if let Some(main) = app.agents.iter().find(|s| s.name == "main").cloned() {
        agent::adopt_spec(&mut app.agent, &main);
    }
    let names: Vec<&str> = app.agents.iter().map(|s| s.name.as_str()).collect();
    app.append(EventKind::Custom {
        kind: "core.agents_loaded".into(),
        payload_json: serde_json::to_string(&names).unwrap_or_else(|_| "[]".into()),
    });
}

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
        description: "The agents loaded from public/agents/: name, description, model, prompt."
            .into(),
        capabilities: vec![],
        routes: vec![RouteSpec {
            method: "GET".into(),
            path: "/agents".into(),
        }],
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
        list = list.child(card(spec));
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

/// The settings line: what the file asked for, in the file's own words.
fn meta_line(spec: &AgentSpec) -> String {
    let temperature = spec
        .temperature
        .map(|t| format!(", temperature {t}"))
        .unwrap_or_default();
    let tools = match spec.tools.is_empty() {
        true => "no tools yet".to_string(),
        false => format!("tools: {}", spec.tools.join(", ")),
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

/// One agent, as its file declares it. The prompt is shown verbatim behind a
/// disclosure: it is the whole point of the file, and also the longest part.
fn card(spec: &AgentSpec) -> Fragment {
    FragmentBuilder::new("div")
        .class("agent-card")
        .attr("data-agent", &spec.name)
        .child(FragmentBuilder::new("h3").text(&spec.name).build())
        .child(FragmentBuilder::new("p").text(&spec.description).build())
        .child(
            FragmentBuilder::new("p")
                .class("agent-meta")
                .text(&meta_line(spec))
                .build(),
        )
        .child(
            FragmentBuilder::new("details")
                .child(
                    // Named per agent: two disclosures with the same
                    // accessible name are indistinguishable to a screen
                    // reader (`ux-walker`, increment 03).
                    FragmentBuilder::new("summary")
                        .text(&format!(
                            "System prompt for {} (from public/agents/{}/agent.md)",
                            spec.name, spec.name
                        ))
                        .build(),
                )
                .child(FragmentBuilder::new("pre").text(&spec.prompt).build())
                .build(),
        )
        .build()
}
