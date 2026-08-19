//! A workspace on the host: no browser, no Linux, no Wasm (I3). It records
//! every command with the directory it was told to run in — which is the whole
//! point of the capability gate — and keeps files in a map so a test can assert
//! that what an agent wrote is what it reads back.
//!
//! `read`/`write`/`list` are OVERRIDDEN rather than left to the trait's
//! shell-command defaults: there is no shell here to run `cat`. The defaults
//! themselves are what the browser check exercises against real busybox.

use std::cell::RefCell;
use std::collections::BTreeMap;

mod port;

use kernel::WorkspaceError;

/// A fake Linux. `unavailable` is the I15 case: a browser where no workspace
/// can start, which must degrade and never break.
#[derive(Debug, Default)]
pub struct FakeShell {
    pub(crate) ran: RefCell<Vec<(String, String)>>,
    pub(crate) files: RefCell<BTreeMap<String, String>>,
    pub(crate) unavailable: Option<String>,
    /// Canned answers, as `(marker, status, output)`. A shell that can only
    /// echo the command back cannot test a tool that PARSES what a command
    /// printed — and the process, observation and search tools all do, on
    /// purpose (a model must never be handed `ps aux` to read). The first
    /// marker found in the command wins; anything unmatched still echoes.
    pub(crate) answers: RefCell<Vec<(String, i32, String)>>,
    /// A command containing this NEVER ANSWERS. The one thing a canned answer
    /// cannot express and the state this whole round is about: a foreground
    /// `while true` holds the workspace, and everything queued behind it — the
    /// panes, the trace, the status pill — has to say so rather than describe a
    /// fetch that will never land.
    pub(crate) wedge: Option<String>,
    /// A command containing this comes back as `WorkspaceError::Failed` with
    /// this message — the ONLY shape either engine has for an ending that was
    /// not an exit status, which is how a stop a person asked for arrives
    /// (R17-P1-6) as well as how a real breakage does.
    pub(crate) fails: Option<(String, String)>,
    /// Whether this workspace claims it can end a running command, and how
    /// often it was asked to. `None` is the trait's own default (no way in).
    pub(crate) interrupt: Option<kernel::Interrupt>,
    pub(crate) stops: RefCell<usize>,
    /// Whether a reload keeps what was written. `false` — the DEFAULT — is
    /// container2wasm, which is the only engine that ships: its filesystem is
    /// in memory and nothing written in it survives a reload. It used to
    /// default to `true`, so the whole suite's baseline was a machine this
    /// product cannot be, and every consumer's durable arm was asserted as the
    /// norm. A test that wants persistence now asks for it by name.
    pub(crate) keeps: bool,
}

impl FakeShell {
    pub fn new() -> FakeShell {
        FakeShell::default()
    }

    /// A fake disk with files already on it. `path` is what the port will be
    /// GIVEN — root and all — because that is the key `read` and `list` use.
    pub fn holding(files: &[(&str, &str)]) -> FakeShell {
        let shell = FakeShell::default();
        for (path, contents) in files {
            shell
                .files
                .borrow_mut()
                .insert((*path).to_string(), (*contents).to_string());
        }
        shell
    }

    /// A browser with no workspace at all, and the reason why.
    pub fn unavailable(reason: &str) -> FakeShell {
        FakeShell {
            unavailable: Some(reason.to_string()),
            ..FakeShell::default()
        }
    }

    /// Answer any command CONTAINING `marker` with this status and output.
    /// Later answers are tried first, so a test can override a general one.
    pub fn answering(self, marker: &str, status: i32, output: &str) -> FakeShell {
        self.answers
            .borrow_mut()
            .push((marker.to_string(), status, output.to_string()));
        self
    }

    /// Any command CONTAINING `marker` never comes back — the wedge (R11-1).
    pub fn wedging(mut self, marker: &str) -> FakeShell {
        self.wedge = Some(marker.to_string());
        self
    }

    /// Any command CONTAINING `marker` comes back as a port failure carrying
    /// `message` — a stop, or a broken machine.
    pub fn failing(mut self, marker: &str, message: &str) -> FakeShell {
        self.fails = Some((marker.to_string(), message.to_string()));
        self
    }

    /// …and one a reload does NOT rebuild from nothing. No shipped engine
    /// answers this way; it exists so a test ABOUT durability can say which
    /// world it is in out loud, instead of inheriting it — and so the arms
    /// `docs/ALIGNMENT.md` §1 keeps for backlog 14 stay reachable.
    ///
    /// NOT `durable()`, which is what it says: an inherent method of that name
    /// would shadow `WorkspacePort::durable` at every call site on a concrete
    /// `FakeShell` — same name, one returning the fixture and one the fact.
    pub fn keeping(mut self) -> FakeShell {
        self.keeps = true;
        self
    }

    /// …and a workspace that says a Stop would really end one, like c2w's PTY.
    pub fn interruptible(mut self, how: kernel::Interrupt) -> FakeShell {
        self.interrupt = Some(how);
        self
    }

    /// How many times the page asked this workspace to stop a command.
    pub fn stops(&self) -> usize {
        *self.stops.borrow()
    }

    /// Every command run, as `(cwd, command)`, in order.
    pub fn ran(&self) -> Vec<(String, String)> {
        self.ran.borrow().clone()
    }

    /// What is on this fake disk, as `(path, contents)` — the path is the one
    /// the port was given, root and all.
    pub fn files(&self) -> Vec<(String, String)> {
        self.files.borrow().iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub(crate) fn at(&self, cwd: &str, path: &str) -> String {
        format!("{}/{}", cwd.trim_end_matches('/'), path)
    }

    pub(crate) fn refuse<T>(&self) -> Option<Result<T, WorkspaceError>> {
        self.unavailable.as_ref().map(|reason| {
            Err(WorkspaceError::Unavailable {
                reason: reason.clone(),
            })
        })
    }
}
