//! Claude Code, one prompt at a time: `claude -p --output-format json [--resume <id>]`, the
//! prompt on stdin. It prints one JSON object (`type: result`) holding the answer (`result`),
//! whether it failed (`is_error`) and its own id for the conversation (`session_id`), which
//! `--resume` takes to go on with it. Checked against the installed program on 2026-11-10.
//!
//! The session's permission mode is passed as Claude Code's own (`--permission-mode`): none or
//! `ask` passes nothing, and in this mode a tool that needs a yes is refused; `edits` is
//! `acceptEdits`; `all` is `bypassPermissions`, still inside the folder askk's sandbox allows.
//!
//! What was refused reaches the owner: the `result` object lists each refused call
//! (`permission_denials`: `tool_name`, `tool_use_id`, `tool_input`; the same call may be listed
//! twice), seen on 2026-11-12 from the installed program (2.x) asked to `touch` a file. Each is
//! one [`Ask`]. When the owner allows them the session is resumed with `--allowedTools`, one
//! rule per call in Claude Code's own syntax: `Bash(<the exact command>)` for a command, the
//! bare tool name (`Edit`, `Write`) for any other.
use super::{missing, or_stderr, run};
use crate::core::permit::Mode;
use crate::core::session::{self, Ask, Harness, Prompt, Reply};
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
    let asks = v["permission_denials"].as_array().map(|all| all.iter().map(ask).collect()).unwrap_or_default();
    Ok(Reply { text, native: v["session_id"].as_str().map(String::from), asks: session::once(asks) })
}

/// The longest summary of a call shown to the owner.
const SHORT: usize = 160;

/// One refused call as the owner is asked it: the command, the file, or the input in brief.
fn ask(d: &Value) -> Ask {
    let tool = d["tool_name"].as_str().unwrap_or("a tool").to_string();
    let input = &d["tool_input"];
    let command = input["command"].as_str().filter(|_| tool == "Bash");
    let file = input["file_path"].as_str().or(input["notebook_path"].as_str());
    let summary = match (command, file) {
        (Some(c), _) => c.to_string(),
        (None, Some(f)) => f.to_string(),
        _ => {
            let all = input.to_string();
            if all.chars().count() > SHORT { format!("{}…", all.chars().take(SHORT - 1).collect::<String>()) } else { all }
        }
    };
    let rule = match command {
        Some(c) => format!("Bash({c})"),
        None => tool.clone(),
    };
    Ask { tool, summary, rule }
}

/// What the program is given: the prompt's own flags, in Claude Code's words.
fn args(p: &Prompt) -> Vec<String> {
    let mut args: Vec<String> = ["-p", "--output-format", "json"].map(String::from).into();
    if let Some(id) = &p.native {
        args.extend(["--resume".to_string(), id.clone()]);
    }
    if !p.model.is_empty() {
        args.extend(["--model".to_string(), p.model.clone()]);
    }
    args.extend(mode(p.permit).map(|m| ["--permission-mode".to_string(), m.to_string()]).into_iter().flatten());
    if !p.allowed.is_empty() {
        // One argument per rule: a command may hold spaces and commas.
        args.push("--allowedTools".to_string());
        args.extend(p.allowed.iter().cloned());
    }
    args
}

/// Claude Code's own name for a permission mode; `None`: pass nothing (its default).
fn mode(permit: Option<Mode>) -> Option<&'static str> {
    match permit? {
        Mode::Ask => None,
        Mode::Edits => Some("acceptEdits"),
        Mode::All => Some("bypassPermissions"),
    }
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
            let ran = run(PROGRAM, &args(&p), &p.text, &p.project, state).await?;
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
        assert_eq!(parse(out).unwrap(), Reply { text: "pong".into(), native: Some("2da5782a-847b-4520-a25a-029802a254dd".into()), asks: vec![] });
    }

    #[test]
    fn a_refused_call_is_an_ask_once() {
        // The installed program (2.x) on 2026-11-12, asked to make a file in the careful mode.
        let out = r#"{"type":"result","subtype":"success","is_error":false,"result":"Blocked: creating the file needs your approval.","session_id":"e38f21d8-1f0c-4d2a-9a51-6c1f0b7d2e10","permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_01U7aaa","tool_input":{"command":"touch made-by-claude.txt","description":"Create empty file made-by-claude.txt"}},{"tool_name":"Bash","tool_use_id":"toolu_01U7bbb","tool_input":{"command":"touch made-by-claude.txt","description":"Create empty file made-by-claude.txt"}},{"tool_name":"Write","tool_use_id":"toolu_01U7ccc","tool_input":{"file_path":"/w/notes.md","content":"hi"}},{"tool_name":"WebFetch","tool_use_id":"toolu_01U7ddd","tool_input":{"url":"https://example.com","prompt":"read it"}}]}"#;
        let r = parse(out).unwrap();
        assert_eq!((r.text.as_str(), r.native.as_deref()), ("Blocked: creating the file needs your approval.", Some("e38f21d8-1f0c-4d2a-9a51-6c1f0b7d2e10")));
        assert_eq!(
            r.asks,
            [
                Ask { tool: "Bash".into(), summary: "touch made-by-claude.txt".into(), rule: "Bash(touch made-by-claude.txt)".into() },
                Ask { tool: "Write".into(), summary: "/w/notes.md".into(), rule: "Write".into() },
                Ask { tool: "WebFetch".into(), summary: r#"{"prompt":"read it","url":"https://example.com"}"#.into(), rule: "WebFetch".into() },
            ]
        );
        // A long input is cut for a person.
        let long = serde_json::json!({"tool_name": "Grep", "tool_input": {"pattern": "x".repeat(400)}});
        assert_eq!(ask(&long).summary.chars().count(), SHORT);
    }

    #[test]
    fn what_the_owner_allowed_is_passed_only_when_there_is_some() {
        let p = Prompt { native: Some("n".into()), ..Default::default() };
        assert!(!args(&p).contains(&"--allowedTools".to_string()));
        let p = Prompt { allowed: vec!["Bash(touch a b.txt)".into(), "Edit".into()], ..p };
        let a = args(&p);
        let at = a.iter().position(|x| x == "--allowedTools").unwrap();
        assert_eq!(&a[at + 1..], ["Bash(touch a b.txt)", "Edit"]);
        assert_eq!(&a[..5], ["-p", "--output-format", "json", "--resume", "n"]);
    }

    #[test]
    fn the_owners_mode_is_claudes_own() {
        assert_eq!([None, Some(Mode::Ask), Some(Mode::Edits), Some(Mode::All)].map(mode), [None, None, Some("acceptEdits"), Some("bypassPermissions")]);
    }

    #[test]
    fn a_claude_failure_is_the_error_it_gave() {
        let out = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"No conversation found","session_id":"x"}"#;
        assert_eq!(parse(out).unwrap_err(), "No conversation found");
        assert!(parse("not json\n").unwrap_err().contains("no result"));
    }
}
