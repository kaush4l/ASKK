//! The workspace's FILES, as a person browses them (15G).
//!
//! We run a real x86 Alpine in the page — the one thing this product has that
//! WebContainers categorically cannot do — and a person could not see a byte
//! of it without typing `ls`. This module is that folder, listed, and one file
//! in it, read.
//!
//! It owns no new capability and no new way to reach the disk. A listing is
//! `list_files` and a file is `read_file` — the agent's own two tools, through
//! the same gate in `core::workspace`, recorded as the same `ToolInvoked`
//! facts (I8): if the agent listed a folder, this pane shows what it saw.

use kernel::{CapabilityId, EventKind, ModuleId, Request, Response, Version};
use module::{DataSchema, Manifest, RouteSpec, Tier};

use crate::browsable::{browsable, nothing_to_browse};
use crate::dispatch::{error_fragment, html, Ctx};
use crate::filelist::{opened, panel, parent};
use crate::filerows::rows;
use crate::form::form_value;

/// A person asked for a path. Its own fact kind for the terminal's reason: the
/// async half does the I/O, and nothing may mistake this for the agent's own.
pub(crate) const OPEN_REQUEST: &str = "core.files_request";

/// A person SAVED a file. A separate kind from opening one, because it is a
/// separate authority: reading the workspace and writing to it are two things
/// to be able to do, and one spelling cannot answer "who changed this".
pub(crate) const SAVE_REQUEST: &str = "core.files_save";

pub(crate) fn manifest() -> Manifest {
    Manifest {
        id: ModuleId("files".into()),
        name: "Files".into(),
        version: Version(1),
        description: "The folder: what is in it, and what one file says.".into(),
        // Clock, so a pane queued behind a running command can say how long
        // it has been waiting on it (R11-1a). Injected, never read (I7).
        capabilities: vec![CapabilityId::Clock, CapabilityId::Emit, CapabilityId::Workspace],
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
    let who = match req.header("x-agent").unwrap_or_default() {
        "" => ctx.me.clone(),
        named => named.to_string(),
    };
    // A read shows nothing; a WRITE is refused, because a save that cannot
    // land is an error and not a state.
    let refused = browsable(ctx, &who).err();
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/files") if refused.is_some() => nothing_to_browse(&refused.unwrap_or_default()),
        // `x-at` scopes the projection to ONE FOLDER, so a second pane over
        // the same workspace (the artifacts shelf) does not overwrite this
        // one every time either refreshes — which is exactly what happened:
        // the shelf's `ls artifacts` on a fresh workspace replaced the Files
        // pane's whole listing with a shell error (R4-2). Absent still means
        // "whatever was listed last", for a caller that has no folder yet.
        ("GET", "/files") => {
            let at = req.header("x-at").map(str::to_string);
            listing(html(200, panel(ctx, at.as_deref())), ctx, at.as_deref())
        }
        // A body with `contents` is a SAVE; without one it is an open. Same
        // route because it is the same subject — this file, in this workspace
        // — and the pane already has the path in hand either way.
        ("POST", _) if refused.is_some() => error_fragment(400, &refused.unwrap_or_default()),
        ("POST", "/files") if form_value(&req.body, "contents").is_some() => save(req, ctx),
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
    // …and WHETHER THE WORKSPACE HAS MOVED UNDER IT (R14-P1-3): the count of
    // facts that could have changed what an `ls` would print. The pane asked
    // for a fresh listing on the agent's status stamp, which a command a PERSON
    // types never moves — so a file written from the Commands box was invisible
    // in the pane beside it until something else happened. Same contract as
    // `x-entries`: a fact the UI needs, on a header, not parsed out of markup.
    response.headers.push((
        "x-workspace-at".into(),
        crate::filelist::changes(ctx).to_string(),
    ));
    response
}

/// Save what the editor holds, through the agent's own `write_file`. The
/// answer to THIS request is the pane as it is now; the write happens in the
/// async half, and the re-read that follows it is what the pane will show —
/// which is the difference between a save and a hope.
fn save(req: &Request, ctx: &mut Ctx) -> Response {
    let (Some(path), Some(contents)) = (
        form_value(&req.body, "path"),
        form_value(&req.body, "contents"),
    ) else {
        return error_fragment(400, "files: a save needs a path and contents");
    };
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::Custom {
            kind: SAVE_REQUEST.into(),
            payload_json: serde_json::to_string(&(path.clone(), contents)).unwrap_or_default(),
        }),
        None => return error_fragment(500, "files: Emit capability not granted"),
    }
    // `x-at` is a FOLDER (R4-2), so a file scopes to the folder holding it —
    // the one the pane that asked is showing.
    let scope = Some(parent(&path));
    let mut response = listing(html(200, panel(ctx, scope)), ctx, scope);
    response.headers.push(("x-saving".into(), "1".into()));
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
    match ctx.emit.as_mut() {
        Some(buf) => buf.push(EventKind::Custom {
            kind: OPEN_REQUEST.into(),
            payload_json: serde_json::to_string(&(path.clone(), folder)).unwrap_or_default(),
        }),
        None => return error_fragment(500, "files: Emit capability not granted"),
    }
    // The folder this request is about: the one being opened, or the one the
    // file being opened lives in (R4-2).
    let scope = Some(match folder {
        true => path.as_str(),
        false => parent(&path),
    });
    let mut response = listing(html(200, panel(ctx, scope)), ctx, scope);
    response.headers.push(("x-opening".into(), "1".into()));
    response
}
