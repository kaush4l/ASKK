//! THE PROCESSES PANE'S PROJECTION: the newest listing, folded out of the
//! `ToolInvoked` facts (I8), as rows for the pane and a fragment for whatever
//! has no row. `proc/pane.rs` owns the module and its two routes; this owns
//! what those routes project — the same split `files/pane.rs` and `files/listing.rs`
//! have.

use context::Args;
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
        // `name` is a NAME — an identifier, and literally a directory under
        // `.harness/proc/`. The reading is not this pane's to decide: it is the
        // EXECUTOR's own, `agent::process_name` through
        // `proc::convention::run` (`crates/core/src/proc/convention.rs:72`), so
        // the row can only name a directory that was actually made. It used to
        // read `v.get("name")` raw, and `start_process({"name": " web "})` made
        // `.harness/proc/web` while this pane listed `" web "` — a row whose
        // Stop button pointed at nothing. A name the executor would have
        // REFUSED started no process, so it belongs in no row either.
        let said = Args::parse(args);
        let Ok(name) = agent::process_name(said.name("name").unwrap_or_default()) else {
            continue;
        };
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names
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
        // The mechanism is `files::permitted::IN_MEMORY`, written once (R5-14); what
        // is particular to this pane — that the reload also STOPPED them — is
        // said here, because no other pane can say it.
        false => format!(
            "and nothing is left of them. {}, so the reload that rebuilt it took {} with it, \
             and stopped whatever was still running.",
            crate::files::permitted::IN_MEMORY,
            crate::proc::convention::DIR
        ),
    };
    FragmentBuilder::new("div")
        .id("processes")
        .attr("data-rows", "0")
        .attr("data-lost", &names.len().to_string())
        .child(
            FragmentBuilder::new("p")
                .class("pending")
                .text(&format!("{} {was} started here, {why}", crate::words::listed(names)))
                .build(),
        )
}

/// The panel and its rows: what has no row goes in the fragment, and the rows
/// go on the header. A FAILED listing is kept and shown — a pane that silently
/// drops the call it could not make is the exact bug `files/listing` fixed for the
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
                    .text(&crate::trace::inflight::waiting_on(ctx).unwrap_or_else(|| {
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
    let rows = crate::proc::table::rows(table);
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
                true => crate::proc::table::moved_on(f[3], since),
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
