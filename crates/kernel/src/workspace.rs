//! The workspace port (ADR-013): a place the agent can RUN a command, and the
//! operations that place has to offer — exec, read (whole or windowed), write,
//! list.
//!
//! It is a port for the reason every other capability is one: the core must
//! not know Linux exists. `adapters_web` boots container2wasm behind this trait; a
//! host test drives a fake and never opens a browser (I3). A build with no
//! workspace at all answers `Unavailable` and nothing breaks (I15).
//!
//! `exec` is the only required method. Reading, writing and listing a file in
//! a Unix are commands, so they are DEFAULTS built on `exec` rather than more
//! things an adapter has to get right — and an adapter with a cheaper path may
//! still override them.

use serde::{Deserialize, Serialize};

use crate::ports::BoxFuture;

/// The one command that reads a file, whole or in part (I12: prose takes room).
mod window;

/// One finished command: the shell's exit status and everything it wrote.
/// Output is merged (stdout and stderr as the terminal saw them) because that
/// is what the model reads and what a person watches scroll past.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Execution {
    pub status: i32,
    pub output: String,
}

/// Workspace failures. `Unavailable` is the I15 variant — the substrate is
/// absent, which is a fact about this browser and not a broken workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkspaceError {
    /// No workspace can start here, and why (no isolation, no engine, a
    /// Worker rather than the page).
    Unavailable { reason: String },
    /// It started, and the command could not be run.
    Failed { message: String },
}

/// WHAT A STOP CAN ACTUALLY DO to the command running right now (R11-1).
///
/// Not a feature flag: a build may have no workspace at all (I15), and a
/// control offering to stop a command in a Linux that is not there is worse
/// than no control. container2wasm drives one shared PTY, so an interrupt byte
/// reaches the foreground process group and the command dies — the only
/// promise this product makes, travelling with the port and not with the copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Interrupt {
    /// No way in from here at all — the control is not offered.
    None,
    /// The command is signalled and really stops.
    Kill,
}

/// Quote one argument for `/bin/sh`. Single quotes take everything literally,
/// so the only case to handle is a single quote itself.
pub fn shell_quote(arg: &str) -> String {
    format!("'{}'", arg.replace('\'', "'\\''"))
}

/// A real place to build in (plan, increment 10). `cwd` is where the command
/// runs — the caller's capability grant decides it, never the model — and an
/// implementation CREATES it if it is not there: a grant naming a folder that
/// does not exist yet is a new space, not an error the agent can fix.
pub trait WorkspacePort {
    fn exec<'a>(
        &'a self,
        cwd: &'a str,
        command: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>>;

    /// A file's contents: [`WorkspacePort::read_range`] with no window asked
    /// for. ONE reader, which a caller may ask for part of.
    fn read<'a>(&'a self, cwd: &'a str, path: &'a str) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        self.read_range(cwd, path, 0, 0)
    }

    /// PART of a file, and the file's true size, without shipping the rest of
    /// it through the one shared PTY. `offset` and `limit` are BYTES and
    /// `limit == 0` is "to the end"; `window::read_script` owns the command
    /// and the argument for every applet in it. Without it a build log bigger
    /// than the 180 s watchdog can transfer is a file this agent cannot read
    /// at all — a `cat` that half-arrives is a loss the cap in
    /// `core::workspace::gate` can only describe after the fact.
    fn read_range<'a>(
        &'a self,
        cwd: &'a str,
        path: &'a str,
        offset: usize,
        limit: usize,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        Box::pin(async move { self.exec(cwd, &window::read_script(path, offset, limit)).await })
    }

    /// Write a file, creating its directory. The contents travel as base64 so
    /// nothing in them can be read as shell — a quoted heredoc still ends at
    /// its own terminator, and the model writes the contents.
    fn write<'a>(
        &'a self,
        cwd: &'a str,
        path: &'a str,
        contents: &'a str,
    ) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        Box::pin(async move {
            let path = shell_quote(path);
            let b64 = base64(contents.as_bytes());
            self.exec(
                cwd,
                &format!("mkdir -p -- \"$(dirname -- {path})\" && printf %s {} | base64 -d > {path} && echo wrote {path}", shell_quote(&b64)),
            )
            .await
        })
    }

    /// Whether what is written here is still here after a page reload.
    ///
    /// Not a feature flag and not speculative generality: it is the port
    /// telling the truth about the files, and the product's copy has to follow
    /// it rather than the other way round. The browser workspace this build
    /// ships (container2wasm) answers FALSE — its root is tmpfs in guest RAM —
    /// while a host fake keeps what it was given. Default true, because a
    /// workspace that forgets is the unusual one.
    fn durable(&self) -> bool {
        true
    }

    /// What a Stop would do here — see `Interrupt`. Default `None`, because a
    /// workspace that cannot be reached into is the unremarkable one and a
    /// control that claims otherwise is worse than no control.
    fn interrupt(&self) -> Interrupt {
        Interrupt::None
    }

    /// End the command that is running now, as far as `interrupt` says this
    /// engine can. The command's own `exec` future is what carries the result:
    /// it comes back as a typed `Failed` naming what happened, exactly as the
    /// c2w watchdog's 180 s timeout already does — which is why this returns
    /// only whether the stop itself could be delivered.
    fn stop(&self) -> BoxFuture<'_, Result<(), WorkspaceError>> {
        Box::pin(async {
            Err(WorkspaceError::Failed {
                message: "this workspace cannot stop a command once it is running".into(),
            })
        })
    }

    /// What is in a directory, one name per line, with a trailing `/` on the
    /// folders (`-p`). The slash is the only thing that distinguishes a folder
    /// from an extensionless file, and both the model deciding whether to
    /// descend and the pane deciding what a click means need to know which.
    fn list<'a>(&'a self, cwd: &'a str, path: &'a str) -> BoxFuture<'a, Result<Execution, WorkspaceError>> {
        Box::pin(async move {
            self.exec(cwd, &format!("ls -1Ap -- {}", shell_quote(path)))
                .await
        })
    }
}

/// Standard base64, no line breaks. Sixteen lines beats a dependency for the
/// one place this codebase encodes anything (PROMPT §13).
pub fn base64(bytes: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = u32::from_be_bytes([0, b[0], b[1], b[2]]);
        for i in 0..4 {
            match i > chunk.len() {
                true => out.push('='),
                false => out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char),
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{base64, shell_quote};

    #[test]
    fn base64_matches_the_standard_alphabet_and_padding() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64("héllo\n".as_bytes()), "aMOpbGxvCg==");
    }

    #[test]
    fn a_quoted_argument_cannot_escape_its_quotes() {
        assert_eq!(shell_quote("notes.txt"), "'notes.txt'");
        assert_eq!(shell_quote("a'; rm -rf /"), "'a'\\''; rm -rf /'");
    }
}
