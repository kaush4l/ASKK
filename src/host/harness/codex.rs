//! Codex, one prompt at a time: `codex exec --json --skip-git-repo-check -s read-only -`, or
//! `codex exec resume --json --skip-git-repo-check <id> -` to go on; the prompt on stdin. It
//! prints one JSON event per line: `thread.started` carries its id for the conversation
//! (`thread_id`), `item.completed` with an `agent_message` item carries what it said, and
//! `turn.failed` carries why a turn got no answer.
//!
//! Checked against the installed program on 2026-11-10 with real runs: a refused model
//! (`turn.failed`), and an answer and a resumed answer with `-m` set to a model the account
//! accepts. The model comes from this home's `harnesses.json`; none there = Codex's own.
//!
//! The session's permission mode is Codex's sandbox (`-s`): none or `ask` is `read-only` (it
//! reads and answers but changes nothing), `edits` is `workspace-write`, `all` is
//! `danger-full-access` (still inside the folder askk's own sandbox allows). `exec` never
//! stops to ask, so these are the whole of it. A resumed session is given the same as a
//! setting (`-c sandbox_mode=...`).
use super::{missing, or_stderr, run};
use crate::core::permit::Mode;
use crate::core::session::{Harness, Prompt, Reply};
use crate::core::Fut;
use serde_json::Value;

const PROGRAM: &str = "codex";

pub struct Codex;

/// The server's error is JSON inside a string; show its message when it is.
fn reason(message: &str) -> String {
    serde_json::from_str::<Value>(message).ok().and_then(|v| v["error"]["message"].as_str().map(String::from)).unwrap_or_else(|| message.to_string())
}

/// The reply in the events the program printed.
fn parse(out: &str) -> Result<Reply, String> {
    let (mut native, mut said, mut failed) = (None, vec![], None);
    for v in out.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        match v["type"].as_str().unwrap_or_default() {
            "thread.started" => native = v["thread_id"].as_str().map(String::from),
            "item.completed" if v["item"]["type"] == "agent_message" => said.extend(v["item"]["text"].as_str().map(String::from)),
            "turn.failed" => failed = Some(reason(v["error"]["message"].as_str().unwrap_or("the turn failed"))),
            "error" if failed.is_none() => failed = v["message"].as_str().map(reason),
            _ => {}
        }
    }
    match (said.is_empty(), failed) {
        (false, _) => Ok(Reply { text: said.join("\n\n"), native }),
        (true, Some(why)) => Err(why),
        (true, None) => Err("it printed no answer".into()),
    }
}

/// Codex's sandbox for a permission mode.
fn sandbox(permit: Option<Mode>) -> &'static str {
    match permit {
        None | Some(Mode::Ask) => "read-only",
        Some(Mode::Edits) => "workspace-write",
        Some(Mode::All) => "danger-full-access",
    }
}

impl Harness for Codex {
    fn kind(&self) -> &'static str {
        PROGRAM
    }
    fn about(&self) -> &'static str {
        "Codex, OpenAI's coding agent"
    }
    fn missing(&self) -> Option<String> {
        missing(PROGRAM)
    }
    fn state(&self) -> &'static [&'static str] {
        &[".codex"]
    }
    fn prompt(&self, p: Prompt) -> Fut<Result<Reply, String>> {
        let state = self.state();
        Box::pin(async move {
            let mut args = vec!["exec".to_string()];
            let sandbox = sandbox(p.permit);
            let setting = format!("sandbox_mode={sandbox:?}");
            match &p.native {
                Some(id) => args.extend(["-c", &setting, "resume", "--json", "--skip-git-repo-check", id, "-"].map(String::from)),
                None => args.extend(["--json", "--skip-git-repo-check", "-s", sandbox, "-"].map(String::from)),
            }
            if !p.model.is_empty() {
                // Before the trailing `-` (the prompt comes on stdin).
                args.splice(args.len() - 1..args.len() - 1, ["-m".to_string(), p.model.clone()]);
            }
            let ran = run(PROGRAM, &args, &p.text, &p.project, state).await?;
            or_stderr(PROGRAM, parse(&ran.out), &ran)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_owners_mode_is_codexs_sandbox() {
        assert_eq!([None, Some(Mode::Ask), Some(Mode::Edits), Some(Mode::All)].map(sandbox), ["read-only", "read-only", "workspace-write", "danger-full-access"]);
    }

    #[test]
    fn the_codex_wire_becomes_a_reply() {
        let out = "{\"type\":\"thread.started\",\"thread_id\":\"01a1c81b-b824-7453-b87e-38a2de870b7e\"}\n{\"type\":\"turn.started\"}\n{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"pong\"}}\n{\"type\":\"turn.completed\"}\n";
        assert_eq!(parse(out).unwrap(), Reply { text: "pong".into(), native: Some("01a1c81b-b824-7453-b87e-38a2de870b7e".into()) });
    }

    #[test]
    fn a_codex_failure_is_the_reason_the_server_gave() {
        // A real run: the account refused the configured model.
        let out = r#"{"type":"thread.started","thread_id":"01a1c81b-b824-7453-b87e-38a2de870b7e"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `m` not found."}}
{"type":"turn.started"}
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'm' model is not supported when using Codex with a ChatGPT account.\",\"code\":\"model_not_found\"}}"}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'm' model is not supported when using Codex with a ChatGPT account.\",\"code\":\"model_not_found\"}}"}}"#;
        assert_eq!(parse(out).unwrap_err(), "The 'm' model is not supported when using Codex with a ChatGPT account.");
        assert!(parse("").unwrap_err().contains("no answer"));
    }
}
