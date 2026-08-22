//! THE WRITES THAT FAILED — `StoreFailed`, which has been in the kernel's
//! closed vocabulary since G2 and has had ZERO readers in the whole tree.
//!
//! ADR-005 promised a quota error would surface and never be silent. It was
//! recorded faithfully by `log::store` and shown to nobody, which is the
//! promise kept in the log and broken on the screen — and this is the most
//! user-visible of the unread facts, because what it means is that the
//! person's conversation stopped persisting while the page carried on as if
//! nothing had happened.
//!
//! IT IS NOT A ROW AMONG ROWS. It is the first block on the pane, above every
//! turn, and it is the only thing on it written in the error voice.

use module::view::{Fragment, FragmentBuilder};

/// The block, or nothing at all when every write has landed.
///
/// The FIRST failure leads, not the newest: a quota does not clear itself, so
/// the write that first hit the wall is where the conversation stopped being
/// saved, and every one after it is the same wall being hit again.
pub(crate) fn failed_writes(rows: &[(String, String)]) -> Option<Fragment> {
    let first = rows.first()?;
    let block = FragmentBuilder::new("div")
        .class("debug-store-failed")
        .attr("data-failed", &rows.len().to_string())
        .child(
            FragmentBuilder::new("p")
                .class("error")
                .text(&format!(
                    "This conversation has stopped being saved. {} storage {} failed, the \
                     first at {}: {}. Whatever has happened since may not survive a reload.",
                    rows.len(),
                    match rows.len() {
                        1 => "write",
                        _ => "writes",
                    },
                    first.0,
                    first.1
                ))
                .build(),
        );
    let rest = rows.iter().skip(1).fold(block, |block, (key, message)| {
        block.child(
            FragmentBuilder::new("p")
                .class("error debug-fail")
                .text(&format!("{key}: {message}"))
                .build(),
        )
    });
    Some(rest.build())
}

