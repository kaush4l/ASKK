//! WHICH PART OF THE TURN IS RUNNING (28). The board's live line said `in this
//! turn for 12s · last tool: read_file` and stopped there: "it is working" with
//! nothing about what it is working ON. An agent file declares a loop
//! (`stages: [plan, work, verify, critique]`), `agent::stages` walks it, and
//! every step of that walk has been a fact in the log since 20 — the surfaces
//! just never read it.
//!
//! Its own file, and in `board/` rather than beside the turn machinery,
//! because the split falls where the others do — this is the FOLD and `row/`
//! renders it — and the board's live line is its only reader.
//!
//! THE STAGE IS A FACT OR IT IS NOTHING. It is read from `STAGE_ENTERED`
//! records in the CURRENT turn only — never from the `stages:` list an agent
//! file declares, which says what the turn WOULD do, not what it has done. A
//! turn with no stage fact yet gets no word at all, and a stage never survives
//! the turn it belonged to: `fold::awaits` already knows where one turn ends
//! and the next begins, and this asks it rather than keeping a second opinion.
//!
//! AND WHICH LAP OF THEM (31). 28's own known limit was that a second pass said
//! nothing about which lap, so the one capability this product is built on — an
//! agent that keeps working a goal after the first answer would have ended the
//! turn — was invisible on the row a person watches. `PASS_SPENT` is the fact,
//! under every rule above, and `lap` is the clause.

use kernel::EventKind;

use crate::dispatch::Ctx;

/// WHAT YOU CAN DO WITH THIS AGENT, for its card on the board (32). Eight cards
/// differed in name and status word and in nothing else, so the four agents you
/// can hand a task to and the four you cannot were indistinguishable until you
/// selected one and read the launcher two views away. The word is
/// `agents::card_sentences::can`'s — the same predicate the agent card's doors and the Commands
/// pane ask — so the board cannot come to a fifth answer about one agent.
///
/// It is in THIS file because it is a fold of the CURRENT turn's log, which is
/// this file's one subject; `last_tool` is here with it for the same reason.
pub(crate) struct Offer {
    /// `run`, `change` or `read` — `agents::card_sentences::can`, verbatim.
    pub(crate) can: &'static str,
    /// The clause the card's status line ends with, empty for an agent this
    /// roster holds no file for: a card says nothing rather than guessing (I15).
    pub(crate) said: String,
    /// Every tool the file really RESOLVED to, by name — the list the agent
    /// card prints in words. The Dashboard's starter tasks are chosen from it,
    /// so a task offered is a task some named tool can finish (32).
    pub(crate) toolset: String,
    /// …and the pass ceiling with it, because it is the one declared fact that
    /// separates an agent that works a goal over laps from one that answers once.
    pub(crate) laps: u16,
}

/// The fold itself, off the roster this request already holds.
pub(crate) fn offer(ctx: &Ctx, who: &str) -> Offer {
    let mut offer =
        Offer { can: "read", said: String::new(), toolset: String::new(), laps: 1 };
    let Some(spec) = ctx.agents.iter().find(|spec| spec.name == who) else {
        return offer;
    };
    let names: Vec<String> =
        agent::toolbox_for(spec, &ctx.agents).tools.into_iter().map(|t| t.name).collect();
    offer.can = crate::agents::card_sentences::can(spec, &ctx.agents);
    offer.laps = spec.passes;
    // AN EMPTY TOOLBOX IS NOT A READING ONE (32). `can` answers `read` for both,
    // which is right for the door it guards — neither takes a task — and wrong
    // for a card that then says which tools it has.
    offer.said = match (offer.can, names.is_empty()) {
        (_, true) => "no task to give it — it has no tools at all".into(),
        ("read", _) => "no task to give it — every tool it has reads".into(),
        ("run", _) => "you can give it a task, and it runs commands".into(),
        _ => "you can give it a task; it runs no commands".into(),
    };
    // …AND HOW MANY LAPS ONE TASK MAY TAKE, where that is more than one: it is
    // the difference between handing over a goal and asking a question, and it
    // was legible on no card at all. `up to`, because `passes:` is a ceiling.
    if spec.passes > 1 {
        offer.said.push_str(&format!(" · it works one task over up to {} passes", spec.passes));
    }
    offer.toolset = names.join(", ");
    offer
}

