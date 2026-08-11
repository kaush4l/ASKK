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
pub(crate) fn trace(ctx: &Ctx) -> Response {
    let mut list = FragmentBuilder::new("div").id("tool-trace");
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
