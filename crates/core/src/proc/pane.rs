//! WHAT IS RUNNING, on screen. A person watching an agent work should not have
//! to ask it what it started.
//!
//! It owns no capability and no new way to reach the disk, exactly as the Files
//! pane does not: a refresh is the agent's own `list_processes` going through
//! the gate in `core::workspace`, recorded as the same `ToolInvoked` fact (I8),
//! and a Stop is that same gate's `stop_process`. What the pane shows is
//! therefore what the AGENT was told — one table, one reading of it
//! (`proc::table::rows`), so the pane and the model can never disagree about which
//! processes exist.
//!
//! THE ROWS LEAVE ON A HEADER (R10-1). They used to leave as a `<pre>` of the
//! table, which put a 1770px block of fixed-width text in a 254px rail: 86% of
//! it off-screen, and the `command` column — the only thing saying which process
//! a row IS — never visible. The pane draws a row per process now, so the shape
//! comes from `x-procs` in the tab-separated form `x-entries` already uses for
//! the folder listing, and the fragment carries only what has no row.
//!
//! `rows.rs` owns the projection — which listing, which state, which rows — so
//! this file owns the module and its two routes, the same split `files/pane.rs`
//! and `files/listing.rs` have.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::files::permitted::{browsable, nothing_to_browse};
use crate::dispatch::{error_fragment, html, Ctx};
use crate::builtins::form_value;
use crate::proc::rows::panel;

/// What the pane asked the workspace to DO: refresh the listing, or stop one
/// process and then refresh. Its own fact kind for the terminal's reason — the
/// async half does the I/O, and nothing may mistake this for the agent's own
/// decision to look. The payload is the process to stop, or `""` for a plain
/// refresh: one gesture, one fact, and the stop's own `ToolInvoked` follows it.
pub(crate) const PANE_REQUEST: &str = "core.processes_request";

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("processes".into()),
        name: "Processes".into(),
        version: Version(1),
        description: "What the agent has started and left running.".into(),
        // CLOCK, because a running process's age has to move (R10-3): the
        // listing is minutes old by the time it is read again, and the number
        // beside a live process is only true when it is measured from now.
        capabilities: vec![CapabilityId::Emit, CapabilityId::Workspace, CapabilityId::Clock],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/processes".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/processes".into(),
            },
        ],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/processes/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn processes(req: &Request, ctx: &mut Ctx) -> Response {
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.clone(),
        named => named.to_string(),
    };
    // The same gate the Files pane meets, for the same reason: a listing here
    // is a call in THIS agent's workspace, and an agent with no space has none.
    let refused = browsable(ctx, &who).err();
    match (req.method.as_str(), refused) {
        ("GET", Some(why)) => nothing_to_browse(&why),
        ("GET", None) => served(ctx),
        ("POST", Some(why)) => error_fragment(400, &why),
        ("POST", None) => asked(req, ctx),
        _ => error_fragment(404, "processes: unknown subroute"),
    }
}

/// The panel, with its rows on the header the pane reads them off.
fn served(ctx: &Ctx) -> Response {
    let (body, rows) = panel(ctx);
    let mut response = html(200, body);
    response.headers.push(("x-procs".into(), rows));
    response
}

/// Ask the workspace to stop one, or just to look again. Emitted as a fact and
/// performed in the async half, exactly as a typed command is; the answer to
/// THIS request is the panel as it stands, so nothing looks swallowed while the
/// work happens.
fn asked(req: &Request, ctx: &mut Ctx) -> Response {
    let stop = form_value(&req.body, "stop").unwrap_or_default();
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::Custom {
            kind: PANE_REQUEST.into(),
            payload_json: serde_json::to_string(&stop).unwrap_or_else(|_| "\"\"".into()),
        }),
        None => return error_fragment(500, "processes: Emit capability not granted"),
    }
    let mut response = served(ctx);
    response.headers.push(("x-refreshing".into(), "1".into()));
    response
}
