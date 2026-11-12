//! OpenCode, one prompt at a time: `opencode run --format json [--session <id>] [--model
//! <provider/model>] [--auto]`, the prompt on stdin. It prints one JSON event per line, each
//! `{type, timestamp, sessionID, …}`: `text` events carry what it wrote (`part.text`, a piece
//! of the message `part.messageID`, the pieces in order), `error` carries why a run failed
//! (`error.message`; the run exits 1), and `sessionID` is the id `--session` takes to go on.
//!
//! NOT run against an installed program: OpenCode is not installed on the machine this was
//! written on. The wire was read on 2026-11-12 from its source on GitHub (`anomalyco/opencode`,
//! formerly `sst/opencode`, branch `dev`): the `run` command's flags in
//! `packages/cli/src/commands/commands.ts`; how the message is read in
//! `packages/cli/src/run/run.ts` (with no message argument and stdin a pipe, stdin is read in
//! full; an error before the run is one `error` event); the events in
//! `packages/cli/src/run/noninteractive.ts` (`emit`, `text`, `step`) and their shapes as its
//! tests expect them (`packages/cli/test/run/noninteractive.test.ts`). Its docs page
//! (opencode.ai/docs/cli) names `opencode run` and none of its flags.
//!
//! The model comes from this home's `harnesses.json`: OpenCode names one `provider/model`, so
//! a model without a `/` is given the setting's provider in front when there is one.
//!
//! Permissions: `run` cannot ask anyone. Without `--auto` it rejects every permission request
//! and tells the model so (its stderr says `permission requested: … auto-rejecting`; no JSON
//! event carries it, so its replies carry no asks); with `--auto` it approves whatever its own
//! config does not deny. It has no switch for edits alone, so none, `ask` and `edits` pass
//! nothing (the careful default: it reads and answers, and a call that needs a yes is refused),
//! and `all` passes `--auto`, still inside the folder askk's own sandbox allows. What the owner
//! allowed (`Prompt::allowed`) is not passed: it has no flag for one call.
use super::{missing, or_stderr, run};
use crate::core::permit::Mode;
use crate::core::session::{Harness, Prompt, Reply};
use crate::core::Fut;
use serde_json::Value;

const PROGRAM: &str = "opencode";

pub struct OpenCode;

/// The reply in the events the program printed.
fn parse(out: &str) -> Result<Reply, String> {
    let (mut native, mut failed) = (None, None);
    // Each message's pieces, in the order its first piece came.
    let mut said: Vec<(String, String)> = vec![];
    for v in out.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        if let Some(id) = v["sessionID"].as_str().filter(|id| !id.is_empty()) {
            native = Some(id.to_string());
        }
        match v["type"].as_str().unwrap_or_default() {
            "text" => {
                let (m, t) = (v["part"]["messageID"].as_str().unwrap_or_default(), v["part"]["text"].as_str().unwrap_or_default());
                match said.iter_mut().find(|(id, _)| id == m) {
                    Some((_, all)) => all.push_str(t),
                    None => said.push((m.to_string(), t.to_string())),
                }
            }
            "error" if failed.is_none() => failed = Some(v["error"]["message"].as_str().unwrap_or("the run failed").to_string()),
            _ => {}
        }
    }
    let text = said.into_iter().map(|(_, t)| t.trim().to_string()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n\n");
    match (text.is_empty(), failed) {
        (_, Some(why)) => Err(why),
        (false, None) => Ok(Reply { text, native, asks: vec![] }),
        (true, None) => Err("it printed no answer".into()),
    }
}

/// `provider/model` as OpenCode names one; empty = its own default.
fn model(model: &str, provider: &str) -> String {
    match (model, provider) {
        ("", _) => String::new(),
        (m, p) if m.contains('/') || p.is_empty() => m.to_string(),
        (m, p) => format!("{p}/{m}"),
    }
}

/// The program's arguments for a prompt (the prompt itself goes on stdin).
fn args(p: &Prompt) -> Vec<String> {
    let mut args: Vec<String> = ["run", "--format", "json"].map(String::from).into();
    if let Some(id) = &p.native {
        args.extend(["--session".to_string(), id.clone()]);
    }
    let m = model(&p.model, &p.provider);
    if !m.is_empty() {
        args.extend(["--model".to_string(), m]);
    }
    if p.permit == Some(Mode::All) {
        args.push("--auto".to_string());
    }
    args
}

