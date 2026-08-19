//! The G4 built-in modules: manifests (registered at boot through the one
//! install path, ADR-004) and their tier-0 handlers (named ONLY from
//! `dispatch::builtin_entry`). Fragments are composed exclusively through
//! the escaping view primitives — no raw HTML strings.

use kernel::{CapabilityId, ModuleId, Request, Response, Version};
use module::view::FragmentBuilder;
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};

/// Everything boot installs. Order is install order (and thus event order).
pub(crate) fn manifests() -> Vec<Manifest> {
    vec![
        Manifest {
            id: ModuleId("dashboard".into()),
            name: "Dashboard".into(),
            version: Version(1),
            description: "The root page: its one heading.".into(),
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
        crate::chat::pane::manifest(),
        crate::agents::pane::manifest(),
        crate::tools::manifest(),
        crate::files::pane::manifest(),
        crate::board::pane::manifest(),
        crate::space::pane::manifest(),
        crate::terminal::pane::manifest(),
        crate::proc::pane::manifest(),
        Manifest {
            id: ModuleId("status".into()),
            name: "Status".into(),
            version: Version(1),
            description: "One panel: what is running, when, how many facts.".into(),
            capabilities: vec![CapabilityId::Clock],
            routes: vec![route("GET", "/panels/status")],
            // No slot. The slot put a placeholder reading "This panel arrives
            // in a later update" directly under the H1, framed like a real
            // panel, for twelve increments — the best position on the page,
            // held by a promise the plan has now finished not keeping (12 walk,
            // finding 3). The route stays; nothing composes it into the page.
            slots: vec![],
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

/// The page's masthead: its one `<h1>`, and nothing else. Every panel on this
/// page is mounted by the component that owns it; the placeholder that used to
/// stand here for a panel "arriving in a later update" is gone with the plan
/// that promised it (12 walk, finding 3).
fn root(_ctx: &mut Ctx) -> Response {
    let page = FragmentBuilder::new("div")
        .id("dashboard")
        .child(FragmentBuilder::new("h1").text("HARNESS").build())
        .build();
    html(200, page.into_html())
}

/// Minimal `application/x-www-form-urlencoded` decoding, for the handlers
/// above and the panes that post to them. Here because a built-in handler's
/// only wire format is a form body, and this is where those handlers live.
/// Minimal application/x-www-form-urlencoded value extraction ('+' and %XX).
pub(crate) fn form_value(body: &str, key: &str) -> Option<String> {
    body.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| percent_decode(v))
    })
}

fn percent_decode(s: &str) -> String {
    fn hex(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(hi), Some(lo)) => {
                    out.push(hi * 16 + lo);
                    i += 2;
                }
                _ => out.push(b'%'),
            },
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
