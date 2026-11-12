//! # Session: a conversation with another agent's own loop
//!
//! An engine is structure (elements, a flow, a prompt askk builds). A session is interaction:
//! askk hands a prompt to a program that runs its own loop and waits for the answer.
//!
//! - [`Session`]: who it is with (`harness`), where it works (`project`), what was said
//!   (`turns`), and the id the harness itself knows the conversation by (`native`), which is
//!   all that is needed to go on with it after a restart.
//! - [`Harness`]: the port. One prompt in, one [`Reply`] out. Each kind is one file under
//!   `host/harness/`; nothing outside that folder names a kind.
//! - The book ([`open`], [`list`], [`get`], [`ask`], [`settle`], [`recover`]): sessions in the
//!   store, one key each (`<sessions>/<id>.json`). A session takes one turn at a time.
use super::store::Store;
use super::Fut;
use serde::{Deserialize, Serialize};

/// Who said a turn.
pub const USER: &str = "user";
pub const AGENT: &str = "agent";

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Turn {
    /// [`USER`] or [`AGENT`].
    pub who: String,
    pub text: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// Waiting for a prompt.
    #[default]
    Idle,
    /// The harness is working on the last prompt.
    Busy,
    /// The last prompt got no answer; `error` says why. The next prompt may still work.
    Failed,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub id: u64,
    /// The kind of harness it talks to.
    pub harness: String,
    #[serde(default)]
    pub title: String,
    /// The folder under the workspace it works in; empty = the workspace itself.
    #[serde(default)]
    pub project: String,
    /// The harness's own id for this conversation, learned from its first reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<String>,
    #[serde(default)]
    pub turns: Vec<Turn>,
    #[serde(default)]
    pub state: State,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub error: String,
    /// What the owner lets its harness do without asking; `None` is the harness's own
    /// careful default (it reads and answers, and refuses what needs a yes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permit: Option<super::permit::Mode>,
}

/// What a harness gives back for one prompt.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reply {
    pub text: String,
    /// Its id for the conversation, when it gave one.
    pub native: Option<String>,
}

/// One prompt for a harness.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Prompt {
    pub text: String,
    /// The conversation to go on with; `None` starts one.
    pub native: Option<String>,
    /// The session's project folder name (empty = the workspace).
    pub project: String,
    /// The model the harness is told to use; empty = its own default.
    pub model: String,
    /// The provider the harness is told to use, where it has more than one; empty = its own.
    pub provider: String,
    /// The permission mode the harness is given, where it takes one (`None`: its careful default).
    pub permit: Option<super::permit::Mode>,
}

/// One kind's entry in `harnesses.json`: how this home runs that harness.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Setting {
    /// The model it is told to use; empty = its own default.
    #[serde(default)]
    pub model: String,
    /// The provider it is told to use, where it has more than one; empty = its own default.
    #[serde(default)]
    pub provider: String,
}

/// `harnesses.json`: a setting per kind. A kind left out runs with its own defaults.
pub fn settings(text: &str) -> Result<std::collections::BTreeMap<String, Setting>, String> {
    serde_json::from_str(text).map_err(|e| e.to_string())
}

/// A program that runs another agent's loop.
pub trait Harness: Send + Sync {
    fn kind(&self) -> &'static str;
    /// One line for a person choosing between kinds.
    fn about(&self) -> &'static str;
    /// Why it cannot be used on this machine now; `None` when it can.
    fn missing(&self) -> Option<String>;
    /// Where the program keeps its own state, as paths under the user's home that begin with
    /// these. A session may write there and in its project folder, and nowhere else.
    fn state(&self) -> &'static [&'static str];
    /// Send the prompt and wait for the answer.
    fn prompt(&self, p: Prompt) -> Fut<Result<Reply, String>>;
}

/// A harness kind as a person is shown it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct HarnessInfo {
    pub kind: String,
    pub about: String,
    /// Empty when it can be used.
    pub missing: String,
}

fn key(root: &str, id: u64) -> String {
    format!("{root}/{id}.json")
}

fn save(store: &dyn Store, root: &str, s: &Session) -> Result<(), String> {
    store.put(&key(root, s.id), &serde_json::to_string_pretty(s).map_err(|e| e.to_string())?)
}

/// A project name is one plain folder name, or empty.
pub fn check_project(project: &str) -> Result<(), String> {
    let ok = project.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') && !project.starts_with('.');
    if ok && project.len() <= 64 {
        Ok(())
    } else {
        Err(format!("project '{project}' is not a plain folder name (letters, digits, - _ .)"))
    }
}

/// Every session under `root`, oldest first.
pub fn list(store: &dyn Store, root: &str) -> Vec<Session> {
    let mut all: Vec<Session> = store.list(root).iter().filter_map(|e| store.get(&format!("{root}/{}", e.name))).filter_map(|t| serde_json::from_str(&t).ok()).collect();
    all.sort_by_key(|s: &Session| s.id);
    all
}

pub fn get(store: &dyn Store, root: &str, id: u64) -> Result<Session, String> {
    let t = store.get(&key(root, id)).ok_or_else(|| format!("no session {id}"))?;
    serde_json::from_str(&t).map_err(|e| format!("session {id}: {e}"))
}

/// Start a session with a harness of one of `kinds`. Nothing is run until it is asked.
pub fn open(store: &dyn Store, root: &str, kinds: &[&str], harness: &str, title: &str, project: &str) -> Result<Session, String> {
    if !kinds.contains(&harness) {
        return Err(format!("unknown harness '{harness}' (one of {})", kinds.join(", ")));
    }
    check_project(project)?;
    let id = list(store, root).last().map_or(1, |s| s.id + 1);
    let title = if title.trim().is_empty() { format!("{harness} {id}") } else { title.trim().to_string() };
    let s = Session { id, harness: harness.into(), title, project: project.into(), ..Default::default() };
    save(store, root, &s)?;
    Ok(s)
}

