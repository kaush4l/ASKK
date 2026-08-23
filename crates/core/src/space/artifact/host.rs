//! The ACTION half of the artifacts faculty: `record_artifact` and
//! `read_artifact`, run. `agent::Shelf` decides what a call means and what it
//! says back; this performs the ONE store operation the decision asked for and
//! the ONE port call each tool needs.
//!
//! **THERE IS NO SECOND FILE READER HERE AND NO SECOND PATH RULE.** Both tools
//! resolve a name through `agent::relative_path` — the same function the
//! workspace gate uses (`crates/core/src/workspace/gate/files.rs:41-44`), which
//! is what stops an artifact name walking out of the space's folder — and both
//! read through the port's window reader, increment 3's `read_range`.
//!
//! **A WINDOW IS A REQUEST, NOT A SECOND READER**, and this file obeys that
//! ruling rather than restating it: `gate::files::window`
//! (`crates/core/src/workspace/gate/files.rs:72-89`) settled that a call with no
//! window asked for goes to `WorkspacePort::read` and one with a window goes to
//! `read_range`, because `read`'s default IS `read_range(_, _, 0, 0)` and an
//! adapter with a cheaper path OVERRIDES `read`. Routing everything through
//! `read_range` walks straight past those overrides — the files pane started
//! reading a command instead of a file when that was done there, and this file
//! reproduced the same defect on its first draft: `FakeShell` overrides `read`
//! and not `read_range`, so `record_artifact` measured the length of an echoed
//! shell command and called it a file size. The gate caught it, which is the
//! whole point of measuring one.
//!
//! Why `record_artifact` reads the file at all: that read IS the existence
//! check and the size in one call. Asking `wc -c` beside it would be a second
//! command with a second path in it, which is the duplication the paragraph
//! above exists to prevent. What the three answers MEAN — a file that is not
//! there, a port that will not answer, a file that is — is `super`'s header and
//! `agent::artifact`'s.

use std::cell::RefCell;
use std::rc::Rc;

use agent::{Artifact, Shelf};
use context::Args;
use kernel::{EventKind, KvStore, ToolId, WorkspacePort};

use crate::app::App;
use crate::space::artifact::{load, write};

/// Everything one call needs, taken in ONE borrow that ends with it — a borrow
/// held across an await panics the next `borrow_mut`, and `space::shared::run`
/// states why there always is a next one.
struct Where {
    spaces: Rc<dyn KvStore>,
    port: Rc<dyn WorkspacePort>,
    me: String,
    space: String,
    root: String,
}

fn about(app: &Rc<RefCell<App>>) -> Option<Where> {
    let a = app.borrow();
    let space = a.agent.space.clone()?;
    Some(Where {
        spaces: Rc::clone(&a.ports.spaces),
        port: Rc::clone(&a.ports.workspace),
        me: a.me().to_string(),
        root: space.path(),
        space: space.name,
    })
}

/// Run one of the shelf's tools. Reached through `tools::tool_entry`, which
/// routes every name `agent::is_artifact_tool` claims here. `None` means this
/// call was not run — a name that is not one of the two, or an agent with no
/// space at all — and the local table answers it, refusing in both cases.
pub(crate) async fn run(
    app: &Rc<RefCell<App>>,
    tool: &ToolId,
    args_json: &str,
) -> Option<EventKind> {
    if !agent::is_artifact_tool(&tool.0) {
        return None;
    }
    let at = about(app)?;
    let args = Args::parse(args_json);
    let outcome = match tool.0.as_str() {
        name if name == agent::READ_ARTIFACT => read(&at, &args).await,
        _ => record(&at, &args).await,
    };
    let (ok, output) = match outcome {
        Ok(said) => (true, said),
        Err(said) => (false, said),
    };
    Some(EventKind::ToolInvoked {
        tool: tool.clone(),
        args: args_json.to_string(),
        ok,
        output,
    })
}

