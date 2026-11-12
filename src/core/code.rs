//! # Code: a place to run a small program (a port)
//!
//! An engine that selects the tool `run_code` writes a program and gets back the value of its
//! last expression and what it printed. Where the program runs is the host's business:
//!
//! | host | runs it in |
//! | --- | --- |
//! | a browser tab (`local/code.rs`) | a sandboxed frame and worker: no page, no store, no network |
//! | the server (`host/code.rs`) | `node`, in an empty context: no `require`, no files, no network |
//!
//! The tool, its words to the model and the shape of its result are here, once, so an engine
//! behaves the same on every build. With no host providing it, the tool says so in a sentence.
use super::held::Shared;
use super::{Fut, Tool, Toolbox};
use serde_json::{json, Value};
use std::sync::{Arc, RwLock};

/// A run's limit when the caller sets none, and the most it may ask for.
pub const TIMEOUT_MS: u64 = 10_000;
pub const MAX_TIMEOUT_MS: u64 = 120_000;

/// The host's place to run a program.
pub trait Code: Send + Sync {
    /// The languages it runs (`js`, `python`), for the tool's words to the model.
    fn languages(&self) -> Vec<String>;
    /// Run `code`. The reply is what [`outcome`] reads: `{"ok", "result", "stdout", "error"}`.
    fn run(&self, language: String, code: String, timeout_ms: u64) -> Fut<Result<Value, String>>;
}

static CODE: RwLock<Option<Arc<dyn Code>>> = RwLock::new(None);

/// The host names its runner once, at start.
pub fn set(code: Arc<dyn Code>) {
    *CODE.writing() = Some(code);
}

fn code() -> Option<Arc<dyn Code>> {
    CODE.reading().clone()
}

/// A runner's reply as the tool's result: the value and the printed text, or an error that
/// still carries what was printed before it.
pub fn outcome(v: &Value) -> Result<Value, String> {
    let stdout = v["stdout"].as_str().unwrap_or_default();
    if v["ok"].as_bool() == Some(true) {
        return Ok(json!({"result": v["result"], "stdout": stdout}));
    }
    let error = v["error"].as_str().unwrap_or("the program failed without saying why");
    Err(if stdout.is_empty() { error.to_string() } else { format!("{error}\nstdout:\n{stdout}") })
}

/// The tool an engine selects by the name `run_code`.
pub struct RunCode;

impl Tool for RunCode {
    fn name(&self) -> String {
        "run_code".into()
    }
    fn description(&self) -> String {
        "run a program in a sandbox (no files, no network); gives the value of its last expression and what it printed".into()
    }
    fn args(&self) -> Value {
        let languages = code().map(|c| c.languages().join(" | ")).unwrap_or_else(|| "js".into());
        json!({"language": languages, "code": "text", "timeout_ms": "number, optional"})
    }
    fn invoke(&self, args: Value, _: Toolbox) -> Fut<Result<Value, String>> {
        let language = args["language"].as_str().unwrap_or("js").to_string();
        let source = args["code"].as_str().unwrap_or_default().to_string();
        let timeout = args["timeout_ms"].as_u64().unwrap_or(TIMEOUT_MS).clamp(1, MAX_TIMEOUT_MS);
        Box::pin(async move {
            if source.trim().is_empty() {
                return Err("run_code needs the argument 'code': the program to run".to_string());
            }
            let Some(runner) = code() else {
                return Err("this build has no place to run a program (see the capability `code`)".to_string());
            };
            if !runner.languages().contains(&language) {
                return Err(format!("this build runs {}; it cannot run '{language}'", runner.languages().join(", ")));
            }
            outcome(&runner.run(language, source, timeout).await?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake;
    impl Code for Fake {
        fn languages(&self) -> Vec<String> {
            vec!["js".into()]
        }
        fn run(&self, _: String, code: String, _: u64) -> Fut<Result<Value, String>> {
            Box::pin(async move { Ok(json!({"ok": true, "result": code.len(), "stdout": ""})) })
        }
    }

    #[tokio::test]
    async fn the_tool_runs_on_whatever_the_host_provides_and_refuses_in_a_sentence() {
        set(Arc::new(Fake));
        let tools = Toolbox::new(vec![crate::core::IntoTool::into_tool(RunCode)]);
        assert_eq!(tools.call("run_code", json!({"code": "1+1"})).await.unwrap(), json!({"result": 3, "stdout": ""}));
        assert_eq!(tools.call("run_code", json!({"code": " "})).await.unwrap_err(), "run_code needs the argument 'code': the program to run");
        assert_eq!(tools.call("run_code", json!({"language": "cobol", "code": "x"})).await.unwrap_err(), "this build runs js; it cannot run 'cobol'");
    }

    #[test]
    fn a_reply_becomes_a_result_or_an_error_that_keeps_what_was_printed() {
        assert_eq!(outcome(&json!({"ok": true, "result": 4, "stdout": "hi"})).unwrap(), json!({"result": 4, "stdout": "hi"}));
        assert_eq!(outcome(&json!({"ok": false, "error": "x is not defined", "stdout": "before"})).unwrap_err(), "x is not defined\nstdout:\nbefore");
        assert_eq!(outcome(&json!({"ok": false, "error": "boom"})).unwrap_err(), "boom");
    }
}
