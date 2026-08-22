//! LONG-RUNNING PROCESSES — the convention they are kept in, the dispatch for
//! the four tools that supervise them, and the shape every one of those tools'
//! scripts answers in. The work itself is three siblings: `start.rs` starts
//! one, `table.rs` lists them all, `watch.rs` reads and stops one. What is HERE
//! is what all three share and none of them owns.
//!
//! Everything here is `WorkspacePort::exec` and nothing else (ADR-013): no new
//! port method, no second way into the Linux. What it adds is a CONVENTION kept
//! in the workspace — `.harness/proc/<name>/` holding `cmd`, `pid`, `cpid`,
//! `started`, `log` and, once it finishes, `ended` and `exit` — so a
//! supervisor's state is on the same disk the agent has, browsable in the Files
//! pane, not in memory where a reload would eat it. IDENTITY IS A NAME THE MODEL
//! CHOSE: a pid is not stable across a reload, and `web` is what a model
//! remembers.
//!
//! LIVENESS IS NOT `kill -0`, AND THAT WAS FOUND IN A BROWSER. The first cut
//! asked the process table. On the engine this ships on, `kill -0` succeeds for
//! pid 1, 3, 5 and 7 — long-dead `ls` processes it never reaped — so every
//! record read `running` for ever, and `stop_process` reported that a process
//! it had genuinely killed had survived TERM and KILL. So the FILESYSTEM
//! answers it: the wrapper writes its exit status to `exit` when the command
//! finishes, and that file is the only claim of "finished" made here. `kill -0`
//! is still asked, but ONLY the narrower question it answers correctly — was
//! this pid used in THIS boot — which is how a record from before a reload
//! comes back as `gone` rather than as something running for two days. (The
//! second cut used `/proc/uptime` for that and read `0 0`: assume
//! `WorkspacePort::exec` and a POSIX shell, and assume nothing else.)
//!
//! The OUTPUT a model reads is ours, from tab-separated fields, never forwarded
//! from `ps`: an agent handed `ps aux` to parse will misparse it.

use kernel::{Execution, WorkspacePort};

use crate::workspace::gate::unavailable;

/// Where a started process keeps its record, under the workspace root.
pub(crate) const DIR: &str = ".harness/proc";

/// `state <dir>` — the one liveness predicate, prepended to every script that
/// needs it so start, list, read and stop cannot answer it four ways. Prints
/// `running`, `stopped`, `exited(<n>)`, `gone` or `unknown`: the `exit` file
/// decides "finished", `kill -0` only "this pid is from the boot now running".
/// Ceiling: a stale pid a new boot reissued reads as `running`.
pub(crate) const STATE: &str = "state() { [ -f \"$1/pid\" ] || { echo unknown; return; }; \
     if [ -f \"$1/exit\" ]; then e=$(cat \"$1/exit\"); \
     case \"$e\" in stopped) echo stopped;; *) echo \"exited($e)\";; esac; return; fi; \
     if kill -0 \"$(cat \"$1/pid\")\" 2>/dev/null; then echo running; else echo gone; fi; }; ";

/// One process tool, or `None` if this is not one. Total: a refusal is a result
/// the model can act on, never an error return.
///
/// THE EXAMPLE IN THE REFUSAL BELOW IS A COMMAND THIS GUEST CAN RUN (T20, I16).
/// It said `python3 -m http.server`, which describes a computer we do not ship:
/// there is no `apk add` line in `image/Dockerfile` and no network in the guest
/// to add one with, so a model reading this refusal — at the moment it is least
/// certain — spent its next turn on a missing interpreter. The command named
/// now is drawn from `agent::environment::BINARIES`, and
/// `crates/agent/tests/stated.rs` fails if this line ever drifts off it again.
pub(crate) async fn run(
    port: &dyn WorkspacePort,
    root: &str,
    tool: &str,
    arg: &dyn Fn(&str) -> String,
) -> Option<Result<Execution, String>> {
    let named = || agent::process_name(&arg("name"));
    let sh = |s: String| async move { port.exec(root, &s).await.map_err(unavailable) };
    use crate::proc::start::{start_script, started};
    use crate::proc::table as table;
    use crate::proc::watch as watch;
    Some(match tool {
        "start_process" => match (named(), arg("command").trim().to_string()) {
            (Err(refusal), _) => Err(refusal),
            (_, empty) if empty.is_empty() => Err("no command given. Call it as \
                 start_process({\"name\": \"watch\", \"command\": \"tail -f log\"})"
                .into()),
            (Ok(name), cmd) => sh(start_script(&name, &cmd)).await.map(|r| started(&name, &r)),
        },
        "list_processes" => sh(table::list_script()).await.map(|r| Execution {
            status: r.status,
            output: table::table(&r.output),
        }),
        "read_process" => match named() {
            Err(refusal) => Err(refusal),
            Ok(n) => sh(watch::read_script(&n)).await.map(|r| watch::tailed(&n, &r)),
        },
        "stop_process" => match named() {
            Err(refusal) => Err(refusal),
            Ok(n) => sh(watch::stop_script(&n)).await.map(|r| watch::stopped(&n, &r)),
        },
        _ => return None,
    })
}

/// The first line and the rest, then that line as `(marker, value)` — the one
/// shape every script here and in `proc/watch` answers in.
pub(crate) fn split_head(text: &str) -> (&str, &str) {
    match text.trim_start_matches('\n').split_once('\n') {
        Some((head, rest)) => (head.trim_end(), rest),
        None => (text.trim(), ""),
    }
}

/// THE LINE THE SCRIPT WROTE, FOUND BY ITS MARKER RATHER THAN BY POSITION.
///
/// The guest's shell may put a line of its OWN in front of it. On
/// container2wasm a `kill` makes the shell announce `Terminated`, so
/// `stop_process` read that as its marker and told the agent that a process it
/// had just killed could not be stopped — a tool reporting failure for work it
/// did. The markers are ours and unambiguous, so the parser looks for one
/// instead of trusting the first line; with none found it falls back to
/// `split_head`, which is what the "could not" arms already handle.
pub(crate) fn marked<'a>(text: &'a str, markers: &[&str]) -> (&'a str, &'a str) {
    let mut at = text;
    loop {
        let (head, rest) = split_head(at);
        // A marker ending in `(` matches by PREFIX: `exited(7)` carries its
        // status inside the word, and the state script has always written it
        // that way.
        let w = word(head).0;
        if markers.iter().any(|m| w == *m || (m.ends_with('(') && w.starts_with(m))) {
            return (head, rest);
        }
        if rest.trim().is_empty() {
            return split_head(text);
        }
        at = rest;
    }
}

pub(crate) fn word(line: &str) -> (&str, &str) {
    line.trim().split_once(' ').map_or((line.trim(), "?"), |(m, v)| (m, v.trim()))
}

pub(crate) fn blank_as<'a>(text: &'a str, said: &'a str) -> &'a str {
    match text.trim().is_empty() {
        true => said,
        false => text.trim_end(),
    }
}
