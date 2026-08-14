//! The agents module: the one route that shows what got loaded. Installing
//! them onto the running app is `install.rs`; this file only renders.

use kernel::{ModuleId, Request, Response, Version};
use module::view::FragmentBuilder;
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};

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
        list = list.child(crate::agentcard::card(spec, &ctx.agents, &ctx.authored));
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
