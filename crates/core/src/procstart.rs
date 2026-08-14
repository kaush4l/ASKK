//! STARTING ONE, and the wrapper that makes it supervisable. Split from
//! `process.rs`, which owns the convention this writes into and the dispatch
//! that calls it, so both hold the 200-line rule (I12).
//!
//! It is its own file because starting is the only one of the four tools that
//! WRITES the convention rather than reading it — `cmd`, `pid`, `cpid`,
//! `started`, and the wrapper that will later write `ended` and `exit` all
//! come from the one script below. Every claim `procwatch` and `proctable`
//! make about a process is a claim about what this script left behind.

use kernel::{base64, shell_quote, Execution};

use crate::process::{blank_as, marked, word, DIR, STATE};

/// The wrapper: run the command with its output captured, and WRITE ITS EXIT
/// STATUS when it finishes. TWO pids, because a browser run found that killing
/// the one it had killed the wrong process — `$!` here is the bookkeeping
/// subshell, and the command is a child of it that went on writing to the log
/// after a KILL reported success. `cpid` is the command, `pid` the wrapper.
///
/// The `sleep 1` is the point of the rest: a command that dies on a typo would
/// otherwise be reported as started and the agent would supervise nothing for
/// the rest of the run. One second on an engine where every command shares a
/// shell; being wrong about "it is running" costs the task.
pub(crate) fn start_script(name: &str, command: &str) -> String {
    let dir = shell_quote(&format!("{DIR}/{name}"));
    let saved = shell_quote(&base64(command.as_bytes()));
    format!(
        "{STATE}d={dir}; mkdir -p \"$d\" || exit 9; \
         if [ \"$(state \"$d\")\" = running ]; then echo \"ALREADY $(cat \"$d/pid\")\"; exit 0; fi; \
         printf %s {saved} | base64 -d > \"$d/cmd\"; date +%s > \"$d/started\"; \
         : > \"$d/log\"; rm -f \"$d/exit\" \"$d/ended\"; \
         ( {{ {command} ; }} >> \"$d/log\" 2>&1 & c=$!; echo $c > \"$d/cpid\"; \
         wait $c; e=$?; date +%s > \"$d/ended\"; echo $e > \"$d/exit\" ) & \
         p=$!; echo $p > \"$d/pid\"; sleep 1; \
         if [ -f \"$d/exit\" ]; then echo \"GONE $(cat \"$d/exit\")\"; \
         tail -n 20 \"$d/log\" 2>/dev/null; else echo \"RUNNING $p\"; fi"
    )
}

/// What the agent is told. A START THAT DID NOT START SAYS SO, with the output
/// explaining it and a non-zero status, so the trace paints it red and
/// `failed::is_failure` counts it: a summary carries the worst state it holds.
pub(crate) fn started(name: &str, ran: &Execution) -> Execution {
    let (head, rest) = marked(&ran.output, &["RUNNING", "ALREADY", "GONE"]);
    let (marker, value) = word(head);
    let log = format!("{DIR}/{name}/log");
    match marker {
        "RUNNING" => Execution {
            status: 0,
            output: format!(
                "{name} is running (pid {value}). Its output is captured to {log} — \
                 read_process({{\"name\": \"{name}\"}}) shows the end of it, and \
                 stop_process({{\"name\": \"{name}\"}}) stops it."
            ),
        },
        "ALREADY" => Execution {
            status: 1,
            output: format!(
                "'{name}' is already running (pid {value}) and was NOT restarted. Stop it first, \
                 or start this one under another name."
            ),
        },
        "GONE" => Execution {
            status: 1,
            output: format!(
                "'{name}' started and exited immediately with status {value}. It is NOT running. \
                 What it wrote:\n{}",
                blank_as(rest, "(nothing)")
            ),
        },
        _ => Execution {
            status: 1.max(ran.status),
            output: format!("'{name}' could not be started: {}", blank_as(&ran.output, "(none)")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{start_script, started};
    use kernel::Execution;

    /// A start that did not start is not a success; the evidence travels.
    #[test]
    fn a_process_that_died_immediately_is_a_failure_carrying_its_output() {
        let said = |o: &str| started("web", &Execution { status: 0, output: o.into() });
        let ok = said("RUNNING 142\n");
        assert!(ok.status == 0 && ok.output.contains("pid 142"), "{}", ok.output);
        let dead = said("GONE 127\nsh: pythn3: not found\n");
        assert!(dead.output.contains("exited immediately"), "{}", dead.output);
        assert!(dead.output.contains("pythn3: not found"), "evidence: {}", dead.output);
        assert_eq!(dead.status, 1);
        let twice = said("ALREADY 142\n");
        assert_eq!(twice.status, 1, "a name in use is refused, not silently reused");
        assert!(twice.output.contains("NOT restarted"), "{}", twice.output);
    }

    /// The command reaches the shell verbatim; its RECORD travels as base64.
    #[test]
    fn the_recorded_command_cannot_be_read_as_shell() {
        let script = start_script("web", "echo 'hi' > out");
        assert!(script.contains("{ echo 'hi' > out ; } >> \"$d/log\""), "{script}");
        assert!(script.contains("$c > \"$d/cpid\""), "the COMMAND's pid, not only the wrapper's");
        assert!(script.contains("base64 -d > \"$d/cmd\""), "{script}");
        assert!(!script.contains("printf %s 'echo"), "the record is not raw: {script}");
        // THE CLAUSE THE LIVENESS STORY RESTS ON: the wrapper records its own
        // exit status, so nothing has to ask the process table — where `kill -0`
        // appears ONCE, inside `state`, only to ask which boot a pid is from.
        assert!(script.contains("wait $c; e=$?;"), "{script}");
        assert!(script.contains("echo $e > \"$d/exit\""), "{script}");
        // …AND WHEN. The end time is stamped BEFORE the exit status, because
        // `state` calls a record finished the moment `exit` exists: the other
        // order leaves a window where a finished process has no length (R10-3).
        let (ended, exit) = (script.find("$d/ended\"").unwrap(), script.find("> \"$d/exit\" )").unwrap());
        assert!(ended < exit, "{script}");
        assert_eq!(script.matches("kill -0").count(), 1, "{script}");
    }
}