/// The last tool this process's agent called, by name — ITS OWN CALLS ONLY
/// (R18-P1-3). The pill read `last tool: list_processes` under the agent's name
/// while the trace, from the same facts, showed `this page ran list_processes()`
/// — the Files pane's polling, wearing the agent's name on the one line a
/// person reads to see what the run is doing. `trace::requested_by::Asked` has attributed
/// every call to `you`, `PANE` or the agent since R6-10; that row was the last
/// reader still counting the log's `ToolInvoked` facts raw.
///
/// The agent's own calls are the UNMATCHED ones, which is why the empty string
/// is passed as the agent's name here: no pane or gesture can be attributed to
/// it, so `by.is_empty()` means "nothing asked for this but the model".
pub(crate) fn last_tool(ctx: &Ctx) -> Option<String> {
    let mut asked = crate::trace::requested_by::Asked::default();
    let mut last = None;
    for (nth, kind) in ctx.recent.iter().enumerate() {
        asked.enqueue(nth, kind);
        if let kernel::EventKind::ToolInvoked { tool, args, .. } = kind {
            if asked.actor(&tool.0, args, "").0.is_empty() {
                last = Some(tool.0.clone());
            }
        }
    }
    last
}

/// The stage this agent's turn is in right now, `None` if it is between turns,
/// has no stage machine, or has not entered a stage yet.
///
/// Only this process's own agent can answer: `STAGE_ENTERED` is emitted by the
/// engine that is running the turn, so a sub-agent's stages are in ITS Worker's
/// log and not in this one. `belongs_to` enforces that, and the row says
/// nothing rather than guessing — the same rule `last_tool` above follows.
pub(crate) fn current(ctx: &Ctx, who: &str) -> Option<String> {
    let mut stage = None;
    for kind in ctx.recent.iter().filter(|k| crate::chat::fold::belongs_to(k, &ctx.me, who)) {
        match kind {
            EventKind::Custom { kind: k, payload_json } if k == agent::STAGE_ENTERED => {
                stage = Some(agent::stage_of(payload_json)).filter(|s| !s.is_empty());
            }
            // A new turn opening over the top of the old one, and an ending:
            // either way the stage before it is history, not status.
            EventKind::UserMessage { .. } => stage = None,
            k if crate::chat::fold::awaits(k) == Some(false) => stage = None,
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
    let clause = match declared.iter().position(|s| *s == stage) {
        Some(nth) => format!("stage {} of {}: {stage}", nth + 1, declared.len()),
        None => stage,
    };
    // …AND WHICH LAP OF THEM (31). The stage says where in one walk of the list
    // the turn is; only the lap says the list is being walked again.
    Some(match lap(ctx, who) {
        Some(lap) => format!("{clause} · {lap}"),
        None => clause,
    })
}

/// WHICH LAP OF THE STAGES THIS IS, `None` when it is the first one, when the
/// agent cannot lap at all, or between turns.
///
/// Every rule `current` follows, for the same reasons: the lap is read from
/// `PASS_SPENT` facts in the CURRENT turn only and never from the `passes:`
/// budget the file declares, and `fold::awaits` says where the turn ended.
///
/// TWO SILENCES, BOTH DELIBERATE. An agent whose budget is 1 — every agent but
/// `builder` — can never lap, so a lap count for it would be noise about a loop
/// that does not exist (I15), and `of > 1` is what keeps it quiet. And the FIRST
/// lap of any turn spends no fact, so it says nothing either: a lap count is
/// what HAS happened, and one lap in, nothing has gone round yet.
fn lap(ctx: &Ctx, who: &str) -> Option<String> {
    let mut lap = None;
    for kind in ctx.recent.iter().filter(|k| crate::chat::fold::belongs_to(k, &ctx.me, who)) {
        match kind {
            EventKind::Custom { kind: k, payload_json } if k == agent::PASS_SPENT => {
                lap = Some(agent::pass_of(payload_json)).filter(|(n, of)| *n > 0 && *of > 1);
            }
            EventKind::UserMessage { .. } => lap = None,
            k if crate::chat::fold::awaits(k) == Some(false) => lap = None,
            _ => {}
        }
    }
    // "UP TO", BECAUSE `passes:` IS A CEILING AND NOT A PLAN. `agent::passes`
    // ends the turn the moment a lap changes nothing, so `pass 2 of 4` beside a
    // running turn would promise two more laps the machine may never take.
    lap.map(|(n, of)| format!("pass {n} of up to {of}"))
}
