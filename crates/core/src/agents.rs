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
        // WHAT THIS AGENT'S KEY REALLY RESOLVES TO, asked of the port that will
        // make the call (`origin::model_line`). Absent when this build's port
        // has no catalogue — then the card says the file's own words and no
        // more, which is the one thing it must never invent.
        let found = ctx
            .resolved_models
            .iter()
            .find(|(key, _, _)| *key == spec.model)
            .map(|(_, entry, model)| (entry.as_str(), model.as_str()));
        list = list.child(crate::agentcard::card(spec, &ctx.agents, &ctx.authored, found));
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
