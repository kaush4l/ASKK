//! WHAT THE WORKSPACE IS, DECLARED — the guest image as a value the machine
//! can read, so the prose about it can be checked against something (I16).
//!
//! The complete inventory of this guest lived in `image/Dockerfile:25-40` as a
//! COMMENT: correct, argued line by line, naming the caller of every applet —
//! and unreadable by the model it describes and by the suite that certifies
//! the tree. That is the shape I16 names as the defect to fix first: a truth
//! held only in prose is a truth that will drift, because nothing can fail
//! when it does. This file is that comment turned into something a test can
//! hold, and `tests/stated.rs` is the test that holds it.
//!
//! **WHY THIS IS RUST AND NOT `public/*.json`.** The stage briefs became data
//! in the T1 round, and the reason was a rate of change: a prompt is edited by
//! watching a model answer, one wording at a time, and it must be possible to
//! ship a better sentence without a rebuild. Nothing here has that property.
//! What is written down below is the content of a COMPILED ARTIFACT — the
//! guest image, built from `image/Dockerfile`, frozen by the owner, and
//! shipped as bytes under `web/c2w/`. It cannot change without a rebuild, so
//! it must not be editable without one. A JSON file beside it would offer
//! exactly one new capability: to state, without recompiling, that the guest
//! has a compiler. Different rate of change, different home — the same
//! reasoning `docs/STATUS.md` records for T1, applied to a fact that moves the
//! other way.
//!
//! **THE HONEST LIMIT (I16's own closing paragraph).** Checking prose against
//! this file is not checking this file against the image. Only a build can
//! settle that, and the build is frozen. What is closed here is the gap
//! between what we SAY and what we have WRITTEN DOWN; the gap between what we
//! have written down and what we ship stays open, and naming it is part of the
//! job.

use crate::toolbox::Toolbox;

/// One thing that is true of the workspace, and the sentence that says it.
///
/// The `id` is for the machine — `tests/stated.rs` reports which fact went
/// unrendered by name — and `says` is the model's, verbatim. One struct rather
/// than a bare string because a fact nobody can name is a fact nobody can
/// prove reached the model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fact {
    pub id: &'static str,
    pub says: String,
}

/// Whether what is written in the workspace is still there after a reload.
///
/// FALSE, permanently, by the owner's ruling of 2026-08-20 — the container's
/// root is an overlay on tmpfs, so a reload is a fresh guest. It is stated
/// here as well as by `WorkspacePort::durable` so that the two can be asserted
/// to AGREE (`crates/core/tests/guest_truth.rs`): a port that starts keeping
/// files while this file still says it does not is exactly the drift I16 is
/// about.
pub const DURABLE: bool = false;

/// THE CLAUSE BOTH READERS GET, once, so the 26-walk can be asserted instead of
/// argued. `components::space::folder` builds the model's sentence out of it and
/// `ui::proc`/`ui::settings::linux_engine` print it to the person; a test on each
/// side pins its own text to THIS string, so a rewording that reaches one reader
/// and not the other cannot compile green. It is the shared HALF of the claim,
/// not the whole sentence — the two sides end differently on purpose, because a
/// person can copy a file out of that folder and a model cannot.
pub const MEMORY: &str = "keeps its filesystem in memory";

/// EVERY BINARY THE GUEST HAS, from `image/Dockerfile:25-40`, which is the
/// source of truth and stays it. There is no `apk add` line in that file:
/// every name below is a busybox applet or an ash builtin already in the
/// Alpine minirootfs, and whatever is not here does not exist — the guest has
/// no network, so nothing can be installed at runtime either.
///
/// Grouped the way the Dockerfile groups them, by the job they were kept for,
/// because a flat alphabetical list is the one shape that hides what is
/// missing. `echo` is the one name here the Dockerfile's list does not carry:
/// it is an ash builtin exactly as `set`, `printf`, `test`, `kill` and `wait`
/// are, and `proc/convention.rs`'s own liveness script calls it.
pub const BINARIES: [&str; 28] = [
    // The shell and its builtins (adapters_web/src/c2w.js, core/src/proc).
    "sh", "set", "test", "printf", "echo", "kill", "wait", "stty",
    // Files and folders (kernel/workspace.rs, core/src/proc/start.rs).
    "cat", "base64", "mkdir", "dirname", "basename", "ls", "rm", "df",
    // Finding and reading (core/src/findfiles.rs, core/src/proc/watch.rs).
    "find", "grep", "head", "tail", "wc", "cut", "tr", "awk",
    // The machine and the clock (core/src/observe.rs, core/src/proc/start.rs).
    "uname", "pwd", "date", "sleep",
];

