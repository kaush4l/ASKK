//! WHAT A SECOND TAB IS TOLD, and why it is told anything at all.
//!
//! `log::writership` decides that this tab does not own the log. That decision
//! is invisible by construction — a tab that quietly stops persisting looks
//! exactly like a tab that is working, right up until the reload that shows the
//! conversation missing. This codebase's standing rule is that a capability
//! withheld is announced where it is withheld, so the decision gets a sentence,
//! and the sentence names the one thing to do about it.
//!
//! It is here rather than in `log/` for the same reason `what_to_do` is here:
//! the wordings a person reads about something not working live together, in
//! one register, where they can be read against each other.

use module::view::FragmentBuilder;

use crate::chat::fold::{msg, NOTICE};
use crate::log::writership::{writes, Writership};

/// WHY THIS TAB WILL NOT TAKE A TURN.
///
/// Three claims and no more, because three are all that can be defended.
/// *Another tab is writing* — the lock said so. *Nothing you type here will be
/// kept* — `store::drain` and `store::persist` return without writing.
/// *Reloading after you close the other tab makes this one the writer* — the
/// lock is released when its context dies and taken again at boot.
///
/// It does NOT promise a live handover. A follower asks once, with
/// `ifAvailable`, and never queues: promoting it later would hand the log to a
/// context whose window stopped at boot, which is the corruption this whole
/// mechanism exists to prevent, wearing a different hat.
pub(crate) const SECOND_TAB: &str = "This conversation is already open in another tab of this \
     browser, and that tab is the one writing it down. Two tabs writing one log overwrite each \
     other's turns, and a compaction in either one deletes what the other appended — so this tab \
     will not take a turn. What you see here is the conversation as it stood when this tab \
     opened, and it is safe to read. To work here instead: close the other tab, then reload this \
     one. Nothing is copied between them, so whichever tab you keep already has the whole \
     conversation.";

/// The notice, at the bottom of the conversation where the tail is — visible
/// before a person types and still there after they press Send, because the
/// refusal re-renders the same fold. Nothing is added for a leader, and nothing
/// for a browser with no lock manager: it has claimed nothing and has nothing
/// to admit (I15).
pub(crate) fn noticed(list: FragmentBuilder, w: Writership) -> FragmentBuilder {
    match writes(w) {
        true => list,
        false => list.child(msg("msg pending", NOTICE, SECOND_TAB, &[])),
    }
}