impl Harness for OpenCode {
    fn kind(&self) -> &'static str {
        PROGRAM
    }
    fn about(&self) -> &'static str {
        "OpenCode, the open source coding agent"
    }
    fn missing(&self) -> Option<String> {
        missing(PROGRAM)
    }
    fn state(&self) -> &'static [&'static str] {
        // Its config, its database and logs, its service record (opencode.ai/docs/troubleshooting),
        // and its cache by the same convention (not documented there).
        &[".config/opencode", ".local/share/opencode", ".local/state/opencode", ".cache/opencode"]
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
    fn the_opencode_wire_becomes_a_reply() {
        // The shapes `emit` writes (noninteractive.ts) and its tests expect: a step, a message
        // in two pieces, a tool call, a second message, the step's end.
        let out = r#"{"type":"step_start","timestamp":1,"sessionID":"ses_1","part":{"id":"p0","sessionID":"ses_1","messageID":"msg_assistant","type":"step-start"}}
{"type":"text","timestamp":2,"sessionID":"ses_1","part":{"id":"p1","sessionID":"ses_1","messageID":"msg_assistant","type":"text","text":"projected ","time":{"start":1,"end":2}}}
{"type":"text","timestamp":3,"sessionID":"ses_1","part":{"id":"p1","sessionID":"ses_1","messageID":"msg_assistant","type":"text","text":"answer","time":{"start":1,"end":3}}}
{"type":"tool_use","timestamp":4,"sessionID":"ses_1","part":{"partID":"p2","sessionID":"ses_1","messageID":"msg_assistant","type":"tool","id":"call_1","tool":"read","state":{"status":"completed","input":{},"output":"x","title":"read","metadata":{},"time":{"start":3,"end":4}}}}
{"type":"text","timestamp":5,"sessionID":"ses_1","part":{"id":"p3","sessionID":"ses_1","messageID":"msg_two","type":"text","text":"done","time":{"start":4,"end":5}}}
{"type":"step_finish","timestamp":6,"sessionID":"ses_1","part":{"id":"p4","sessionID":"ses_1","messageID":"msg_two","type":"step-finish","reason":"stop","cost":0.25}}
"#;
        assert_eq!(parse(out).unwrap(), Reply { text: "projected answer\n\ndone".into(), native: Some("ses_1".into()), asks: vec![] });
    }

    #[test]
    fn an_opencode_failure_is_the_error_it_gave() {
        // As its test "reports an observed execution failure before prompt promotion" expects,
        // and as `reportRunError` writes one before a session exists (an empty sessionID).
        let out = r#"{"type":"error","timestamp":1,"sessionID":"ses_1","error":{"type":"provider.transport","message":"instructions unavailable"}}"#;
        assert_eq!(parse(out).unwrap_err(), "instructions unavailable");
        let early = r#"{"type":"error","timestamp":1,"sessionID":"","error":{"type":"unknown","message":"You must provide a message"}}"#;
        assert_eq!(parse(early).unwrap_err(), "You must provide a message");
        assert!(parse("").unwrap_err().contains("no answer"));
    }

    #[test]
    fn a_prompt_is_given_in_opencodes_own_flags() {
        assert_eq!(args(&Prompt::default()), ["run", "--format", "json"]);
        let p = Prompt { native: Some("ses_1".into()), model: "claude-sonnet-4-5".into(), provider: "anthropic".into(), permit: Some(Mode::All), allowed: vec!["Edit".into()], ..Default::default() };
        assert_eq!(args(&p), ["run", "--format", "json", "--session", "ses_1", "--model", "anthropic/claude-sonnet-4-5", "--auto"]);
        // Only `all` lets it approve its own requests; it has no switch for edits alone.
        for permit in [None, Some(Mode::Ask), Some(Mode::Edits)] {
            assert!(!args(&Prompt { permit, ..Default::default() }).contains(&"--auto".to_string()));
        }
        assert_eq!(model("openai/gpt-5", "anthropic"), "openai/gpt-5");
        assert_eq!(model("gpt-5", ""), "gpt-5");
        assert_eq!(model("", "anthropic"), "");
    }
}
