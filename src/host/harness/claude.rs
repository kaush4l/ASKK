//! Claude Code, one prompt at a time: `claude -p --output-format json [--resume <id>]`, the
//! prompt on stdin. It prints one JSON object (`type: result`) holding the answer (`result`),
//! whether it failed (`is_error`) and its own id for the conversation (`session_id`), which
//! `--resume` takes to go on with it. Checked against the installed program on 2026-11-10.
//!
//! No permission flag is passed: in this mode a tool that needs a yes is refused, so a session
//! can read and answer but changes nothing until permission asks have a way to a person.
use super::{missing, or_stderr, run};
use crate::core::session::{Harness, Prompt, Reply};
use crate::core::Fut;
use serde_json::Value;

const PROGRAM: &str = "claude";

pub struct Claude;

/// The reply in what the program printed: the last `result` object.
fn parse(out: &str) -> Result<Reply, String> {
    let v = out.lines().rev().filter_map(|l| serde_json::from_str::<Value>(l).ok()).find(|v| v["type"] == "result").ok_or("it printed no result")?;
    let text = v["result"].as_str().unwrap_or_default().to_string();
    if v["is_error"].as_bool().unwrap_or(false) {
        return Err(if text.is_empty() { v["subtype"].as_str().unwrap_or("it failed").to_string() } else { text });
    }
    Ok(Reply { text, native: v["session_id"].as_str().map(String::from) })
}

impl Harness for Claude {
    fn kind(&self) -> &'static str {
        PROGRAM
    }
    fn about(&self) -> &'static str {
        "Claude Code, Anthropic's coding agent"
    }
    fn missing(&self) -> Option<String> {
        missing(PROGRAM)
    }
    fn state(&self) -> &'static [&'static str] {
        // `.claude/` and `.claude.json` with its lock and backups.
        &[".claude"]
    }
    fn prompt(&self, p: Prompt) -> Fut<Result<Reply, String>> {
        let state = self.state();
        Box::pin(async move {
            let mut args: Vec<String> = ["-p", "--output-format", "json"].map(String::from).into();
            if let Some(id) = &p.native {
                args.extend(["--resume".to_string(), id.clone()]);
            }
            if !p.model.is_empty() {
                args.extend(["--model".to_string(), p.model.clone()]);
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
    fn the_claude_wire_becomes_a_reply() {
        // The fields this adapter reads, from a run of the installed program.
        let out = r#"{"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"pong","session_id":"2da5782a-847b-4520-a25a-029802a254dd","stop_reason":"end_turn"}"#;
        assert_eq!(parse(out).unwrap(), Reply { text: "pong".into(), native: Some("2da5782a-847b-4520-a25a-029802a254dd".into()) });
    }

    #[test]
    fn a_claude_failure_is_the_error_it_gave() {
        let out = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"No conversation found","session_id":"x"}"#;
        assert_eq!(parse(out).unwrap_err(), "No conversation found");
        assert!(parse("not json\n").unwrap_err().contains("no result"));
    }
}
