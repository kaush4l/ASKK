//! # Permit: what an engine may do without asking its owner
//!
//! Every engine has a mode (`engine.json` `permit`), chosen in the composer and kept with the
//! engine:
//!
//! | mode | a tool that changes files (`edit`) | a tool that runs a program (`run`) | the rest |
//! | --- | --- | --- | --- |
//! | `ask` (ask every time) | asks | asks | goes |
//! | `edits` (allow edits) | goes | asks | goes |
//! | `all` (allow all) | goes | goes | goes |
//!
//! "The rest" is reading and the engine's own bookkeeping (notes, its goal, its message box,
//! the board): nothing that leaves the engine's own memory. A sub-engine called as a tool
//! keeps its own mode for what it calls.
//!
//! The gate is where tools run: [`gate`] wraps each tool that needs a yes, at the moment the
//! toolbox is made for a step. Called, it puts an [`Approval`] in the engine's list and waits.
//! The owner answers it in place ([`answer`]): yes runs the call, no gives the model one
//! sentence instead of a result. Stopping the engine answers no to all it waits for ([`deny_all`]).
//!
//! An engine with no `permit` in its file allows all, as every engine did before there were
//! modes: an engine woken on a schedule with nobody there would otherwise wait forever.
use super::held::Held;
use super::{Fut, Tool, Toolbox};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex, OnceLock};

/// What an engine may do without asking.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Ask every time something would change a file or run a program.
    Ask,
    /// Change files without asking; ask before running a program.
    Edits,
    /// Ask nothing.
    #[default]
    All,
}

impl Mode {
    pub fn is_all(&self) -> bool {
        *self == Mode::All
    }

    /// `ask`, `edits`, `all`, as the file and the wire write it.
    pub fn word(&self) -> &'static str {
        match self {
            Mode::Ask => "ask",
            Mode::Edits => "edits",
            Mode::All => "all",
        }
    }

    /// The mode a word names; an unknown word is refused in a sentence.
    pub fn parse(word: &str) -> Result<Mode, String> {
        match word.trim() {
            "ask" => Ok(Mode::Ask),
            "edits" => Ok(Mode::Edits),
            "all" => Ok(Mode::All),
            other => Err(format!("no permission mode '{other}' (ask, edits or all)")),
        }
    }
}

/// What a tool does, as far as asking goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Reads, or keeps the engine's own memory.
    Keeps,
    /// Changes files, or the engines and pages the owner has.
    Edit,
    /// Starts or stops a program on the machine.
    Run,
}

/// The tools that change something outside the engine's memory.
const EDITS: &[&str] = &["write_file", "edit_file", "create_script", "create_engine", "dismiss_engine", "create_view", "create_component"];
const RUNS: &[&str] = &["run", "spawn", "stop", "terminal_open", "terminal_type"];

pub fn kind(tool: &str) -> Kind {
    if EDITS.contains(&tool) {
        Kind::Edit
    } else if RUNS.contains(&tool) {
        Kind::Run
    } else {
        Kind::Keeps
    }
}

/// Whether a call of `tool` waits for the owner's yes under `mode`.
pub fn needs(mode: Mode, tool: &str) -> bool {
    match (mode, kind(tool)) {
        (_, Kind::Keeps) | (Mode::All, _) => false,
        (Mode::Edits, Kind::Edit) => false,
        _ => true,
    }
}

/// One call that waits for the owner.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Approval {
    pub id: u64,
    pub tool: String,
    /// The call as the model wrote it: `write_file(path: "a.txt", content: "…")`.
    pub call: String,
    /// `edit` or `run`: why it asks.
    pub why: String,
}

struct Waiting {
    path: String,
    key: String,
    shown: Approval,
    answer: Option<futures::channel::oneshot::Sender<bool>>,
}

#[derive(Default)]
struct List {
    next: u64,
    all: Vec<Waiting>,
}

fn list() -> &'static Mutex<List> {
    static L: OnceLock<Mutex<List>> = OnceLock::new();
    L.get_or_init(Default::default)
}

/// The calls the engine at `path` waits on, oldest first.
pub fn waiting(path: &str) -> Vec<Approval> {
    list().held().all.iter().filter(|w| w.path == path).map(|w| w.shown.clone()).collect()
}

/// The waits as the lines an ask is written in (`- Allow …? Asked by: …`), so a box with
/// one is blocked like a box with a question.
pub fn lines(path: &str) -> String {
    waiting(path).iter().map(|a| format!("- Allow {}? [approval {}] Asked by: the {} gate\n", a.call, a.id, a.why)).collect()
}

/// The approval id an ask line carries (`[approval 12]`), when it is one.
pub fn id_in(question: &str) -> Option<u64> {
    let (_, rest) = question.split_once("[approval ")?;
    rest.split(']').next()?.trim().parse().ok()
}