/// Record a prompt and mark the session busy; the prompt to hand its harness comes back.
/// A session that is busy takes no second prompt.
pub fn ask(store: &dyn Store, root: &str, id: u64, text: &str) -> Result<Prompt, String> {
    let mut s = get(store, root, id)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("an empty prompt".into());
    }
    if s.state == State::Busy {
        return Err(format!("session {id} is still answering the last prompt"));
    }
    s.turns.push(Turn { who: USER.into(), text: text.into() });
    s.state = State::Busy;
    s.error.clear();
    save(store, root, &s)?;
    Ok(Prompt { text: text.into(), native: s.native, project: s.project, permit: s.permit, ..Default::default() })
}

/// Set what the session's harness may do without asking, from its next prompt on.
pub fn set_permit(store: &dyn Store, root: &str, id: u64, mode: super::permit::Mode) -> Result<Session, String> {
    let mut s = get(store, root, id)?;
    s.permit = Some(mode);
    save(store, root, &s)?;
    Ok(s)
}

/// Record how a prompt ended: the answer as a turn, or the reason there is none.
pub fn settle(store: &dyn Store, root: &str, id: u64, r: Result<Reply, String>) -> Result<(), String> {
    let mut s = get(store, root, id)?;
    match r {
        Ok(reply) => {
            s.turns.push(Turn { who: AGENT.into(), text: reply.text });
            s.native = reply.native.or(s.native);
            s.state = State::Idle;
        }
        Err(e) => {
            s.state = State::Failed;
            s.error = e;
        }
    }
    save(store, root, &s)
}

/// After a restart no harness is running: a session left busy says so and can be asked again.
pub fn recover(store: &dyn Store, root: &str) {
    for s in list(store, root).into_iter().filter(|s| s.state == State::Busy) {
        let _ = settle(store, root, s.id, Err("the host restarted before the answer came; ask again".into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::store::Bundle;

    const KINDS: &[&str] = &["echo"];

    fn book() -> Bundle {
        Bundle::memory(Default::default())
    }

    #[test]
    fn a_session_is_prompted_until_it_answers() {
        let st = book();
        let s = open(&st, "sessions", KINDS, "echo", "", "").unwrap();
        assert_eq!((s.id, s.title.as_str(), s.state), (1, "echo 1", State::Idle));
        let p = ask(&st, "sessions", 1, " hi ").unwrap();
        assert_eq!((p.text.as_str(), p.native), ("hi", None));
        assert_eq!(get(&st, "sessions", 1).unwrap().state, State::Busy);
        settle(&st, "sessions", 1, Ok(Reply { text: "hello".into(), native: Some("n1".into()) })).unwrap();
        let s = get(&st, "sessions", 1).unwrap();
        assert_eq!(s.state, State::Idle);
        assert_eq!(s.turns, [Turn { who: USER.into(), text: "hi".into() }, Turn { who: AGENT.into(), text: "hello".into() }]);
        // The next prompt goes on with the harness's own conversation.
        assert_eq!(ask(&st, "sessions", 1, "more").unwrap().native.as_deref(), Some("n1"));
    }

    #[test]
    fn a_busy_session_takes_no_second_prompt() {
        let st = book();
        open(&st, "sessions", KINDS, "echo", "t", "").unwrap();
        ask(&st, "sessions", 1, "one").unwrap();
        assert!(ask(&st, "sessions", 1, "two").unwrap_err().contains("still answering"));
        assert_eq!(get(&st, "sessions", 1).unwrap().turns.len(), 1);
    }

    #[test]
    fn an_unknown_harness_kind_is_refused_with_the_reason() {
        let e = open(&book(), "sessions", KINDS, "nope", "", "").unwrap_err();
        assert!(e.contains("unknown harness 'nope'") && e.contains("echo"));
    }

    #[test]
    fn a_failed_prompt_says_why_and_can_be_asked_again() {
        let st = book();
        open(&st, "sessions", KINDS, "echo", "", "").unwrap();
        ask(&st, "sessions", 1, "one").unwrap();
        settle(&st, "sessions", 1, Err("no such program".into())).unwrap();
        let s = get(&st, "sessions", 1).unwrap();
        assert_eq!((s.state, s.error.as_str()), (State::Failed, "no such program"));
        ask(&st, "sessions", 1, "again").unwrap();
        assert!(get(&st, "sessions", 1).unwrap().error.is_empty());
    }

    #[test]
    fn a_session_left_busy_by_a_restart_says_so() {
        let st = book();
        open(&st, "sessions", KINDS, "echo", "", "").unwrap();
        open(&st, "sessions", KINDS, "echo", "", "").unwrap();
        ask(&st, "sessions", 2, "one").unwrap();
        recover(&st, "sessions");
        let all = list(&st, "sessions");
        assert_eq!((all[0].state, all[1].state), (State::Idle, State::Failed));
        assert!(all[1].error.contains("restarted"));
    }

    #[test]
    fn a_project_is_one_plain_folder_name() {
        for bad in ["../x", "a/b", ".hidden", "a b"] {
            assert!(open(&book(), "sessions", KINDS, "echo", "", bad).is_err(), "{bad}");
        }
        assert_eq!(open(&book(), "sessions", KINDS, "echo", "", "try-1").unwrap().project, "try-1");
    }
}
