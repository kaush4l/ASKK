//! WHICH PART OF THE TURN IS RUNNING (28). The board's live line said `in this
//! turn for 12s · last tool: read_file` and stopped there: "it is working" with
//! nothing about what it is working ON. An agent file declares a loop
//! (`stages: [plan, work, verify, critique]`), `agent::stages` walks it, and
//! every step of that walk has been a fact in the log since 20 — the surfaces
//! just never read it.
//!
//! Its own file because `fold.rs` and `boardrow.rs` were both at exactly 200
//! lines (I12), and the split falls where the others do: this is the FOLD,
//! `boardrow` renders it.
//!
//! THE STAGE IS A FACT OR IT IS NOTHING. It is read from `STAGE_ENTERED`
//! records in the CURRENT turn only — never from the `stages:` list an agent
//! file declares, which says what the turn WOULD do, not what it has done. A
//! turn with no stage fact yet gets no word at all, and a stage never survives
//! the turn it belonged to: `fold::awaits` already knows where one turn ends
//! and the next begins, and this asks it rather than keeping a second opinion.

use kernel::EventKind;

use crate::dispatch::Ctx;

/// The stage this agent's turn is in right now, `None` if it is between turns,
/// has no stage machine, or has not entered a stage yet.
///
/// Only this process's own agent can answer: `STAGE_ENTERED` is emitted by the
/// engine that is running the turn, so a sub-agent's stages are in ITS Worker's
/// log and not in this one. `belongs_to` enforces that, and the row says
/// nothing rather than guessing — the same rule `boardrow::last_tool` follows.
pub(crate) fn current(ctx: &Ctx, who: &str) -> Option<String> {
    let mut stage = None;
    for kind in ctx.recent.iter().filter(|k| crate::fold::belongs_to(k, &ctx.me, who)) {
        match kind {
            EventKind::Custom { kind: k, payload_json } if k == agent::STAGE_ENTERED => {
                stage = Some(agent::stage_of(payload_json)).filter(|s| !s.is_empty());
            }
            // A new turn opening over the top of the old one, and an ending:
            // either way the stage before it is history, not status.
            EventKind::UserMessage { .. } => stage = None,
            k if crate::fold::awaits(k) == Some(false) => stage = None,
            _ => {}
        }
    }
    stage
}

/// WHICH STAGE, AND HOW FAR THROUGH — the clause the live row opens with. A
/// name on its own does not say whether the turn is nearly done, so the file's
/// declared list supplies the position: `stage 3 of 4: verify`.
///
/// THE COUNT LEADS AND THE NAME FOLLOWS, because the row already opens with a
/// status word: name-first read `working · 1 turn in all · work · stage 2 of 4`
/// and the two `work`s a comma apart looked like one word stuttering rather
/// than two different facts. The stage name is still the roster's word — the
/// fix for a collision is not to rename either side.
///
/// The list is the only thing taken from the spec, and only to COUNT a stage
/// the log already named. An agent whose file declares no stages reaches this
/// with `None` above and says nothing — there is no `stage 1 of 1` for an agent
/// with no stage machine (I15). A fact naming a stage the current file no
/// longer lists is printed bare: the log is what happened, the file is only
/// what it says today.
pub(crate) fn said(ctx: &Ctx, who: &str) -> Option<String> {
    let stage = current(ctx, who)?;
    let declared = ctx
        .agents
        .iter()
        .find(|spec| spec.name == who)
        .map_or(&[][..], |spec| spec.stages.as_slice());
    match declared.iter().position(|s| *s == stage) {
        Some(nth) => Some(format!("stage {} of {}: {stage}", nth + 1, declared.len())),
        None => Some(stage),
    }
}
