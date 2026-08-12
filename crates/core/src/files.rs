//! The workspace's FILES, as a person browses them (15G).
//!
//! We run a real x86 Alpine in the page — the one thing this product has that
//! WebContainers categorically cannot do — and until now a person could not
//! see a single byte of it without typing `ls` into a terminal. This module is
//! that folder, listed, and one file in it, read.
//!
//! It owns no new capability and no new way to reach the disk. A listing is
//! the `list_files` tool and a file is the `read_file` tool — the same two the
//! agent calls, through the same gate in `core::workspace`, recorded as the
//! same `ToolInvoked` facts. The pane is a PROJECTION of those facts (I8): if
//! the agent listed a folder, this pane shows what the agent saw.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::dispatch::{error_fragment, html, Ctx};
use crate::filelist::{opened, panel, rows};
use crate::form::form_value;

/// A person asked for a path. Its own fact kind for the reason the terminal's
/// is: the async half does the I/O, and nothing else may mistake this for
/// something the agent decided to do.
pub(crate) const OPEN_REQUEST: &str = "core.files_request";

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("files".into()),
        name: "Files".into(),
        version: Version(1),
        description: "The workspace folder: what is in it, and what one file says.".into(),
        capabilities: vec![CapabilityId::Emit, CapabilityId::Workspace],
        routes: vec![
            RouteSpec {
                method: "GET".into(),
                path: "/files".into(),
            },
            RouteSpec {
                method: "POST".into(),
                path: "/files".into(),
            },
        ],
        slots: vec![],
        section: None,
        schema: DataSchema {
            kv_prefix: "mod/files/".into(),
            version: 1,
        },
        tier: Tier::T0Rust,
        tests: vec![],
    }
}

/// Named ONLY from `dispatch::builtin_entry` (ADR-004).
pub(crate) fn files(req: &Request, ctx: &mut Ctx) -> Response {
    match (req.method.as_str(), req.path.as_str()) {
        // `x-at` scopes the projection to ONE folder, so a second pane over
        // the same workspace (the artifacts shelf) does not overwrite this
        // one every time either refreshes. Absent means "whatever was listed
        // last", which is what the Files pane itself wants — it follows the
        // agent's own listings.
        ("GET", "/files") => {
            let at = req.header("x-at").map(str::to_string);
            listing(html(200, panel(ctx, at.as_deref())), ctx, at.as_deref())
        }
        ("POST", "/files") => open(req, ctx),
        _ => error_fragment(404, "files: unknown subroute"),
    }
}

/// The entries, as a header the pane turns into one button each. Same contract
/// `x-turn` and `x-typeable` already follow: a fact the UI needs, said in a
/// header rather than parsed back out of a fragment.
fn listing(mut response: Response, ctx: &Ctx, at: Option<&str>) -> Response {
    response.headers.push(("x-entries".into(), rows(ctx, at)));
    response.headers.push(("x-file".into(), opened(ctx, at)));
    response
}

/// Ask for a path. Emitted as a fact and performed in the async half, exactly
/// as a typed command is — the answer to THIS request already shows the path
/// as pending, so nothing looks swallowed while the listing runs.
fn open(req: &Request, ctx: &mut Ctx) -> Response {
    let Some(path) = form_value(&req.body, "path") else {
        return error_fragment(400, "files: no path");
    };
    // WHICH tool this is. `ls` on a file SUCCEEDS — it prints the file — so
    // "list, and read if the listing failed" opened nothing and re-listed
    // everything. The listing that offered this path already said which it is
    // (a trailing slash from `ls -1Ap`), so the pane says so too rather than
    // making the core guess from a name.
    let folder = form_value(&req.body, "kind").as_deref() != Some("file");
    if ctx.space.is_none() {
        return error_fragment(
            400,
            "This agent works alone, so it has no workspace to browse: the folder belongs to a \
             space. Add `space: <name>` to its agent.md to put it in one.",
        );
    }
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::Custom {
            kind: OPEN_REQUEST.into(),
            payload_json: serde_json::to_string(&(path.clone(), folder)).unwrap_or_default(),
        }),
        None => return error_fragment(500, "files: Emit capability not granted"),
    }
    let scope = Some(path.as_str());
    let mut response = listing(html(200, panel(ctx, scope)), ctx, scope);
    response.headers.push(("x-opening".into(), "1".into()));
    response
}
