//! What the tool trace LOOKS like. Split from `tools.rs` to hold the 200-line
//! rule (I12): that file owns running a tool, this one owns rendering what
//! running it produced — a projection of the `ToolInvoked` facts and nothing
//! else (I8).

use agent::ToolResult;
use kernel::{EventKind, Response};
use module::view::{Fragment, FragmentBuilder};

use crate::dispatch::{html, Ctx};

/// The trace: every call this session, in log order, with its arguments and
/// what came back. A projection of the log and nothing else (I8).
pub(crate) fn trace(ctx: &Ctx, who: &str) -> Response {
    let mut list = FragmentBuilder::new("div")
        .id("tool-trace")
        .attr("data-agent", who);
    // A tool call happens inside the calling agent's own loop, so the ONLY
    // calls this log holds are this process's agent's. Another agent's run in
    // its own Worker and are recorded there — saying so is the honest answer,
    // and it is the same rule the transcript folds by (`belongs_to`).
    // A sub-agent's calls happen in its own Worker's loop, so they are not
    // `ToolInvoked` facts in THIS log — they arrive as `core.agent_activity`,
    // reported by the Worker and adopted through one door (`told`). This used
    // to say "recorded there" and show nothing, which made every agent but
    // this page's a black box with an answer at the end.
    if who != ctx.me {
        let mut calls = 0usize;
        for kind in &ctx.recent {
            let EventKind::Custom { kind, payload_json } = kind else { continue };
            if kind != crate::told::AGENT_ACTIVITY {
                continue;
            }
            let Some((agent, value)) = crate::told::activity(payload_json) else { continue };
            let Some(tool) = value.get("tool").and_then(|t| t.as_str()) else { continue };
            if agent != who {
                continue;
            }
            let args = value.get("args").and_then(|a| a.as_str()).unwrap_or("{}");
            let ok = value.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false);
            let output = value.get("output").and_then(|o| o.as_str()).unwrap_or_default();
            list = list.child(row(tool, args, ok, output));
            calls += 1;
        }
        if calls == 0 {
            let said = format!(
                "{who} has not called a tool yet. When it does, its Worker reports each call \
                 and they appear here — the same trace this page keeps for {}.",
                ctx.me
            );
            list = list.child(FragmentBuilder::new("p").class("pending").text(&said).build());
        }
        return html(200, list.attr("data-calls", &calls.to_string()).build().into_html());
    }
    let mut count = 0usize;
    for kind in &ctx.recent {
        if let EventKind::ToolInvoked {
            tool,
            args,
            ok,
            output,
        } = kind
        {
            list = list.child(row(&tool.0, args, *ok, output));
            count += 1;
        }
    }
    if count == 0 {
        list = list.child(
            FragmentBuilder::new("p")
                .class("pending")
                .text("No tool has been called yet.")
                .build(),
        );
    }
    html(200, list.build().into_html())
}

/// One call. The result line is rendered by the same `ToolResult::line` the
/// model reads, so the user sees what the model saw.
///
/// The outcome is a WORD, not a colour. A refused call and a successful one
/// used to differ by hue alone: identical with the stylesheet off, identical
/// to a screen reader, and unreadable to anyone who does not see red
/// (`ux-walker`, increment 05). The output block is focusable, because a
/// scrolling region no keyboard can reach is a region with content in it that
/// some people cannot get to.
fn row(tool: &str, args: &str, ok: bool, output: &str) -> Fragment {
    let result = ToolResult {
        tool: tool.to_string(),
        ok,
        output: output.to_string(),
        error: output.to_string(),
    };
    let word = match ok {
        true => "ran",
        false => "refused",
    };
    FragmentBuilder::new("div")
        .class(match ok {
            true => "tool-call",
            false => "tool-call error",
        })
        .attr("data-tool", tool)
        .attr("data-outcome", word)
        .child(
            FragmentBuilder::new("p")
                .class("tool-args")
                .child(
                    FragmentBuilder::new("span")
                        .class("tool-outcome")
                        .text(word)
                        .build(),
                )
                .child(
                    FragmentBuilder::new("span")
                        .text(&format!(" {tool}({args})"))
                        .build(),
                )
                .build(),
        )
        .child(
            FragmentBuilder::new("pre")
                .attr("tabindex", "0")
                .attr("role", "region")
                .attr("aria-label", &format!("what {tool} returned"))
                .text(&result.line())
                .build(),
        )
        .build()
}
