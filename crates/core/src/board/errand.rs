//! THE GOAL IT WAS GIVEN AND WHAT IT ANSWERED (T4). A delegated run was
//! legible on the board as a status word and a clock: `researcher working · 2
//! turns in all · in this turn for 12s`. Which goal it is working, and what it
//! came back with, were on no surface at all — and both had been facts in THIS
//! log the whole time, because whoever launched the run wrote them: a model
//! delegating writes the goal in `batch.rs::delegate` as a `UserMessage`
//! carrying `from: <the caller>`, a person launching writes it through the
//! seam in `chat/pane.rs::submit` with `from` empty, and either way
//! `batch.rs::run_on` writes the answer as a `ModelReplied` carrying the
//! callee's name.
//!
//! So this is a FOLD and not a field. Nothing new is recorded, `AgentRow` grows
//! nothing, and `crates/agent` — which knows nothing about the core's log —
//! stays as it is. A projection of the log belongs where the other projections
//! of it are (I8).
//!
//! WHAT MAKES A GOAL A GOAL: THE MESSAGE WAS ADDRESSED TO SOMEBODY ELSE. Not
//! `from` being non-empty, which is what this fold first asked and which made
//! it read exactly one of the two ways a run is launched. `from` names the
//! AGENT that delegated and is empty when a PERSON typed — and a person
//! launching `critic` from the Dashboard types, so their goal is a
//! `UserMessage { agent: "critic", from: "" }` (`chat/pane.rs::submit`) and
//! the `from` test threw it away. The board then showed a person-launched run
//! as a status word and a clock, which is the whole defect T4 was written to
//! close, still reproducible from the surface it was reported on.
//!
//! `from` cannot be the test and must not be made one: it is what the
//! transcript labels the message by (`chat/transcript/spoken.rs`), so putting
//! a name in it for a person's launch would make the callee's own pane say
//! `main: <goal>` about a question no agent asked. Empty is the truth there.
//!
//! What actually separates an errand from a conversation is WHO IT WAS SENT
//! TO. A message addressed to another agent handed that agent a goal, however
//! it was sent; a message to this process's own agent is the conversation the
//! page is having, and quoting it back on `main`'s row would read as an
//! instruction somebody gave it. So the two clauses below: any message in a
//! sub-agent's fold, and a delegation (`from` non-empty) in anyone's — an
//! agent can be handed a goal by another agent even when it is this page's.
//! A person typing to their OWN agent still ENDS the errand the row is
//! reporting, because an answer to the new question is not an answer to the
//! old goal.
//!
//! And no goal fact means no clause, not a guess (I15).

use kernel::EventKind;

use crate::dispatch::Ctx;

/// How much of a goal or an answer a row shows. A board row is read at a
/// glance beside seven others; the whole text is in Chat and in the trace.
const GLANCE: usize = 64;

/// One errand, as this log has it: the goal some agent handed this one, and
/// the answer it produced for that goal. Either may be missing and each
/// missing one is silence, never a placeholder.
#[derive(Default)]
pub(crate) struct Errand {
    pub(crate) goal: Option<String>,
    pub(crate) answer: Option<String>,
}

/// The fold. Scoped by `chat::fold::belongs_to`, the predicate every
/// neighbouring fold in `board/` uses, so a goal handed to `researcher` cannot
/// surface on `main`'s row — the defect class `last_tool` was written to close.
pub(crate) fn of(ctx: &Ctx, who: &str) -> Errand {
    // Constant for the whole walk, and the half of the rule that does not
    // depend on the fact: every message reaching a sub-agent's fold was sent
    // to it by somebody, so every one of them is a goal.
    let sent_away = who != ctx.me;
    let mut errand = Errand::default();
    for kind in ctx.recent.iter().filter(|k| crate::chat::fold::belongs_to(k, &ctx.me, who)) {
        match kind {
            // A NEW GOAL IS A NEW ERRAND, so the answer to the last one goes
            // with it: `asked to: X · answered: <the answer to W>` is a lie a
            // row assembled out of two true facts.
            EventKind::UserMessage { text, from, .. } if sent_away || !from.is_empty() => {
                errand = Errand { goal: Some(text.clone()), answer: None };
            }
            EventKind::UserMessage { .. } => errand = Errand::default(),
            EventKind::ModelReplied { text, .. } if errand.goal.is_some() => {
                errand.answer = Some(text.clone());
            }
            _ => {}
        }
    }
    errand
}

/// The clause the row carries, `None` for an agent no delegation has reached.
///
/// THE ANSWER WAITS FOR THE TURN TO END. While the agent is busy the row says
/// only what it was asked, because the last answer in the log belongs to the
/// errand before this one — showing it beside a running turn would read as a
/// result that has already arrived. `is_busy` is the row's own shown status,
/// not the raw status fact, so this and the clock cannot disagree.
pub(crate) fn clause(ctx: &Ctx, who: &str, busy: bool) -> Option<String> {
    let errand = of(ctx, who);
    let goal = errand.goal?;
    let mut said = format!("asked to: {}", crate::words::clipped(&goal, GLANCE));
    if let (false, Some(answer)) = (busy, errand.answer) {
        said.push_str(&format!(" · answered: {}", crate::words::clipped(&answer, GLANCE)));
    }
    Some(said)
}