/// The names this guest does NOT have, said out loud.
///
/// Said rather than left to inference, because that is the whole of I16: a
/// model told nothing about a constraint does not treat it as unknown, it
/// treats it as absent and plans accordingly — and every one of these is a
/// thing a model reaches for by habit on the second turn. They are the six
/// `image/Dockerfile:40` names, in its own words.
pub const ABSENT: [&str; 6] = ["python3", "node", "git", "curl", "make", "compiler"];

/// WHAT THIS AGENT'S WORKSPACE IS, as the facts that are true FOR THIS GRANT.
///
/// A function of the toolbox and not a constant, for the reason
/// `components::space::folder` is one (I15): an agent granted no workspace
/// tool has no workspace to be told about, and the block is absent rather than
/// describing a folder nobody in this turn can reach. The toolbox handed in is
/// the STAGE's, not the agent's, so the strategy vote — which is granted
/// nothing — is told nothing (T25's rule, applied here from the start).
///
/// Every fact returned is rendered by [`lines`], and `tests/stated.rs` asserts
/// each one reaches an actual prompt. Adding a fact here is therefore the
/// whole of adding a fact to the prompt; there is no second list to keep in
/// agreement with this one.
pub fn facts(tools: &Toolbox) -> Vec<Fact> {
    if !tools.tools.iter().any(|t| crate::workspace::is_workspace_tool(&t.name)) {
        return Vec::new();
    }
    vec![
        fact("cwd", CWD.into()),
        fact("queue", QUEUE.into()),
        fact("network", network(tools)),
        fact("binaries", binaries()),
    ]
}

/// The `## environment` block's workspace half: one line per fact, or nothing
/// at all. Nothing at all is the honest rendering for an agent with no
/// workspace — an empty heading spends budget saying that a thing is absent.
pub fn lines(tools: &Toolbox) -> String {
    let facts = facts(tools);
    match facts.is_empty() {
        true => String::new(),
        false => facts.iter().map(|f| f.says.as_str()).collect::<Vec<_>>().join("\n"),
    }
}

fn fact(id: &'static str, says: String) -> Fact {
    Fact { id, says }
}

/// Each call is `mkdir -p -- <root> && cd <root> && ( <command> )`
/// (`adapters_web/src/c2w.rs::exec`), so the command runs in a subshell of a
/// shell that was `cd`'d for it — a directory change cannot outlive the call
/// that made it, and neither can an exported variable.
///
/// Every line here opens with a KEY, because the block it joins is written in
/// keys (`current time:`, `day:`, `device:`) and a paragraph dropped into a
/// list reads as an aside. The path is deliberately not repeated: `## space`
/// renders it, and one fact in two blocks is two things to keep in agreement.
const CWD: &str = "linux: a real Linux, in this browser, that runs the commands you send \
                   it. Every command starts in your space's folder, and changing directory \
                   or exporting a variable does not carry into the next call — write whole \
                   paths, or chain one command onto the next.";

/// One PTY, one `/bin/sh`, one promise chain (`c2w.js`'s `queue`): a second
/// guest would be a second ~578 MiB, so isolation was refused — and T49 is
/// that the SCHEDULING cost of that refusal was nowhere on screen or in the
/// prompt. It is here now.
const QUEUE: &str = "one shell: there is a single shell in there, shared by every agent in \
                     this browser, so commands queue — yours waits for whatever is already \
                     running, and a long one holds up everybody else's.";

// THE `durable()` FACT IS NOT SAID HERE, and a test decided that rather than an
// argument. It belongs to `components::space`, which renders whenever there IS a
// folder to describe. This list is a function of the TOOLBOX, so it says nothing
// at all for an agent that has a folder and no workspace tools — the shipped
// `critic` exactly — and a substrate sentence placed here described that agent's
// folder without its one important property. `DURABLE` below still pins the
// declaration against the port; only the WORDING lives in the other component,
// once, which is `is_loopback`'s rule applied to a sentence.

/// THE GUEST HAS NO NETWORK, and the way out of the browser is a tool rather
/// than a command. The second sentence is earned by the grant, exactly as the
/// space block's reader clauses are: an agent without `web_search` is told the
/// constraint and not offered a door it does not hold (I15).
fn network(tools: &Toolbox) -> String {
    let out = match tools.get(crate::search::WEB_SEARCH).is_some() {
        true => " `web_search` is the way out of this browser, and it is a tool you call, \
                 not a command you run.",
        false => "",
    };
    format!(
        "network: none. Nothing can be installed in there and nothing can be \
         downloaded, whatever a command's own help page says.{out}"
    )
}

/// The inventory, as one sentence. Generated from [`BINARIES`] and [`ABSENT`]
/// so that the list the model reads cannot fall behind the list the tests
/// check the prose against — they are the same list.
fn binaries() -> String {
    format!(
        "installed: busybox and nothing else — {}. There is no {} and no {}.",
        BINARIES.join(", "),
        ABSENT[..ABSENT.len() - 1].join(", no "),
        ABSENT[ABSENT.len() - 1]
    )
}
