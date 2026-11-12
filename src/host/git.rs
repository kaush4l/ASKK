//! # Git: the state of a place's repository, read with `git` itself
//!
//! The port is `core/workspaces.rs`. A place is a folder under the workspace; it has a git
//! state when it is the top of a repository of its own (it holds `.git`), so a workspace
//! that happens to sit inside some other repository does not lend that one's branch to
//! every place. One question to git per look: `git status --porcelain=v2 --branch`, which
//! says the branch, how far ahead and behind, and one line per file that differs.
use crate::core::workspaces::{Git, Repos};
use std::process::Command;

/// Reads git on this machine.
pub struct Repo;

impl Repos for Repo {
    fn git(&self, place: &str) -> Option<Git> {
        let dir = crate::core::places::workspace().join(place);
        if !dir.join(".git").exists() {
            return None;
        }
        let out = Command::new("git").arg("-C").arg(&dir).args(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]).output().ok()?;
        out.status.success().then(|| read(&String::from_utf8_lossy(&out.stdout)))
    }
}

/// What `git status --porcelain=v2 --branch` says, as a [`Git`].
fn read(said: &str) -> Git {
    let mut git = Git::default();
    for line in said.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            git.branch = head.trim().to_string();
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            let mut parts = ab.split_whitespace();
            git.ahead = parts.next().and_then(|a| a.trim_start_matches('+').parse().ok()).unwrap_or(0);
            git.behind = parts.next().and_then(|b| b.trim_start_matches('-').parse().ok()).unwrap_or(0);
        } else if !line.starts_with('#') && !line.trim().is_empty() {
            git.changed += 1;
        }
    }
    git
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_git_says_is_read_as_a_branch_its_distance_and_what_changed() {
        let said = "# branch.oid 1f2e\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/x.rs\n? notes.md\n";
        assert_eq!(read(said), Git { branch: "main".into(), changed: 2, ahead: 2, behind: 1 });
        assert_eq!(read("# branch.oid (initial)\n# branch.head (detached)\n"), Git { branch: "(detached)".into(), ..Default::default() }, "no branch it follows: nothing ahead or behind");
    }

    #[test]
    fn a_folder_that_is_not_the_top_of_a_repository_has_no_git_state() {
        assert_eq!(Repo.git("no-such-place-for-a-test"), None);
    }
}
