//! ONE NAMED PROCESS — read its output, stop it. `table.rs` next door is the
//! listing of all of them; acting on one is this file.
//!
//! Each is one shell script emitting a shape WE defined, parsed and re-rendered
//! here: `ps aux` forwarded to a model is a parsing task handed to the worst
//! parser available, and its columns differ between busybox and coreutils.

use kernel::{shell_quote, Execution};

use crate::proc::convention::{blank_as, marked, split_head, word, DIR, STATE};

/// State, line count, `--`, then the last 40 lines.
pub(crate) fn read_script(name: &str) -> String {
    let dir = shell_quote(&format!("{DIR}/{name}"));
    format!(
        "{STATE}d={dir}; [ -d \"$d\" ] || {{ echo MISSING; exit 0; }}; \
         echo \"$(state \"$d\") $(cat \"$d/pid\" 2>/dev/null)\"; \
         wc -l < \"$d/log\" 2>/dev/null || echo 0; echo '--'; tail -n 40 \"$d/log\" 2>/dev/null"
    )
}

/// The tail with the state above it: an empty log from a live server and one from
/// a dead process are different facts.
pub(crate) fn tailed(name: &str, ran: &Execution) -> Execution {
    let (head, rest) = marked(
        &ran.output,
        &["running", "gone", "stopped", "exited(", "unknown", "MISSING"],
    );
    let (marker, pid) = word(head);
    if marker == "MISSING" || marker == "unknown" || marker.is_empty() {
        return Execution {
            status: 1,
            output: format!(
                "No process called '{name}' was started here. list_processes() \
                 says which were."
            ),
        };
    }
    let (total, body) = split_head(rest);
    let body = body.strip_prefix("--\n").unwrap_or(body);
    let state = match marker {
        "running" => format!("{name} is running (pid {pid})"),
        "gone" => format!("{name} is gone: it was started before this page's Linux was rebuilt"),
        word => format!("{name} is not running any more ({word}, pid {pid})"),
    };
    let held = total.trim().parse::<u64>().map_or("output".into(), |n| format!("{n} line(s)"));
    Execution {
        status: 0,
        output: format!(
            "{state}. {held} in {DIR}/{name}/log; the end of it:\n{}",
            blank_as(body, "(nothing yet)")
        ),
    }
}

/// TERM then KILL — BOTH pids, the command and its wrapper, because killing only
/// the wrapper left the command writing to the log (see `start_script`). Then the
/// one check the machine cannot lie about: did the log keep GROWING? The process
/// table is not to be believed here, so output still arriving is the only positive
/// evidence a stop failed; silence is not proof of death, which is why the verdict
/// claims no more than the log does.
pub(crate) fn stop_script(name: &str) -> String {
    let dir = shell_quote(&format!("{DIR}/{name}"));
    format!(
        "{STATE}d={dir}; [ -d \"$d\" ] || {{ echo MISSING; exit 0; }}; \
         pid=$(cat \"$d/pid\" 2>/dev/null); c=$(cat \"$d/cpid\" 2>/dev/null || echo \"$pid\"); \
         [ \"$(state \"$d\")\" = running ] || {{ echo \"NOTRUNNING $pid\"; exit 0; }}; \
         a=$(wc -c < \"$d/log\" 2>/dev/null || echo 0); \
         kill $c $pid 2>/dev/null; sleep 1; kill -9 $c $pid 2>/dev/null; sleep 1; \
         z=$(wc -c < \"$d/log\" 2>/dev/null || echo 0); \
         if [ -f \"$d/exit\" ] || [ \"$a\" = \"$z\" ]; then \
         [ -f \"$d/exit\" ] || {{ date +%s > \"$d/ended\"; echo stopped > \"$d/exit\"; }}; \
         echo \"STOPPED $pid\"; \
         else echo \"ALIVE $pid\"; fi"
    )
}

pub(crate) fn stopped(name: &str, ran: &Execution) -> Execution {
    let (marker, pid) = word(marked(&ran.output, &["STOPPED", "NOTRUNNING", "ALIVE", "MISSING"]).0);
    let kept = format!("Its output is still in {DIR}/{name}/log.");
    let gone = blank_as(&ran.output, "(no output)");
    let (status, said) = match marker {
        "STOPPED" => (0, format!("{name} (pid {pid}) is stopped. {kept}")),
        "NOTRUNNING" => (0, format!("{name} was already not running. {kept}")),
        "ALIVE" => (
            1,
            format!("{name} (pid {pid}) did NOT stop: it is still writing to its log after KILL."),
        ),
        "MISSING" => (1, format!("No process called '{name}' was started here.")),
        _ => (1, format!("{name} could not be stopped: {gone}")),
    };
    Execution { status, output: said }
}

#[cfg(test)]
mod tests {
    use super::{stopped, tailed};
    use kernel::Execution;

    fn ran(output: &str) -> Execution {
        Execution { status: 0, output: output.into() }
    }

    /// THE GUEST'S SHELL GETS A LINE IN FIRST, AND THE ANSWER IS STILL OURS.
    /// container2wasm's `sh` announces `Terminated` when the kill lands, which
    /// used to be read as the marker: a process that HAD been stopped was
    /// reported as one that could not be. Same for a read whose state line is
    /// preceded by noise.
    #[test]
    fn a_shell_notice_in_front_of_the_marker_is_not_the_marker() {
        let out = stopped("ticker", &ran("Terminated\nSTOPPED 23\n"));
        assert_eq!(out.status, 0, "{}", out.output);
        assert!(out.output.contains("(pid 23) is stopped"), "{}", out.output);
        let read = tailed("ticker", &ran("[1]+ Terminated\nrunning 23\n0\n--\n"));
        assert!(read.output.contains("ticker is running (pid 23)"), "{}", read.output);
        // …and a capture with no marker at all is still a failure, not a
        // silent success invented by scanning past the end.
        let lost = stopped("ticker", &ran("something else entirely\n"));
        assert_eq!(lost.status, 1, "{}", lost.output);
    }

    /// Output without its state is output that will be misread.
    #[test]
    fn the_tail_says_whether_the_process_is_still_producing_it() {
        let live = tailed("web", &ran("running 142\n3\n--\nserving\n"));
        assert!(live.output.starts_with("web is running (pid 142)"), "{}", live.output);
        assert!(live.output.contains("serving"), "{}", live.output);

        let dead = tailed("web", &ran("exited(127) 142\n0\n--\n"));
        assert!(dead.output.contains("not running any more (exited(127)"), "{}", dead.output);
        assert!(dead.output.contains("(nothing yet)"), "{}", dead.output);

        // A MACHINE THAT NO LONGER EXISTS IS ITS OWN ANSWER, not "it exited".
        let gone = tailed("web", &ran("gone 142\n0\n--\n"));
        assert!(gone.output.contains("Linux was rebuilt"), "{}", gone.output);

        let never = tailed("web", &ran("MISSING\n"));
        assert_eq!(never.status, 1);
        assert!(never.output.contains("list_processes()"), "{}", never.output);
    }

    /// A stop that did not stop is a failure, not a stop.
    #[test]
    fn a_process_that_survived_the_kill_is_not_reported_as_stopped() {
        assert_eq!(stopped("web", &ran("STOPPED 142\n")).status, 0);
        assert_eq!(stopped("web", &ran("NOTRUNNING 142\n")).status, 0);
        let alive = stopped("web", &ran("ALIVE 142\n"));
        assert_eq!(alive.status, 1);
        assert!(alive.output.contains("did NOT stop"), "{}", alive.output);
    }
}