/// Put one artifact on the shelf. `name`, `kind` and `audience` are NAMES — an
/// identifier for a place and two short labels, where surrounding space is a
/// typo; `description` is TEXT, because it is what the group is being told.
/// That is `space::shared::run`'s split, applied by the same rule.
async fn record(at: &Where, args: &Args) -> Result<String, String> {
    let asked = args.name("name").unwrap_or_default();
    let bytes = match asked.is_empty() {
        // The pure half refuses a blank name in words; there is no path to
        // look at yet, so nothing is asked of the port.
        true => None,
        false => confirm(at, &agent::relative_path(asked)?).await?,
    };
    let draft = Artifact {
        name: asked.to_string(),
        kind: args.name("kind").unwrap_or_default().to_string(),
        description: args.text("description").unwrap_or_default().to_string(),
        audience: args.name("audience").unwrap_or_default().to_string(),
        bytes,
        ..Artifact::default()
    };
    let mut shelf = load(at.spaces.as_ref(), &at.space).await;
    let (said, recorded) = shelf.record(&at.space, &at.me, draft);
    // A REFUSAL IS NOT A SUCCESS — the flag every projection colours by. The
    // words stay exactly as the pure half wrote them; only the side changes
    // (`space::shared::run`'s ruling, and `memory::host`'s).
    let Some(artifact) = recorded else {
        return Err(said);
    };
    match write(at.spaces.as_ref(), &at.space, &artifact).await {
        Ok(()) => Ok(said),
        // A record nobody else can read is not something the group has.
        Err(problem) => Err(format!("{said}\n(but the shelf could not be saved: {problem})")),
    }
}

/// THE EXISTENCE CHECK, AND THE ONE PLACE THE CROSS-THREAD RULING IS ENFORCED.
/// Three answers, three meanings (`agent::artifact`'s header):
///
/// - the port read it → `Some(size)`, and the catalog states that number;
/// - the port answered and the file is not there → REFUSED, in words naming
///   the fix, because recording a file that does not exist puts a name on
///   everybody's shelf that nobody can open;
/// - the port would not answer at all (a sub-agent's Worker, which gets a
///   `C2wWorkspace` that refuses) → `None`, recorded, and the catalog says
///   `unconfirmed` rather than claiming a size nobody measured.
async fn confirm(at: &Where, path: &str) -> Result<Option<u64>, String> {
    // NO WINDOW IS ASKED FOR, so this is `read` and not `read_range(_, _, 0, 0)`
    // — the header says why, and the difference is an adapter's own override.
    match at.port.read(&at.root, path).await {
        Ok(read) if read.status == 0 => Ok(Some(read.output.len() as u64)),
        Ok(read) => Err(format!(
            "Nothing recorded: there is no '{path}' in this space's workspace folder, so \
             there would be nothing for anyone to open. The workspace said: {}\nWrite the \
             file first, then record it.",
            read.output.trim()
        )),
        Err(_) => Ok(None),
    }
}

/// Read one artifact by name. The window is the model reaching for LESS of a
/// file it already knows the name of, read through `Args::whole` — the ONE
/// reader for a number the model wrote (`crates/core/tests/onereader.rs`).
async fn read(at: &Where, args: &Args) -> Result<String, String> {
    let shelf: Shelf = load(at.spaces.as_ref(), &at.space).await;
    let asked = args.name("name").unwrap_or_default();
    let Some(artifact) = shelf.find(asked) else {
        return Err(format!(
            "Nothing on the {} shelf is called '{asked}'. It holds: {}",
            at.space,
            shelf.names()
        ));
    };
    let path = agent::relative_path(&artifact.name)?;
    let window = (args.whole("offset").unwrap_or(0), args.whole("limit").unwrap_or(0));
    let read = match window {
        (0, 0) => at.port.read(&at.root, &path).await,
        (offset, limit) => at.port.read_range(&at.root, &path, offset, limit).await,
    };
    match read {
        Ok(read) => Ok(read.output),
        Err(problem) => Err(crate::workspace::gate::unavailable(problem)),
    }
}
