//! # Workspaces: the places the boxes run in, and the state of each one's git
//!
//! What herdr calls Spaces: the boxes grouped by their place (`SessionBox::place`, a
//! project folder under the workspace), each place with its branch and whether it is clean,
//! changed, ahead or behind. A window draws the groups; the service reads git.
//!
//! *How* git is read is the host's (it runs a program), so the core only says what is asked
//! ([`Repos`]); a build that cannot run git reads every place as no repository.
//!
//! Reading git costs a program each time, and a window asks whenever its boxes change, so
//! what was read is kept for [`FRESH_MS`]. When a place's state is found to differ from what
//! was kept, [`KEY`] is marked on the change feed, so every window asks again.
use super::held::{Held, Shared};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, RwLock};

/// The key on the change feed that says a place's git state changed.
pub const KEY: &str = "workspaces";

/// How long a place's git state is taken as it is, in milliseconds.
pub const FRESH_MS: u128 = 2000;

/// The git state of a place that is a repository.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Git {
    /// The branch checked out; `(detached)` when none is.
    pub branch: String,
    /// How many files differ from the last commit (changed, added, not yet tracked).
    pub changed: u32,
    /// Commits not yet on the branch it follows, and commits there not yet here.
    pub ahead: u32,
    pub behind: u32,
}

/// One place boxes run in.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Workspace {
    /// The place, as the boxes name it; empty is the workspace itself.
    pub place: String,
    /// Its git state; `None` when the place is no repository of its own (or git cannot be run).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git: Option<Git>,
}

/// What a host that can read git does.
pub trait Repos: Send + Sync {
    /// The git state of `place` (a folder under the workspace; empty = the workspace), when
    /// it is the top of a repository.
    fn git(&self, place: &str) -> Option<Git>;
}

static REPOS: RwLock<Option<Arc<dyn Repos>>> = RwLock::new(None);

/// The host names who reads git, once, at start.
pub fn set(repos: Arc<dyn Repos>) {
    *REPOS.writing() = Some(repos);
}

/// What was read for each place, and when.
static KEPT: Mutex<BTreeMap<String, (web_time::Instant, Option<Git>)>> = Mutex::new(BTreeMap::new());

/// The git state of each of `places`, read again where what was kept is older than
/// [`FRESH_MS`]. A place whose state changed is marked on the change feed.
pub fn of(places: &[String]) -> Vec<Workspace> {
    let repos = REPOS.reading().clone();
    let now = web_time::Instant::now();
    let mut changed = false;
    let mut out = vec![];
    for place in places {
        let kept = KEPT.held().get(place).cloned();
        let git = match kept {
            Some((at, git)) if now.duration_since(at).as_millis() < FRESH_MS => git,
            before => {
                let git = repos.as_ref().and_then(|r| r.git(place));
                changed |= before.is_some_and(|(_, old)| old != git);
                KEPT.held().insert(place.clone(), (now, git.clone()));
                git
            }
        };
        out.push(Workspace { place: place.clone(), git });
    }
    if changed {
        super::changes::mark(KEY);
    }
    out
}

/// Every place a box runs in, in the order the boxes first name it, with its git state.
pub fn all() -> Vec<Workspace> {
    let mut places: Vec<String> = vec![];
    for b in super::boxes::all() {
        if !places.contains(&b.place) {
            places.push(b.place);
        }
    }
    of(&places)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct Counting(AtomicU32);

    impl Repos for Counting {
        fn git(&self, place: &str) -> Option<Git> {
            let n = self.0.fetch_add(1, Ordering::SeqCst);
            (place == "test-repo").then(|| Git { branch: "main".into(), changed: n, ..Default::default() })
        }
    }

    #[test]
    fn a_place_is_read_once_while_fresh() {
        let reads = Arc::new(Counting(AtomicU32::new(0)));
        set(reads.clone());
        let places = vec!["test-repo".to_string(), "test-plain".to_string()];
        let first = of(&places);
        assert_eq!(first[0].git.as_ref().map(|g| g.branch.as_str()), Some("main"));
        assert_eq!(first[1].git, None, "a folder that is no repository has no git state");
        let again = of(&places);
        assert_eq!(again, first, "asked again at once, what was read is kept");
        assert_eq!(reads.0.load(Ordering::SeqCst), 2, "git was read once per place");
    }
}
