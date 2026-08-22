//! WHICH commands the workspace scrollback shows, and WHOSE they are. Separate
//! from `row.rs` (which owns how one row looks) for the same reason
//! `trace/pane.rs` and `trace/row.rs` are two files: selecting the facts and
//! rendering them are two jobs.
//!
//! R4-1. This pane used to render THIS page's `ToolInvoked` facts under
//! whichever agent the page had selected: the same row read `main ran $ sleep
//! 20` or `researcher ran $ sleep 20` depending on a dropdown, and with
//! `researcher` selected the Tool trace said researcher had run nothing at all
//! while this pane showed it running five commands. Two agent-scoped views over
//! one agent, flatly contradicting each other.
//!
//! The log holds two DIFFERENT records and they are never mixed here:
//!
//! * `EventKind::ToolInvoked` — a call made by THIS page's own agent loop. It
//!   names the tool, the arguments, and how it ended. It does NOT name an
//!   actor, and nothing here invents one: the actor is this page's agent
//!   (`ctx.me`), except where the person's own `core.exec_request` accounts for
//!   it, which makes it `you`.
//! * `core.agent_activity` — a call a sub-agent's Worker REPORTED. It names the
//!   agent, so that one is known outright.
//!
//! So the pane shows the selected agent's own record and no one else's, which
//! is exactly the rule `trace/pane.rs` follows over the same two records.
//!
//! AND A ROW SAYS WHETHER ITS ANSWER IS STILL TRUE (R10-5). The log outlives the
//! Linux: a `uname -a` from a previous page load sat twelve lines above the
//! paragraph naming the engine this page runs, describing a different machine —
//! reproduced in both directions across an engine switch. `ctx.booted` is how
//! much of the log was replayed, so every row below it ran somewhere that no
//! longer exists and is marked rather than shown as current.

use kernel::EventKind;
use module::view::Fragment;

use crate::dispatch::Ctx;
use crate::terminal::row::{command_of, ran};

/// THE ORDER, SAID ONCE (R14-P1-5). Every row in this pane and every row in
/// the Tool trace is in LOG ORDER, oldest first: the log is append-only (I8),
/// so its own order is the only one neither projection has to invent, and a
/// list read top to bottom is then the story in the order it happened. The
/// panes never disagreed about it — both have always rendered it this way —
/// they disagreed about which END of it was on screen, which `ui::terminal`
/// now settles the way the trace already had.
///
/// AND EVERY ROW SORTS BY THE FACT IT RENDERS. A finished command sorts at its
/// `ToolInvoked`; a command the reload abandoned has no call to sort by and
/// sorts at the REQUEST it renders instead, which is the only position in the
/// log that row is about. That is the whole of the rule, and it is why the
/// user's own rows are not an exception to it.
///
/// Every command this pane can honestly attribute to `who`, in log order.
pub(crate) fn commands(ctx: &Ctx, who: &str) -> Vec<Fragment> {
    match who == ctx.me {
        true => ours(ctx),
        false => reported(ctx, who),
    }
}

/// This page's own `exec` calls. `you` when the person's typed request accounts
/// for it — the trace's own rule, shared rather than re-derived, so the two
/// panes cannot disagree about a row they both show.
fn ours(ctx: &Ctx) -> Vec<Fragment> {
    let mut typed: Vec<(&str, usize)> = Vec::new();
    // Every request REPLAYED from an earlier page load, with where it sat in
    // the log — the rows below are put back in that order (R12-5).
    let mut replayed: Vec<(usize, &str)> = Vec::new();
    let mut out: Vec<(usize, Fragment)> = Vec::new();
    for (i, kind) in ctx.recent.iter().enumerate() {
        if let EventKind::Custom { kind, payload_json } = kind {
            if kind == crate::terminal::pane::EXEC_REQUEST {
                typed.push((payload_json, i));
                if i < ctx.booted {
                    replayed.push((i, payload_json));
                }
            }
        }
        if let EventKind::ToolInvoked { tool, args, ok, output } = kind {
            if tool.0 != "exec" {
                continue;
            }
            let by = match crate::trace::requested_by::pop_typed(&mut typed, args) {
                Some(_) => "you",
                None => ctx.me.as_str(),
            };
            out.push((i, ran(&command_of(args), *ok, output, by, i < ctx.booted)));
        }
    }
    // What is left unaccounted from an earlier page never came back: the reload
    // took it. A leftover from THIS page is still outstanding and `in_flight`
    // is already showing it, live, with a clock.
    for (i, payload) in replayed {
        let Some(at) = typed.iter().position(|(held, _)| *held == payload) else { continue };
        typed.remove(at);
        out.push((i, crate::terminal::row::abandoned(&crate::trace::requested_by::typed_command(payload), "you")));
    }
    out.sort_by_key(|(i, _)| *i);
    out.into_iter().map(|(_, row)| row).collect()
}

/// THE COMMANDS THAT HAVE NOT FINISHED, newest last (R11-1a). Two sources, each
/// knowing something the other does not: `running` holds what a person typed
/// from the moment the request is made, before the workspace has taken it, and
/// `calling` holds what the workspace is actually inside — the only place an
/// AGENT's command appears at all. Neither had a clock, so `Running…` meant
/// four seconds and seven minutes alike.
pub(crate) fn in_flight(ctx: &Ctx, typed: Option<&str>) -> Vec<Fragment> {
    let mut out = Vec::new();
    let mut said: Vec<String> = Vec::new();
    // TRIMMED, because the gate is: `App::running` holds the raw bytes a person
    // typed and `command_of` reads the argument the way `exec` will run it, so
    // `  ls -l  ` in the box and `ls -l` in the call are one command here. Left
    // raw, the person's own in-flight command failed to match its own call and
    // came back a second time, in the loop below, billed to the agent.
    for command in ctx.running.iter().map(String::as_str).chain(typed) {
        let command = command.trim();
        let age = ctx
            .calling
            .iter()
            .find(|c| c.tool == "exec" && command_of(&c.args) == command)
            .and_then(|c| crate::trace::inflight::age(ctx, c));
        out.push(crate::terminal::row::echoed(command, "you", age));
        said.push(command.to_string());
    }
    for call in ctx.calling.iter().filter(|c| c.tool == "exec") {
        let command = command_of(&call.args);
        if said.contains(&command) {
            continue; // already shown above as the typed command it is
        }
        let age = crate::trace::inflight::age(ctx, call);
        out.push(crate::terminal::row::echoed(&command, &ctx.me, age));
    }
    out
}

/// A sub-agent's `exec` calls as its own Worker reported them. A person cannot
/// type into another agent's workspace, so these are the agent's, always.
fn reported(ctx: &Ctx, who: &str) -> Vec<Fragment> {
    let mut out = Vec::new();
    for (i, kind) in ctx.recent.iter().enumerate() {
        let EventKind::Custom { kind, payload_json } = kind else { continue };
        if kind != crate::failure::from_worker::AGENT_ACTIVITY {
            continue;
        }
        let Some((agent, value)) = crate::failure::from_worker::activity(payload_json) else { continue };
        if agent != who || value.get("tool").and_then(|t| t.as_str()) != Some("exec") {
            continue;
        }
        let args = value.get("args").and_then(|a| a.as_str()).unwrap_or("{}");
        let ok = value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false);
        let output = value.get("output").and_then(|o| o.as_str()).unwrap_or_default();
        out.push(ran(&command_of(args), ok, output, who, i < ctx.booted));
    }
    out
}
