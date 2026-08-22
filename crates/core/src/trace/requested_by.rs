//! WHO ASKED for a tool call — page, agent, or sub-agent. Its own file because
//! "who did this" is a question two readers ask: the trace and the workspace
//! scrollback.

use context::Args;
use kernel::EventKind;

/// Whether this `exec` is one of the commands a PERSON typed, popping the
/// request when it is. `pub(crate)` for the workspace scrollback, which shows
/// the same facts and said nothing about who ran them (R3-18).
///
/// BY VALUE, NOT BY POSITION (R11-5). This matched the HEAD of the queue only,
/// on the argument that the queue is in log order and the oldest unaccounted
/// request is the oldest call. That holds exactly as long as every request
/// becomes a call — and the request whose command never returns never does. One
/// wedged `while true` left its own request stuck at the head for the rest of
/// the session, so the next command a person typed was compared against it,
/// missed, and was filed in the permanent record as the AGENT's: `main ran $ id;
/// echo marker-from-user`, for something the person had typed themselves.
/// `pop_stop` already matched by name for the identical reason; two identical
/// commands still come apart, because equal entries are popped oldest first.
///
/// Each entry carries where its request sits in the log, and popping returns
/// it: that index is the call's START (R13-4, `trace::row::when`).
pub(crate) fn pop_typed(typed: &mut Vec<(&str, usize)>, args: &str) -> Option<usize> {
    let ran = crate::terminal::row::command_of(args);
    // BOTH SIDES, THE ONE WAY THE GATE READS IT: it trims what it runs.
    let at = typed.iter().position(|(head, _)| typed_command(head).trim() == ran)?;
    Some(typed.remove(at).1)
}

/// The command inside an `EXEC_REQUEST` payload — a JSON string, or the raw
/// text if it was never one. `pub(crate)` because `terminal/row_selection` renders the
/// requests that never became a call (R12-5) and must read them the same way
/// the matcher above does.
pub(crate) fn typed_command(payload_json: &str) -> String {
    serde_json::from_str::<String>(payload_json)
        .unwrap_or_else(|_| payload_json.to_string())
}

/// Which process a `stop_process` call was about. `name` is a NAME and the
/// reading is the EXECUTOR's — `agent::process_name`
/// (`crates/core/src/proc/convention.rs:72`) — because a match is only a match
/// when both sides read alike. `""` for a name it would refuse: no such process
/// was started, so there is no press to find.
fn name_of(args_json: &str) -> String {
    let said = Args::parse(args_json);
    agent::process_name(said.name("name").unwrap_or_default()).unwrap_or_default()
}

/// THE THIRD ACTOR'S NAME (R6-10, renamed R16-1). Not `you` and not the agent:
/// the panels list a folder on mount and poll for processes, and that is work
/// nobody asked for. It was called `the file pane` — a name printed on no
/// panel in the product, and wrong for the Processes panel's own polling. What
/// a reader can check is that the PAGE did it.
pub(crate) const PANE: &str = "this page";

