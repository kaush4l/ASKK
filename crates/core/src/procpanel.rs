//! THE PROCESSES PANE'S PROJECTION: the newest listing, folded out of the
//! `ToolInvoked` facts (I8), as rows for the pane and a fragment for whatever
//! has no row. Split from `processes.rs`, which owns the module and its two
//! routes, so both hold the 200-line rule (I12) — the same split `files.rs` and
//! `filelist.rs` have.

use kernel::{EventKind, ToolId};
use module::view::FragmentBuilder;

use crate::dispatch::Ctx;

/// The newest `list_processes` this log holds, whoever caused it — the agent's
/// own calls count, which is the point — and WHEN it happened, because a
/// duration measured at that moment is not a duration now.
fn newest(ctx: &Ctx) -> Option<(bool, String, i64)> {
    ctx.recent
        .iter()
        .zip(ctx.at.iter())
        .filter_map(|(kind, at)| match kind {
            EventKind::ToolInvoked { tool, ok, output, .. }
                if *tool == ToolId("list_processes".into()) =>
            {
                Some((*ok, output.clone(), *at))
            }
            _ => None,
        })
        .next_back()
}

/// Every process this agent has STARTED in this conversation, in order and
/// without repeats. The log outlives the workspace, which is the whole of R10-2:
/// on an engine whose filesystem is memory, a reload destroys `.harness/proc`
/// and the pane is left holding a listing of nothing while the chat one click
/// away still says `ticker is running (pid 24)`.
fn started(ctx: &Ctx) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for kind in &ctx.recent {
        let EventKind::ToolInvoked { tool, args, .. } = kind else { continue };
        if *tool != ToolId("start_process".into()) {
            continue;
        }
        let name = serde_json::from_str::<serde_json::Value>(args)
            .ok()
            .and_then(|v| Some(v.get("name")?.as_str()?.to_string()))
            .unwrap_or_default();
        if !name.is_empty() && !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

/// A list a person reads: `a`, `a and b`, `a, b and c`.
fn listed(names: &[String]) -> String {
    match names.split_last() {
        None => String::new(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

/// WHAT WENT, rather than "nothing happened" (R10-2). The workspace holds no
/// record and the log holds every start: the panel says which processes were
/// started and why nothing is left of them, in words that follow the engine —
/// this pane's own caption used to document a `gone` state that cannot occur on
/// the engine that discards files, because there the RECORD does not survive
/// either.
fn lost(ctx: &Ctx, names: &[String]) -> FragmentBuilder {
    let was = match names.len() {
        1 => "was",
        _ => "were",
    };
    let why = match ctx.durable {
        true => "and the Linux has no record of them left — the folder they were kept in \
                 is gone."
            .to_string(),
        false => format!(
            "and nothing is left of them. This page's Linux keeps its filesystem in memory, so \
             the reload that rebuilt it took {} with it, and stopped whatever was still running.",
            crate::process::DIR
        ),
    };
    FragmentBuilder::new("div")
        .id("processes")
        .attr("data-rows", "0")
        .attr("data-lost", &names.len().to_string())
        .child(
            FragmentBuilder::new("p")
                .class("pending")
                .text(&format!("{} {was} started here, {why}", listed(names)))
                .build(),
        )
}

/// The panel and its rows: what has no row goes in the fragment, and the rows
/// go on the header. A FAILED listing is kept and shown — a pane that silently
/// drops the call it could not make is the exact bug `filelist` fixed for the
/// folder.
pub(crate) fn panel(ctx: &Ctx) -> (String, String) {
    let list = FragmentBuilder::new("div").id("processes");
    let (list, rows) = match newest(ctx) {
        // …OR WHAT IT IS QUEUED BEHIND (R11-1a), the same correction the Files
        // pane needed: "the workspace is being asked" describes a request that
        // a wedged command means nobody has been able to send.
        None => (
            list.attr("data-rows", "0").child(
                FragmentBuilder::new("p")
                    .class("pending")
                    .text(&crate::inflight::waiting_on(ctx).unwrap_or_else(|| {
                        "Nothing has been asked yet — the Linux is being asked what it is \
                         running. The agent's own start_process calls appear here too."
                            .to_string()
                    }))
                    .build(),
            ),
            String::new(),
        ),
        Some((false, output, _)) => (
            list.attr("data-failed", "1").child(
                FragmentBuilder::new("p")
                    .class("error")
                    .text(&format!("Could not list the processes: {output}"))
                    .build(),
            ),
            String::new(),
        ),
        Some((true, table, at)) => rows_of(ctx, &table, at),
    };
    (list.build().into_html(), rows)
}

/// The listing, as rows — or the reason there are none.
fn rows_of(ctx: &Ctx, table: &str, at: i64) -> (FragmentBuilder, String) {
    // How long ago the listing ran, so a running process's `for` is measured
    // from now rather than from then (R10-3). No clock, no adjustment.
    let since = ctx.clock.map_or(0, |now| (now.0.saturating_sub(at)) / 1000);
    let rows = crate::proctable::rows(table);
    if rows.is_empty() {
        let names = started(ctx);
        return match names.is_empty() {
            // NOTHING WAS EVER STARTED. The one state that really is empty.
            true => (
                FragmentBuilder::new("div")
                    .id("processes")
                    .attr("data-rows", "0")
                    .attr("data-none", "1"),
                String::new(),
            ),
            false => (lost(ctx, &names), String::new()),
        };
    }
    let running = rows.iter().filter(|f| f[1] == "running").count();
    let lines: Vec<String> = rows
        .iter()
        .map(|f| {
            let age = match f[1] == "running" {
                true => crate::proctable::moved_on(f[3], since),
                false => f[3].to_string(),
            };
            format!("{}\t{}\t{}\t{age}\t{}", f[0], f[1], f[2], f[4])
        })
        .collect();
    let list = FragmentBuilder::new("div")
        .id("processes")
        .attr("data-rows", &running.to_string())
        .attr("data-listed", &rows.len().to_string());
    (list, lines.join("\n"))
}
