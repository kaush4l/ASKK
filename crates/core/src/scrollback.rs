//! The scrollback's rendering: the note that says whose workspace this is and
//! what the tools reaching it can really do, one finished command, one command
//! still running. Split from `terminal.rs` so both hold the 200-line rule
//! (I12); `terminal.rs` owns the route, this file owns the pixels.

use kernel::EventKind;
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::Ctx;

/// The command just typed, shown before it has run. Without it the pane would
/// look identical for however long the first boot takes.
///
/// The boot sentence is told ONCE, on the command that actually boots the
/// Linux (10 walk, finding 2): it used to be printed unconditionally, so the
/// eleventh command in an already-booted VM claimed to be the first, and a
/// line that is untrue ten times out of eleven stops being read on the one
/// occasion it explains a genuine 2.1-second wait.
pub(crate) fn echoed(command: &str, already_ran: usize) -> Fragment {
    let waiting = match already_ran {
        0 => "running… this first command also boots the Linux, which takes a moment.",
        _ => "running…",
    };
    FragmentBuilder::new("div")
        .class("term-run pending")
        .attr("role", "status")
        .child(prompt_line(command))
        .child(FragmentBuilder::new("pre").text(waiting).build())
        .build()
}

/// How many commands this scrollback already holds.
pub(crate) fn ran_count(ctx: &Ctx) -> usize {
    ctx.recent
        .iter()
        .filter(|k| matches!(k, EventKind::ToolInvoked { tool, .. } if tool.0 == "exec"))
        .count()
}

/// What the SELECTED agent's workspace is, and what the tools that reach it
/// can actually do. The path rule is stated honestly (10 walk, finding 4):
/// `exec` is a full shell and `cat /etc/passwd` works from it, so the path
/// check on the other three is legibility and the VM is the containment.
pub(crate) fn note(ctx: &Ctx, who: &str) -> Fragment {
    let theirs = ctx
        .agents
        .iter()
        .find(|s| s.name == who)
        .and_then(|s| agent::Space::named(&s.space));
    let text = match &theirs {
        None => format!(
            "{who}'s file names no space, so it has no workspace and cannot run commands. \
             What is below ran in {}'s.",
            ctx.me
        ),
        Some(space) => format!(
            "{who} works in the {} space, so its workspace is {} — the same folder as every \
             other agent whose file names that space. exec runs a shell command there. It is a \
             REAL shell, not a restricted one: it can read anything in this Linux, so the path \
             check on read_file, write_file and list_files is legibility rather than \
             containment — the Linux running in this tab is what the agent is confined to. \
             What is written there is kept in this browser and is still there after a reload.",
            space.name,
            space.path()
        ),
    };
    let mut lines = FragmentBuilder::new("div").child(
        FragmentBuilder::new("p")
            .class("note")
            .text(&text)
            .build(),
    );
    // The scrollback is this PAGE's log and cannot be another Worker's, so
    // when they differ the pane says so instead of implying otherwise.
    if who != ctx.me {
        lines = lines.child(
            FragmentBuilder::new("p")
                .class("note")
                .text(&format!(
                    "The commands below are {}'s — this page's own. A sub-agent's commands run \
                     in its Worker and are in its own trace.",
                    ctx.me
                ))
                .build(),
        );
    }
    lines.build()
}

/// The command out of the JSON the tool was called with; the raw arguments if
/// it was something else, because a trace that hides what was asked is not one.
pub(crate) fn command_of(args_json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| Some(v.get("command")?.as_str()?.to_string()))
        .unwrap_or_else(|| args_json.to_string())
}

fn prompt_line(command: &str) -> Fragment {
    FragmentBuilder::new("p")
        .class("term-command")
        .child(FragmentBuilder::new("span").class("term-prompt").text("$ ").build())
        .child(FragmentBuilder::new("span").text(command).build())
        .build()
}

/// One finished command. The outcome is a WORD beside the colour, the same
/// rule the tool trace follows.
pub(crate) fn ran(command: &str, ok: bool, output: &str) -> Fragment {
    let word = match ok {
        true => "ok",
        false => "failed",
    };
    FragmentBuilder::new("div")
        .class(match ok {
            true => "term-run",
            false => "term-run error",
        })
        .attr("data-outcome", word)
        .child(prompt_line(command))
        .child(
            FragmentBuilder::new("pre")
                .attr("tabindex", "0")
                .attr("role", "region")
                .attr("aria-label", &format!("output of {command}"))
                .text(output)
                .build(),
        )
        .build()
}