/// EVERY REQUEST THAT WAS NOT THE AGENT'S, in log order: commands typed into
/// the Workspace, and paths the file panes asked for. Each call is matched
/// against the request that preceded it; everything unmatched is the agent's.
/// …AND WHEN IT WAS ASKED FOR (R13-4). Every queue below now carries where its
/// request sat in the log, because that index is the only START a finished call
/// has: the `ToolInvoked` fact is appended when the call RETURNS. `actor` hands
/// it back with the actor it already returned, so the trace gets both facts off
/// one pop and the two cannot come apart.
#[derive(Default)]
pub(crate) struct Asked<'a> {
    typed: Vec<(&'a str, usize)>,
    /// Each pending path, WHO it will belong to when its call arrives, and
    /// where the request that made it sits in the log.
    paths: Vec<(String, &'static str, usize)>,
    /// Refreshes the Processes pane asked for, in log order. Matched on ORDER
    /// alone: the call carries no arguments at all, so there is nothing else to
    /// match on — the same soft edge two identical `exec`s have, and for the
    /// same reason (only a new field on the event closes it).
    procs: Vec<usize>,
    /// Processes a PERSON pressed Stop on, in order. A name, not a count: the
    /// call carries one and matching on it is free, and a stop is a gesture
    /// rather than the pane's own housekeeping — it belongs to `you`.
    stops: Vec<(String, usize)>,
}

impl<'a> Asked<'a> {
    /// One event, added to whichever queue it belongs in.
    pub(crate) fn enqueue(&mut self, nth: usize, kind: &'a EventKind) {
        let EventKind::Custom { kind, payload_json } = kind else { return };
        if kind == crate::terminal::pane::EXEC_REQUEST {
            self.typed.push((payload_json, nth));
        }
        if kind == crate::proc::pane::PANE_REQUEST {
            self.procs.push(nth);
            let said = serde_json::from_str::<String>(payload_json).unwrap_or_default();
            if let Ok(pressed) = agent::process_name(&said) {
                self.stops.push((pressed, nth));
            }
        }
        // Both file requests are a `(path, _)` pair, which is the whole reason
        // they can share one queue.
        if kind == crate::files::pane::OPEN_REQUEST || kind == crate::files::pane::SAVE_REQUEST {
            self.enqueue_path(kind, payload_json, nth);
        }
    }

    /// A file request, queued under the path the GATE will read
    /// (`agent::relative_path`, `crates/core/src/workspace/gate/files.rs:41`) — which
    /// is how `pop_path` compares it against `files::listing::path_of`: one
    /// reading of the argument, not two that agree by luck.
    ///
    /// A SAVE IS TWO CALLS (R5-12). `workspace::save_typed` writes the file and
    /// then READS IT BACK — that read is what makes the pane show what is on
    /// disk rather than what was typed. One request accounted for the write
    /// alone, so the read came out as the agent's, over a file nobody had asked
    /// it for. …and the two halves have different OWNERS (R6-10). The write is
    /// the press: a person typed those bytes and pressed `Save to the
    /// workspace`. The read back is the pane refreshing itself, and an OPEN is
    /// the pane's throughout — it lists the root on mount and re-lists on every
    /// status change, so most of that queue was never a gesture at all.
    fn enqueue_path(&mut self, kind: &str, payload_json: &str, nth: usize) {
        let Ok((asked, _)) = serde_json::from_str::<(String, serde_json::Value)>(payload_json)
        else {
            return;
        };
        let path = agent::relative_path(&asked).unwrap_or(asked);
        match kind == crate::files::pane::SAVE_REQUEST {
            true => {
                self.paths.push((path.clone(), "you", nth));
                self.paths.push((path, PANE, nth));
            }
            false => self.paths.push((path, PANE, nth)),
        }
    }

    /// Who this call belongs to. Popping is what keeps two identical requests
    /// apart; an unmatched call is the agent's, which is certain.
    /// …AND WHERE THE REQUEST THAT ASKED FOR IT SITS IN THE LOG, which is the
    /// only start a finished call has (R13-4). `None` is the agent's own call:
    /// nothing preceded it, so the log holds its ending and nothing else.
    pub(crate) fn actor<'b>(
        &mut self,
        tool: &str,
        args: &str,
        who: &'b str,
    ) -> (&'b str, Option<usize>) {
        if tool == "exec" {
            if let Some(nth) = pop_typed(&mut self.typed, args) {
                return ("you", Some(nth));
            }
        }
        if matches!(tool, "list_files" | "read_file" | "write_file") {
            return match self.pop_path(args) {
                Some((by, nth)) => (by, Some(nth)),
                None => (who, None),
            };
        }
        match tool {
            // The Processes pane polls, like the file panes do, and its own
            // housekeeping is not the agent's work (R6-10).
            "list_processes" if !self.procs.is_empty() => (PANE, Some(self.procs.remove(0))),
            // …AND THE PRESS THAT CAUSED ONE (R10-6). A stop from the pane's
            // button is a person's act, and a trace attributing it to the agent
            // would credit the model with a decision nobody let it make.
            //
            // BY NAME, NOT BY POSITION. The other queues here match on their
            // head because two `exec`s carry nothing to tell them apart; a stop
            // carries the name, so an abandoned request — the page reloaded
            // between the press and the call — cannot make every later press
            // read as the agent's. Measured in a browser: one wedged request
            // left the next stop attributed to `main`.
            "stop_process" => match self.pop_stop(&name_of(args)) {
                Some(nth) => ("you", Some(nth)),
                None => (who, None),
            },
            _ => (who, None),
        }
    }

    /// This name's own pending press, wherever it is in the queue.
    fn pop_stop(&mut self, name: &str) -> Option<usize> {
        let at = self.stops.iter().position(|(n, _)| n == name)?;
        Some(self.stops.remove(at).1)
    }

    /// This path's own pending request and its owner, wherever it is in the
    /// queue. BY PATH, NOT BY POSITION, for the reason `pop_typed` explains
    /// (R11-5): one abandoned request at the head — a listing whose call never
    /// came back because the workspace was wedged behind something else — filed
    /// every later click the person made under the agent's name, including the
    /// `list_files path=.harness/proc/…` a press on a process row produces.
    fn pop_path(&mut self, args: &str) -> Option<(&'static str, usize)> {
        let want = crate::files::listing::path_of(args);
        let at = self.paths.iter().position(|(path, _, _)| *path == want)?;
        let (_, by, nth) = self.paths.remove(at);
        Some((by, nth))
    }
}
