//! Muse Code, one prompt at a time: `muse exec --json [--session-id <id>] [--model <id>]
//! [--provider <mode>] -- <prompt>`. It prints one JSON event per line. Every event carries
//! the session it belongs to (`stream: {kind: session, id}`), which `--session-id` takes to go
//! on with it; the run ends with a `run.terminal.*` event whose payload holds how it ended
//! (`terminal`), the whole answer (`text`) and, when it did not complete, why (`reason`).
//!
//! Checked against the installed program (1.4.15) on 2026-11-10 with real runs of its `echo`
//! provider: a first prompt, a second on the same session id, and a prompt beginning with a
//! dash. A run with no sign-in prints no events, only the reason on stderr. The prompt is an
//! argument: `exec` does not read it from stdin.
//!
//! The model and the provider come from this home's `harnesses.json`; none there = Muse's own.
use super::{missing, or_stderr, run};
use crate::core::session::{Harness, Prompt, Reply};
use crate::core::Fut;
use serde_json::Value;

const PROGRAM: &str = "muse";

pub struct Muse;

/// The reply in the events the program printed.
fn parse(out: &str) -> Result<Reply, String> {
    let (mut native, mut end) = (None, None);
    for v in out.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        if v["stream"]["kind"] == "session" {
            native = v["stream"]["id"].as_str().map(String::from).or(native);
        }
        if v["payload_type"].as_str().is_some_and(|t| t.starts_with("run.terminal.")) {
            end = Some(v["payload"].clone());
        }
    }
    let end = end.ok_or("it printed no answer")?;
    let how = end["terminal"].as_str().unwrap_or_default();
    if how != "completed" {
        return Err(end["reason"].as_str().filter(|r| !r.is_empty()).map(String::from).unwrap_or_else(|| format!("the run ended as '{how}'")));
    }
    Ok(Reply { text: end["text"].as_str().unwrap_or_default().to_string(), native })
}

impl Harness for Muse {
    fn kind(&self) -> &'static str {
        PROGRAM
    }
    fn about(&self) -> &'static str {
        "Muse Code, Meta's coding agent"
    }
    fn missing(&self) -> Option<String> {
        missing(PROGRAM)
    }
    fn state(&self) -> &'static [&'static str] {
        // Settings and sign-in, sessions, and the launcher's own update marks beside it.
        &[".config/muse", ".local/share/muse", ".local/bin/.muse", ".local/bin/muse"]
    }
    fn prompt(&self, p: Prompt) -> Fut<Result<Reply, String>> {
        let state = self.state();
        Box::pin(async move {
            let mut args: Vec<String> = ["exec", "--json"].map(String::from).into();
            for (flag, value) in [("--session-id", p.native.as_deref().unwrap_or_default()), ("--model", p.model.as_str()), ("--provider", p.provider.as_str())] {
                if !value.is_empty() {
                    args.extend([flag.to_string(), value.to_string()]);
                }
            }
            // After `--`, so a prompt that begins with a dash is still the prompt.
            args.extend(["--".to_string(), p.text.clone()]);
            let ran = run(PROGRAM, &args, "", &p.project, state).await?;
            or_stderr(PROGRAM, parse(&ran.out), &ran)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_muse_wire_becomes_a_reply() {
        // The fields this adapter reads, from a run of the installed program.
        let out = r#"{"schema_version":1,"stream":{"kind":"session","id":"01a1c83d-73a2-7e63-a06e-08e41e0acf03"},"sequence":3,"payload_type":"turn.input.user","payload":{"kind":"turn_input_user","prompt":"Reply with exactly: pong"}}
{"schema_version":1,"stream":{"kind":"session","id":"01a1c83d-73a2-7e63-a06e-08e41e0acf03"},"sequence":17,"payload_type":"run.output.delta","payload":{"kind":"run_output_delta","text":"echo: Reply with exactly: pong"}}
{"schema_version":1,"stream":{"kind":"exec.usage","id":"01a1c83d-73a2-7e63-a06e-08e41e0acf03"},"sequence":1,"payload_type":"run.usage","payload":{"kind":"run_usage","calls":1}}
{"schema_version":1,"stream":{"kind":"session","id":"01a1c83d-73a2-7e63-a06e-08e41e0acf03"},"sequence":34,"payload_type":"run.terminal.completed","payload":{"kind":"run_terminal","terminal":"completed","text":"echo: Reply with exactly: pong","reason":null}}"#;
        assert_eq!(parse(out).unwrap(), Reply { text: "echo: Reply with exactly: pong".into(), native: Some("01a1c83d-73a2-7e63-a06e-08e41e0acf03".into()) });
    }

    #[test]
    fn a_muse_run_that_did_not_complete_says_why() {
        let failed = r#"{"stream":{"kind":"session","id":"s"},"payload_type":"run.terminal.failed","payload":{"kind":"run_terminal","terminal":"failed","text":"","reason":"model refused"}}"#;
        assert_eq!(parse(failed).unwrap_err(), "model refused");
        let bare = r#"{"stream":{"kind":"session","id":"s"},"payload_type":"run.terminal.cancelled","payload":{"terminal":"cancelled","reason":null}}"#;
        assert!(parse(bare).unwrap_err().contains("cancelled"));
        // No sign-in: no events at all (the reason is on stderr).
        assert!(parse("").unwrap_err().contains("no answer"));
    }
}
