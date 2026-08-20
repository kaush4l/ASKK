//! One agent's conversation, folded out of the event log. Nothing outside the
//! named agent's conversation is projected (07), its log id too (§7).
//!
//! Three neighbours do the work: `spoken` renders the message-shaped facts,
//! `noted` renders what the machine wrote ABOUT the turn, and `headers` says
//! everything the pane must learn without parsing the fragment back. This file
//! owns the accumulator those three fill and the order they run in.

mod headers;
mod noted;
mod spoken;

use std::collections::HashSet;

use kernel::{EventKind, Response};
use module::view::FragmentBuilder;

use crate::chat::call_announcement::Calls;
use crate::dispatch::Ctx;
use crate::chat::fold::{belongs_to, driven, tail};
use crate::failure::dedupe::Seen;

/// One agent's conversation, mid-fold: the rows so far, and the four things
/// the tail and the headers ask about them once the walk is over.
pub(crate) struct Woven {
    pub(crate) list: FragmentBuilder,
    /// Whether the last message-shaped fact left a turn OPEN.
    pub(crate) awaiting: bool,
    /// Rows a reader would call part of the conversation, which is how `tail`
    /// tells a conversation that has said nothing from one that is silent.
    pub(crate) count: usize,
    /// How many tool calls this conversation has behind it: not rendered, but
    /// it CHANGES when one lands, which is what tells the pane it is working.
    pub(crate) tools: usize,
    /// The last thing the PERSON said here. The pane could only remember what
    /// it had sent itself, so a reload left a recovery with nothing to press
    /// (R3-5).
    pub(crate) last_said: String,
}

/// What the walk carries and the finished conversation does not: the run of
/// tool calls still gathering its one announcement (R7-15), the failures
/// already written out in full (`failure::dedupe::Seen`), and the two lookups the arms
/// need on every fact.
pub(crate) struct Walk {
    pub(crate) calls: Calls,
    pub(crate) said: Seen,
    /// What the workspace holds, so a file the agent NAMES can be opened from
    /// the sentence that names it (R9-4).
    pub(crate) files: Vec<String>,
    /// WHICH of these messages were STEERS and not new turns (R18-P0-1), by
    /// log position, off the `core.steered` fact `step` writes when it takes
    /// one.
    pub(crate) steers: HashSet<usize>,
}

/// The whole conversation with ONE agent, in log order. A turn is in flight
/// when the last message-shaped fact is a `UserMessage` — also the `x-turn:
/// pending` header, so the UI watches without parsing HTML.
///
/// `appended` is a sentence that arrived WITH this request and has not been
/// pumped yet, so no fact for it exists to fold: it is drawn onto the end.
pub(crate) fn transcript(ctx: &Ctx, who: &str, appended: Option<&str>) -> Response {
    let (mut woven, walk) = fold(ctx, who);
    if let Some(text) = appended {
        woven = woven.appended(ctx, who, text, &walk.files);
    }
    let pending = woven.awaiting && driven(ctx, who, appended.is_some());
    let mut woven = woven.tailed(pending, who);
    // …AND WHY THIS TAB WILL NOT ADD TO IT (T29). Below the tail, so it is the
    // last thing in a log that scrolls to its end — a second tab's whole
    // explanation of itself lives in the conversation it is refusing to join.
    woven.list = crate::failure::second_tab::noticed(woven.list, ctx.writership);
    headers::response(ctx, who, woven, pending)
}

/// Every fact in this agent's slice of the log, in order, turned into rows.
fn fold(ctx: &Ctx, who: &str) -> (Woven, Walk) {
    let mut woven = Woven {
        list: opened(who),
        awaiting: false,
        count: 0,
        tools: 0,
        last_said: String::new(),
    };
    let mut walk = Walk {
        calls: Calls::default(),
        said: Seen::default(),
        files: crate::files::rows::names(ctx),
        steers: crate::chat::steer_notice::steers(ctx, who),
    };
    // A CLEARED CONVERSATION STARTS LATER, not shorter (`clear::from`).
    for (nth, kind) in ctx.recent.iter().enumerate().skip(crate::chat::clear::from(ctx, who)) {
        if !belongs_to(kind, &ctx.me, who) {
            continue;
        }
        if !spoken::renders_nothing(kind) {
            woven = spoken::announced(woven, &mut walk.calls, who);
        }
        woven = match kind {
            EventKind::Custom { .. } => noted::noted(woven, &mut walk, kind, who),
            _ => spoken::spoken(woven, &mut walk, who, nth, kind),
        };
        // WHETHER THE TURN IS STILL OPEN is `fold::awaits` and nothing else:
        // the board asks it of the same facts, and two copies of this rule is
        // how the two surfaces started disagreeing (R7-3).
        if let Some(open) = crate::chat::fold::awaits(kind) {
            woven.awaiting = open;
        }
    }
    woven = spoken::announced(woven, &mut walk.calls, who);
    (woven, walk)
}

/// The empty element the rows hang off: a live region named for its agent, so
/// two conversations on one screen can never be swapped for one another.
fn opened(who: &str) -> FragmentBuilder {
    FragmentBuilder::new("div")
        .id(&format!("chat-log-{who}"))
        .attr("role", "log")
        .attr("aria-live", "polite")
}

impl Woven {
    /// THE FIRST FRAME OF A STEER. This message has not been pumped yet, so no
    /// `core.steered` fact exists to read: what decides it here is whether the
    /// turn it landed in is really being DRIVEN — the same predicate
    /// `abandoned_run` uses, asked of the moment the sentence arrived.
    fn appended(mut self, ctx: &Ctx, who: &str, text: &str, files: &[String]) -> Self {
        let open = self.awaiting.then(|| driven(ctx, who, false));
        self.list = crate::chat::steer_notice::said(self.list, who, "", text, files, open);
        self.last_said = text.to_string();
        self.awaiting = true;
        self.count += 1;
        self
    }

    /// What the conversation ends with — a wait, a nothing-here, or silence.
    /// The wording is `fold::tail`'s, which the board reads too.
    fn tailed(mut self, pending: bool, who: &str) -> Self {
        if let Some(tail) = tail(pending, self.awaiting, self.count, who) {
            self.list = self.list.child(tail);
        }
        self
    }
}
