//! A workspace on the host: no browser, no Linux, no CheerpX (I3). It records
//! every command with the directory it was told to run in — which is the whole
//! point of the capability gate — and keeps files in a map so a test can assert
//! that what an agent wrote is what it reads back.
//!
//! `read`/`write`/`list` are OVERRIDDEN rather than left to the trait's
//! shell-command defaults: there is no shell here to run `cat`. The defaults
//! themselves are what the browser check exercises against real busybox.

use std::cell::RefCell;
use std::collections::BTreeMap;

use kernel::{BoxFuture, Execution, WorkspaceError, WorkspacePort};

/// A fake Linux. `unavailable` is the I15 case: a browser where no workspace
/// can start, which must degrade and never break.
#[derive(Debug, Default)]
pub struct FakeShell {
    ran: RefCell<Vec<(String, String)>>,
    files: RefCell<BTreeMap<String, String>>,
    unavailable: Option<String>,
}

impl FakeShell {
    pub fn new() -> FakeShell {
        FakeShell::default()
    }

    /// A browser with no workspace at all, and the reason why.
    pub fn unavailable(reason: &str) -> FakeShell {
        FakeShell {
            unavailable: Some(reason.to_string()),
            ..FakeShell::default()
        }
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

    fn at(&self, cwd: &str, path: &str) -> String {
        format!("{}/{}", cwd.trim_end_matches('/'), path)
    }

    fn refuse<T>(&self) -> Option<Result<T, WorkspaceError>> {
        self.unavailable.as_ref().map(|reason| {
            Err(WorkspaceError::Unavailable {
                reason: reason.clone(),
            })
        })
    }
}

impl WorkspacePort for FakeShell {
    fn exec<'a>(
        &'a self,
        cwd: &'a str,
        command: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        if let Some(refusal) = self.refuse() {
            return crate::ready(refusal);
        }
        self.ran
            .borrow_mut()
            .push((cwd.to_string(), command.to_string()));
        crate::ready(Ok(Execution {
            status: 0,
            output: format!("ran: {command}"),
        }))
    }

    fn read<'a>(
        &'a self,
        cwd: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        if let Some(refusal) = self.refuse() {
            return crate::ready(refusal);
        }
        let full = self.at(cwd, path);
        crate::ready(Ok(match self.files.borrow().get(&full) {
            Some(contents) => Execution {
                status: 0,
                output: contents.clone(),
            },
            None => Execution {
                status: 1,
                output: format!("cat: can't open '{path}': No such file or directory"),
            },
        }))
    }

    fn write<'a>(
        &'a self,
        cwd: &'a str,
        path: &'a str,
        contents: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        if let Some(refusal) = self.refuse() {
            return crate::ready(refusal);
        }
        let full = self.at(cwd, path);
        self.files.borrow_mut().insert(full.clone(), contents.to_string());
        crate::ready(Ok(Execution {
            status: 0,
            output: format!("wrote {full}"),
        }))
    }

    fn list<'a>(
        &'a self,
        cwd: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        if let Some(refusal) = self.refuse() {
            return crate::ready(refusal);
        }
        let under = self.at(cwd, path).trim_end_matches("/.").to_string();
        let names: Vec<String> = self
            .files
            .borrow()
            .keys()
            .filter_map(|k| k.strip_prefix(&format!("{under}/")).map(str::to_string))
            .collect();
        crate::ready(Ok(Execution {
            status: 0,
            output: names.join("\n"),
        }))
    }
}
