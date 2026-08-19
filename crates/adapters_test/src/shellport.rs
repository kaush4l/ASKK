//! `FakeShell` AS A PORT. Split from `shell.rs`, which owns the fixture and
//! its builders, so both hold the 200-line rule (I12).

use kernel::{BoxFuture, Execution, WorkspaceError, WorkspacePort};

use crate::shell::FakeShell;

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
        if self.wedge.as_ref().is_some_and(|m| command.contains(m.as_str())) {
            return Box::pin(std::future::pending());
        }
        if let Some((_, message)) =
            self.fails.as_ref().filter(|(m, _)| command.contains(m.as_str()))
        {
            return crate::ready(Err(WorkspaceError::Failed {
                message: message.clone(),
            }));
        }
        let canned = self
            .answers
            .borrow()
            .iter()
            .rev()
            .find(|(marker, _, _)| command.contains(marker.as_str()))
            .map(|(_, status, output)| Execution {
                status: *status,
                output: output.clone(),
            });
        crate::ready(Ok(canned.unwrap_or_else(|| Execution {
            status: 0,
            output: format!("ran: {command}"),
        })))
    }

    fn interrupt(&self) -> kernel::Interrupt {
        self.interrupt.unwrap_or(kernel::Interrupt::None)
    }

    fn durable(&self) -> bool {
        self.keeps
    }

    /// Counted, and refused unless this shell was built interruptible — a fake
    /// that always succeeds could not show the refusal being RECORDED, which is
    /// the half of a Stop that a person actually reads.
    fn stop(&self) -> BoxFuture<'_, Result<(), WorkspaceError>> {
        *self.stops.borrow_mut() += 1;
        crate::ready(match self.interrupt {
            Some(kernel::Interrupt::None) | None => Err(WorkspaceError::Failed {
                message: "this workspace cannot stop a command once it is running".into(),
            }),
            Some(_) => Ok(()),
        })
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
        // A LISTING CAN WEDGE TOO (R15-P0-1). `wedging` was `exec`-only, and
        // the pane's own mount-time `list_files` is the call whose contention
        // message the Workspace view manufactured out of nothing. Matched on
        // the PATH, which is all a listing carries.
        if self.wedge.as_ref().is_some_and(|m| path.contains(m.as_str())) {
            return Box::pin(std::future::pending());
        }
        let under = self.at(cwd, path).trim_end_matches("/.").to_string();
        let names: Vec<String> = self
            .files
            .borrow()
            .keys()
            .filter_map(|k| k.strip_prefix(&format!("{under}/")).map(str::to_string))
            .collect();
        // A NAMED FOLDER THAT HOLDS NOTHING DOES NOT EXIST HERE. There are no
        // directories on this fake disk, only paths — and on a real Linux the
        // one case that produces neither files nor a directory is a folder
        // that is not there, which busybox reports with status 1 and this
        // exact phrase. `artifacts/` before an agent has written to it is that
        // case, and the projection's empty-vs-error branch depends on it.
        if names.is_empty() && !under.trim_end_matches('/').ends_with(cwd.trim_end_matches('/')) {
            return crate::ready(Ok(Execution {
                status: 1,
                output: format!("ls: {path}: No such file or directory"),
            }));
        }
        crate::ready(Ok(Execution {
            status: 0,
            output: names.join("\n"),
        }))
    }
}

#[cfg(test)]
mod tests {
    use kernel::WorkspacePort;

    use crate::shell::FakeShell;

    /// THE DEFAULT IS THE WORLD THE PRODUCT IS IN (26 walk). This fake used to
    /// answer `durable == true` unless a test opted out, so 51 test files
    /// asserted a machine that keeps files across a reload — which no shipped
    /// engine is, and exactly one test opted out of. The default is the only
    /// engine now; persistence is asked for by name.
    #[test]
    fn a_fake_shell_forgets_a_reload_the_way_the_only_engine_that_ships_does() {
        assert!(!FakeShell::new().durable(), "the default is container2wasm");
        assert!(!FakeShell::holding(&[("/root/a.md", "x")]).durable());
        assert!(!FakeShell::unavailable("no workspace here").durable());
        assert!(FakeShell::new().keeping().durable(), "…and persistence is asked for");
    }
}
