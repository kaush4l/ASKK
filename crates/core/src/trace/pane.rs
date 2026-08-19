//! What the tool trace LOOKS like. `crate::tools` owns running a tool; this
//! file owns rendering what running it produced — a projection of the
//! `ToolInvoked` facts and nothing else (I8).

use kernel::{EventKind, Response};
use module::view::FragmentBuilder;

use crate::dispatch::{html, Ctx};
use crate::trace::requested_by::{Asked, PANE};
use crate::trace::from_worker::{at, reported};
use crate::trace::row::row;

/// THE SHELL IS NOT IN HERE (R15-P1-4). Commands and Tool trace were two logs
/// of the same events — every `exec` verbatim in both — while Commands stated
/// in prose that the trace held the rest. Of the reviewer's two ways out, this
/// is "filter `exec` out of the trace" rather than "delete Commands": Commands
/// is not only a log, it is the box you TYPE into and the stop control for a
/// command in flight, so deleting it deletes a control where deleting the rows
/// deletes only the duplication. The count rides on a header, because a pane
/// that leaves rows out says how many and where they went.
pub(crate) fn is_shell(tool: &str) -> bool {
    tool == "exec"
}

/// The trace: every call this session, in log order, with its arguments and
/// what came back. A projection of the log and nothing else (I8).
///
/// `app_activity` is the toggle R7-1 argued for. The file panes list a folder
/// on mount and re-list it on every status change, and a log named for the
/// agent was 78% the app talking to itself — seventy pane rows to twenty of
/// the agent's, growing by ten per visit to Workspace. The facts are all still
/// here and all still projected; by default this answers the question the pane
/// is titled with, and the toggle answers the other one.
pub(crate) fn trace(ctx: &Ctx, who: &str, app_activity: bool) -> Response {
    // A tool call happens inside the calling agent's own loop, so the only
    // `ToolInvoked` facts this log holds are this process's agent's. Anyone
    // else's are their Worker's own report.
    if who != ctx.me {
        return reported(ctx, who);
    }
    let mut list = FragmentBuilder::new("div").id("tool-trace").attr("data-agent", who);
    let mut count = 0usize;
    // WHO asked for each call. A shell command a person typed in the Workspace
    // and a command the agent chose land as the same `ToolInvoked` fact, in the
    // same list, in the same card — and in an audit view for autonomous agents
    // "who did this" is the fact that matters most (F14).
    //
    // The fact itself does NOT record an initiator, and this does not invent
    // one. What the log DOES hold is the request: typing a command emits
    // `core.exec_request` with that text (`terminal::EXEC_REQUEST`) BEFORE the
    // `exec` it becomes, so typed ones are matched off a queue in log order and
    // everything unmatched is the agent's, which is certain. ONE soft edge: an
    // agent running the identical text while a typed one is in flight can swap
    // the pair. Only a new field on the event closes that.
    // …and the same is true of the FILE panes, which list folders through
    // `list_files`: the trace read `main ran list_files path=artifacts` for a
    // listing a pane had asked for. Those requests are in the log too
    // (`files::OPEN_REQUEST`, `files::SAVE_REQUEST`) and carry the path.
    //
    // BUT A PANE IS NOT A PERSON (R6-10). Those matched calls all wore `you`,
    // and most are the pane's own housekeeping: it lists the root on mount,
    // re-lists on every status change, re-reads a file after a save.
    // `you ran list_files path=. — ok` for a listing nobody asked for is the
    // same class of lie as handing it to the agent, and a worse one, because
    // the `you`/agent split is how this trace answers "who did this" at all.
    // `you` means a gesture: a command typed, a Save pressed. The rest is
    // `PANE`.
    let mut asked = Asked::default();
    // …AND WHICH CALL RECOVERED A REFUSED ONE (R15-P1-5). The malformed-argument
    // refusal works — the model reads it and writes the call again — and nothing
    // on this page said the retry had landed.
    let mut retries = crate::trace::trustworthy::Retries::default();
    let mut theirs = 0usize; // the app's own, counted whether or not shown
    let mut shell = 0usize; // …and the shell's, which lives in Commands (R15-P1-4)
    for (nth, kind) in ctx.recent.iter().enumerate() {
        asked.enqueue(nth, kind);
        // WHERE A RUN WAS STOPPED (R16-P0-2), in the log's own order, between
        // the last call it made and whatever came next. Same fact as the
        // conversation's own line; `halted` owns both wordings.
        if let EventKind::Custom { kind, payload_json } = kind {
            if kind == agent::STOPPED {
                list = list.child(crate::failure::stopped_notice::row(who, payload_json, at(ctx, nth)));
                count += 1;
            }
        }
        if let EventKind::ToolInvoked {
            tool,
            args,
            ok,
            output,
        } = kind
        {
            if is_shell(&tool.0) {
                shell += 1;
                continue;
            }
            let (by, asked_at) = asked.actor(&tool.0, args, who);
            if by == PANE {
                theirs += 1;
                if !app_activity {
                    continue;
                }
            }
            // The request's own timestamp is the call's START (R13-4); without
            // one the log holds only when it ended, and the row says so.
            let started = asked_at.map(|n| at(ctx, n));
            let retry = retries.note(&tool.0, args, *ok);
            list = list.child(row(&tool.0, args, *ok, output, by, at(ctx, nth), started, retry));
            count += 1;
        }
    }
    // …AND THE CALLS THAT HAVE NOT COME BACK (R11-4), after the finished ones,
    // where the newest row belongs. The actor comes off the SAME queue the rows
    // above used — a request is enqueued before the call it becomes, so a
    // command still running is attributed exactly as it will be when it lands.
    let mut live = 0usize;
    for call in &ctx.calling {
        if is_shell(&call.tool) {
            shell += 1;
            continue;
        }
        let (by, _) = asked.actor(&call.tool, &call.args, who);
        if by == PANE {
            theirs += 1;
            if !app_activity {
                continue;
            }
        }
        list = list.child(crate::trace::inflight::running_row(call, crate::trace::inflight::age(ctx, call), by));
        live += 1;
    }
    if count == 0 && live == 0 {
        // …AND NEVER "nothing happened" OVER A SESSION THAT RAN COMMANDS
        // (R15-P1-4): the shell is somewhere else, not nowhere.
        let said = match shell {
            0 => "No tool has been called yet.".to_string(),
            1 => "No tool other than the shell has been called yet.".to_string(),
            n => format!("No tool other than the shell has been called yet — {n} shell commands."),
        };
        list = list.child(FragmentBuilder::new("p").class("pending").text(&said).build());
    }
    let mut response = html(200, list.build().into_html());
    // HOW MANY ARE BEING LEFT OUT, as a header the pane wears on its toggle:
    // hiding rows silently is the same class of untruth as showing the wrong
    // ones. Same contract as `x-turn` — a fact the UI needs, not a fragment it
    // has to parse.
    response
        .headers
        .push(("x-app-calls".into(), theirs.to_string()));
    // …AND HOW MANY WENT TO COMMANDS INSTEAD (R15-P1-4).
    response
        .headers
        .push(("x-shell-calls".into(), shell.to_string()));
    response
}