/// Answer the approval `id` of the engine at `path`: `yes` runs the call.
pub fn answer(path: &str, id: u64, yes: bool) -> Result<(), String> {
    let w = {
        let mut l = list().held();
        let at = l.all.iter().position(|w| w.path == path && w.shown.id == id).ok_or_else(|| format!("{path} waits for no approval {id} (it was answered, or the run stopped)"))?;
        l.all.remove(at)
    };
    if let Some(tx) = w.answer {
        let _ = tx.send(yes);
    }
    super::changes::mark(&w.key);
    Ok(())
}

/// Answer no to everything the engine at `path` waits for (it is stopping).
pub fn deny_all(path: &str) {
    let ids: Vec<u64> = waiting(path).iter().map(|a| a.id).collect();
    for id in ids {
        let _ = answer(path, id, false);
    }
}

/// A tool that asks first.
struct Gated {
    inner: Arc<dyn Tool>,
    path: String,
    key: String,
}

impl Tool for Gated {
    fn name(&self) -> String {
        self.inner.name()
    }
    fn description(&self) -> String {
        self.inner.description()
    }
    fn args(&self) -> Value {
        self.inner.args()
    }
    fn invoke(&self, args: Value, tools: Toolbox) -> Fut<Result<Value, String>> {
        let (inner, path, key) = (self.inner.clone(), self.path.clone(), self.key.clone());
        Box::pin(async move {
            let name = inner.name();
            let (tx, rx) = futures::channel::oneshot::channel();
            {
                let mut l = list().held();
                l.next += 1;
                let why = if kind(&name) == Kind::Run { "run" } else { "edit" };
                let shown = Approval { id: l.next, tool: name.clone(), call: super::tool::call_sig(&name, &args), why: why.into() };
                l.all.push(Waiting { path, key: key.clone(), shown, answer: Some(tx) });
            }
            super::changes::mark(&key);
            match rx.await {
                Ok(true) => inner.invoke(args, tools).await,
                _ => Err(format!("the owner did not allow {name} (permission mode: ask); do not try it again in this run, say what you would have done")),
            }
        })
    }
}

/// The tools of one step, each that needs a yes under `mode` wrapped so it asks first.
pub fn gate(mode: Mode, path: &str, key: &str, tools: Vec<Arc<dyn Tool>>) -> Vec<Arc<dyn Tool>> {
    tools.into_iter().map(|t| if needs(mode, &t.name()) { Arc::new(Gated { inner: t, path: path.into(), key: key.into() }) as Arc<dyn Tool> } else { t }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn each_mode_asks_for_what_it_says() {
        assert!(needs(Mode::Ask, "write_file") && needs(Mode::Ask, "run") && !needs(Mode::Ask, "read_file") && !needs(Mode::Ask, "remember"));
        assert!(!needs(Mode::Edits, "write_file") && needs(Mode::Edits, "spawn"));
        assert!(!needs(Mode::All, "write_file") && !needs(Mode::All, "run"));
        assert_eq!(Mode::parse("edits"), Ok(Mode::Edits));
        assert!(Mode::parse("sure").unwrap_err().contains("ask, edits or all"));
        assert_eq!(Mode::default(), Mode::All, "an engine with no mode asks nothing, as before");
        assert_eq!(id_in("Allow run(command: \"ls\")? [approval 12]"), Some(12));
        assert_eq!(id_in("which folder?"), None);
    }

    #[tokio::test]
    async fn a_call_that_needs_a_yes_waits_for_the_owner_and_a_no_is_a_sentence() {
        let write = crate::core::tool("write_file", "w", Value::Null, |_| Ok(json!("written")));
        let tb = Toolbox::new(gate(Mode::Ask, "permit-test", "engines/permit-test", vec![write]));
        let tb2 = tb.clone();
        let call = tokio::spawn(async move { tb2.call("write_file", json!({"path": "a.txt"})).await });
        let mut seen = vec![];
        for _ in 0..100 {
            seen = waiting("permit-test");
            if !seen.is_empty() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(seen.len(), 1, "the call waits for the owner");
        assert_eq!(seen[0].call, "write_file(path: \"a.txt\")");
        assert!(lines("permit-test").contains(&format!("[approval {}]", seen[0].id)));
        answer("permit-test", seen[0].id, true).unwrap();
        assert_eq!(call.await.unwrap().unwrap(), json!("written"), "a yes runs it");
        let tb3 = tb.clone();
        let call = tokio::spawn(async move { tb3.call("write_file", json!({})).await });
        while waiting("permit-test").is_empty() {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        deny_all("permit-test");
        assert!(call.await.unwrap().unwrap_err().contains("did not allow write_file"), "stopping answers no");
        assert!(answer("permit-test", 999, true).is_err());
    }
}
