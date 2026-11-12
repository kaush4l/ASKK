//! # Sandbox: the port that keeps a program inside its folder
//!
//! A program the service starts in a terminal runs with the owner's own rights unless
//! something confines it. What can confine it differs per system, and a build is made for
//! one system, so the choice is made when the program is built (`docs/concept.md`,
//! section 7): the core only says what is asked ([`Sandbox`]), and the host for each system
//! fills it with what that system has (`host/sandbox.rs`). No build carries another's code.
//!
//! | build for | a program is confined by |
//! | --- | --- |
//! | macOS | the system's own sandbox, with a profile made for the one program |
//! | Linux | Landlock, where the kernel has it (5.13 or later); else nothing, and it says so |
//! | anything else | nothing, and it says so ([`NOT`]) |
//!
//! The rule is the same everywhere it holds: the program may read and run what the owner
//! can, and may **write** only in its own folder, in the system's temp folders, and where
//! its own state lives. A box says in a fact how its program is confined ([`Sandbox::how`]),
//! so "not confined" is never silent.
// A host without `terminals` starts nothing to confine; one without `sandbox` fills nothing.
#![cfg_attr(not(all(feature = "terminals", feature = "sandbox")), allow(dead_code))]
use super::held::Shared;
use std::path::Path;
use std::sync::{Arc, RwLock};

/// What a build with no sandbox for its system says.
pub const NOT: &str = "not confined: this build has no sandbox for this system, so the program can write wherever you can";

pub trait Sandbox: Send + Sync {
    /// How a program is confined here, in words a box shows.
    fn how(&self) -> String;
    /// The command line that runs `argv` confined: it may write in `folder`, in temp, and
    /// under the user's home where a path begins with one of `state` (a program's own state,
    /// `.claude`), and nowhere else.
    fn confine(&self, argv: Vec<String>, folder: &Path, state: &[String]) -> Result<Vec<String>, String>;
}

/// No sandbox: the program runs as it was asked for, and [`NOT`] says so.
struct Open;

impl Sandbox for Open {
    fn how(&self) -> String {
        NOT.into()
    }
    fn confine(&self, argv: Vec<String>, _: &Path, _: &[String]) -> Result<Vec<String>, String> {
        Ok(argv)
    }
}

static SANDBOX: RwLock<Option<Arc<dyn Sandbox>>> = RwLock::new(None);

/// The host names what confines a program on this system, once, at start.
pub fn set(sandbox: Arc<dyn Sandbox>) {
    *SANDBOX.writing() = Some(sandbox);
}

/// What confines a program in this build.
pub fn sandbox() -> Arc<dyn Sandbox> {
    SANDBOX.reading().clone().unwrap_or_else(|| Arc::new(Open))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_no_sandbox_the_program_runs_as_asked_and_the_box_says_it_is_not_confined() {
        let argv = vec!["sh".to_string(), "-c".to_string(), "true".to_string()];
        assert_eq!(Open.confine(argv.clone(), Path::new("/w"), &[]).unwrap(), argv);
        assert!(Open.how().starts_with("not confined"), "{}", Open.how());
    }
}
