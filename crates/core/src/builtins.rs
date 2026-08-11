//! The G4 built-in modules: manifests (registered at boot through the one
//! install path, ADR-004) and their tier-0 handlers (named ONLY from
//! `dispatch::builtin_entry`). Fragments are composed exclusively through
//! the escaping view primitives — no raw HTML strings.

use kernel::{CapabilityId, ModuleId, Request, Response, Version};
use module::view::FragmentBuilder;
use module::{DataSchema, Manifest, RouteSpec, SlotSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};

/// Everything boot installs. Order is install order (and thus event order).
pub(crate) fn manifests() -> Vec<Manifest> {
    vec![
        Manifest {
            id: ModuleId("dashboard".into()),
            name: "Dashboard".into(),
            version: Version(1),
            description: "The root page: the title and the slotted panels.".into(),
            capabilities: vec![],
            routes: vec![route("GET", "/")],
            slots: vec![],
            section: None,
            schema: DataSchema {
                kv_prefix: "mod/dashboard/".into(),
                version: 1,
            },
            tier: Tier::T0Rust,
            tests: vec![],
        },
        crate::chat::manifest(),
        Manifest {
            id: ModuleId("status".into()),
            name: "Status".into(),
            version: Version(1),
            description: "One panel: what is running, when, how many facts.".into(),
            capabilities: vec![CapabilityId::Clock],
            routes: vec![route("GET", "/panels/status")],
            slots: vec![SlotSpec {
                slot: "main".into(),
                order: 0,
            }],
            section: None,
            schema: DataSchema {
                kv_prefix: "mod/status/".into(),
                version: 1,
            },
            tier: Tier::T0Rust,
            tests: vec![],
        },
    ]
}

fn route(method: &str, path: &str) -> RouteSpec {
    RouteSpec {
        method: method.into(),
        path: path.into(),
    }
}

/// The status panel (the one slotted panel of the walking skeleton).
pub(crate) fn status(_req: &Request, ctx: &mut Ctx) -> Response {
    let p = |text: &str| FragmentBuilder::new("p").text(text).build();
    let clock = ctx
        .clock
        .map(|t| format!("clock: {} ms since epoch", t.0))
        .unwrap_or_else(|| "clock: not granted".into());
    let panel = FragmentBuilder::new("div")
        .id("panel-status")
        .class("panel")
        .child(FragmentBuilder::new("h3").text("Status").build())
        .child(p("HARNESS v0.1.0 — walking skeleton"))
        .child(p(&clock))
        .child(p(&format!("facts in the log: {}", ctx.recent.len())))
        .build();
    html(200, panel.into_html())
}

/// The dashboard module: the root page composition, and nothing else — the
/// conversation moved to its own module (`chat`) with the `ChatPane` that
/// renders it.
pub(crate) fn dashboard(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/") => root(ctx),
        _ => error_fragment(404, "dashboard: unknown subroute"),
    }
}

/// Slot-declaring modules, listed but not yet mounted: htmx is gone, so the
/// old `hx-get` self-loader was a dead attribute pretending to be a spinner.
/// Marked `pending` (dim, italic) until the status board lands (increment 06).
/// The route it will serve rides as `data-panel` — a machine-readable
/// attribute, because the most prominent slot on the page is no place for a
/// sentence about mounting.
fn root(ctx: &mut Ctx) -> Response {
    let mut panels = FragmentBuilder::new("div").id("panels");
    for path in &ctx.panels {
        panels = panels.child(
            FragmentBuilder::new("div")
                .class("panel pending")
                .attr("data-panel", path)
                .text("This panel arrives in a later update.")
                .build(),
        );
    }
    let page = FragmentBuilder::new("div")
        .id("dashboard")
        .child(FragmentBuilder::new("h1").text("HARNESS").build())
        .child(panels.build())
        .build();
    html(200, page.into_html())
}
