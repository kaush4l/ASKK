//! # Code on the server: `node`
//!
//! The server's place to run an engine's program ([`crate::core::code`]). The program runs in
//! a fresh `node` process, inside an empty context: it has the language and `console`, and
//! nothing else (no `require`, no `process`, no files, no network). A run that does not end
//! is stopped: a loop by the context's own limit, anything else by ending the process.
//!
//! Only JavaScript, the language a browser tab runs too, so an engine's program works on both.
use crate::core::code::Code;
use crate::core::Fut;
use serde_json::Value;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

/// What `node` runs: read the program from standard input, run it in an empty context,
/// write one line of JSON (`ok`, `result`, `stdout`, `error`).
const WRAP: &str = r#"
const vm = require("vm");
const limit = Number(process.argv[1]) || 10000;
const show = v => { if (typeof v === "string") return v; try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (_) { return String(v); } };
let src = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", d => src += d).on("end", async () => {
  const out = [];
  const log = (...a) => out.push(a.map(show).join(" "));
  const context = vm.createContext({ console: { log, info: log, warn: log, error: log, debug: log } });
  let reply;
  try {
    let v = await vm.runInContext(src, context, { timeout: limit });
    let result = null;
    if (v !== undefined) { try { const s = JSON.stringify(v); result = s === undefined ? String(v) : JSON.parse(s); } catch (_) { result = String(v); } }
    reply = { ok: true, result, stdout: out.join("\n") };
  } catch (e) {
    reply = { ok: false, error: e && e.name ? e.name + ": " + e.message : String(e), stdout: out.join("\n") };
  }
  process.stdout.write(JSON.stringify(reply), () => process.exit(0));
});
"#;

/// Is there a `node` to run? Asked once at start, so the build can say what it can do.
pub fn found() -> bool {
    std::process::Command::new("node").arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

pub struct Node;

async fn run(code: String, timeout_ms: u64) -> Result<Value, String> {
    let mut child = tokio::process::Command::new("node")
        .args(["-e", WRAP, &timeout_ms.to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("node could not be started: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(code.as_bytes()).await.map_err(|e| format!("the program could not be handed to node: {e}"))?;
    }
    // The context's own limit stops a loop; this one stops a program that waits for ever.
    let limit = std::time::Duration::from_millis(timeout_ms + 2_000);
    let out = match tokio::time::timeout(limit, child.wait_with_output()).await {
        Ok(out) => out.map_err(|e| format!("node: {e}"))?,
        Err(_) => return Err(format!("the program did not end within {timeout_ms} ms and was stopped")),
    };
    serde_json::from_slice(&out.stdout).map_err(|_| {
        let said = String::from_utf8_lossy(&out.stderr);
        format!("node gave no result: {}", said.lines().last().unwrap_or("it said nothing"))
    })
}

impl Code for Node {
    fn languages(&self) -> Vec<String> {
        vec!["js".into()]
    }
    fn run(&self, _language: String, code: String, timeout_ms: u64) -> Fut<Result<Value, String>> {
        Box::pin(run(code, timeout_ms))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::code::outcome;

    #[tokio::test]
    async fn a_program_gives_its_last_value_and_what_it_printed_and_cannot_reach_the_machine() {
        if !found() {
            eprintln!("not checked: node is not installed");
            return;
        }
        let ok = outcome(&run("console.log('hi', {a: 1}); [1, 2, 3].map(x => x * x)".into(), 5_000).await.unwrap()).unwrap();
        assert_eq!(ok, serde_json::json!({"result": [1, 4, 9], "stdout": "hi {\"a\":1}"}));
        let waited = outcome(&run("new Promise(r => r(6 * 7))".into(), 5_000).await.unwrap()).unwrap();
        assert_eq!(waited["result"], 42, "a promise is waited for");
        for reach in ["require('fs')", "process.exit(3)", "fetch('http://example.com')"] {
            let e = outcome(&run(reach.into(), 5_000).await.unwrap()).unwrap_err();
            assert!(e.contains("is not defined"), "`{reach}` must not exist in the sandbox: {e}");
        }
        let e = outcome(&run("while (true) {}".into(), 300).await.unwrap()).unwrap_err();
        assert!(e.contains("timed out"), "a loop is stopped: {e}");
    }
}
