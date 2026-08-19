//! THE ENDINGS, AND WHAT EACH ONE IS CALLED — and, at the bottom, the two
//! notices the LOOP itself puts on screen. `failure/ending.rs` owns the FOLD that
//! decides which one a log is showing; this file is the vocabulary that fold
//! reaches for, so a wording changes in one place for every surface.
//!
//! The rule for the list is the good part, and it is R17's: *an ending only
//! earns a name if a surface can offer a different act for it.* Not the field
//! leader's fourteen.

/// THE ENDINGS, ENUMERATED. Not every ending a turn could be given a name, but
/// every one a person can tell apart on this page and do something different
/// about:
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Ending {
    /// The model replied with prose. One of the two endings with a reply to
    /// read.
    Answered,
    /// It replied with prose AFTER changing a file, and no command has run
    /// since (`agent::verify`). The answer is real and is shown; what is not
    /// known is whether it worked. The act is to look at what it did.
    Unchecked,
    /// The model replied with machine output — a tool call this page could not
    /// read. Nothing ran, and nothing was answered.
    NoAnswer,
    /// It used every round of tool calls its agent file allows. The act is to
    /// raise `max_rounds:`, which is a different act from every other ending.
    RoundCeiling,
    /// You pressed Stop. `failure/stopped_notice.rs` owns what that leaves behind; this only
    /// has to keep the row and the card from calling it finished.
    StoppedByYou,
    /// It ran out of PASSES (`agent::passes`) with the work still going: the
    /// stage list was walked `passes:` times and the last lap still changed
    /// something. The act is to raise `passes:`, which is a different act from
    /// raising `max_rounds:` — one buys more laps of plan-work-verify, the
    /// other buys more tool calls inside them.
    PassCeiling,
    /// A SEPARATE AGENT REVIEWED THE WORK AND DID NOT CLEAR IT (25). Not the
    /// `critique` stage, which is the same model reading its own turn back in
    /// its own window; the agent holding `role: critic`, in its own Worker,
    /// which did not do the work and cannot see the conversation. The answer is
    /// real and is shown; the act is to read what the critic said.
    CriticFaulted,
    /// The turn raised. The status fact already says `failed` and the card
    /// already has a branch for it, so this ending adds no word of its own — it
    /// is here so that a failure cannot be mistaken for the ending before it.
    Failed,
}

impl Ending {
    /// The fact's own word, typed. A reason this build does not know reads as
    /// `Answered`, which is what every surface did before any ending was named
    /// — so an unknown one is no worse than the day before it existed.
    pub(crate) fn named(why: &str) -> Ending {
        match why {
            w if w == agent::NO_ANSWER => Ending::NoAnswer,
            w if w == agent::ROUND_CEILING => Ending::RoundCeiling,
            w if w == agent::PASS_CEILING => Ending::PassCeiling,
            w if w == agent::CRITIC_FAULTED => Ending::CriticFaulted,
            w if w == agent::UNCHECKED => Ending::Unchecked,
            _ => Ending::Answered,
        }
    }

    /// Whether there is an answer to read. The `Read the reply` button is
    /// offered on this and nothing else: a button that lands on a raw tool call
    /// is worse than no button. `Unchecked` counts — the reply exists and is
    /// the model's own prose; the row beside the button is what says what is
    /// not known about it.
    pub(crate) fn answered(self) -> bool {
        matches!(self, Ending::Answered | Ending::Unchecked | Ending::CriticFaulted)
    }

    /// THE BOARD ROW'S WORD, when the status word is not the true one. `ready`
    /// is what a status fact says about a turn that stopped without answering —
    /// truthfully and uselessly, the same shape R9-1 fixed for the reload, and
    /// fixed the same way. `None` means the status word is right.
    pub(crate) fn word(self) -> Option<&'static str> {
        match self {
            Ending::Answered | Ending::Failed => None,
            // NOT "unverified", and not "verified" with a qualifier: the page
            // says what it observed. It answered — that part is plain — and
            // the second word names the thing nobody here can vouch for.
            Ending::Unchecked => Some("answered, unchecked"),
            Ending::NoAnswer => Some("stopped without answering"),
            Ending::RoundCeiling => Some("stopped at its round ceiling"),
            // NOT "finished". A turn cut off by its own budget with work still
            // in flight is the R17-P0-2 failure exactly, and the word has to
            // say that the stopping was the budget's doing and not the work's.
            Ending::PassCeiling => Some("stopped when its passes ran out"),
            // NOT "failed" and not "wrong": one agent reviewed another's work
            // and said no. The page is not claiming to know who is right — it
            // is refusing to file the turn as an answer over an objection.
            Ending::CriticFaulted => Some("answered, and the critic disagreed"),
            Ending::StoppedByYou => Some("stopped by you"),
        }
    }

    /// …AND WHAT TO DO ABOUT IT, in the row's second line. The card wears the
    /// same string off `data-line`, so the two cannot drift (R8-8).
    pub(crate) fn line(self) -> Option<String> {
        let said = match self {
            Ending::Answered | Ending::Failed => return None,
            // Two observations and no verdict: a file was written, nothing has
            // read it back. It does not say the work is wrong, because nothing
            // on this page knows that either.
            Ending::Unchecked => {
                "it changed a file and no command ran afterwards, so this page cannot say \
                 whether it worked — the Tool trace has what it did"
            }
            Ending::NoAnswer => {
                "its last reply was a tool call this page could not read, so nothing ran \
                 — the conversation has it, word for word; ask again"
            }
            Ending::RoundCeiling => {
                "it used every round of tool calls its agent file allows — raise \
                 `max_rounds:` in that file if the work needs more"
            }
            Ending::PassCeiling => {
                "it walked its stages as many times as `passes:` allows and was still \
                 changing things on the last one, so the work is unfinished — its last \
                 reply says where it got to; raise `passes:` or ask it to carry on"
            }
            Ending::CriticFaulted => {
                "it asked the critic to review the work and the critic did not clear it — \
                 the Tool trace has what the critic said"
            }
            Ending::StoppedByYou => {
                "nothing new was started after you pressed Stop; ask again to carry on"
            }
        };
        Some(said.to_string())
    }
}

/// WHICH STAGE, AND WHAT IT IS FOR (20). Without it the conversation shows one
/// agent answering three times in a row with nothing saying why — the
/// `VERIFY_NUDGED` defect, once per declared stage. The sentence names the
/// stage's job and claims nothing about the work.
///
/// …AND IT IS LABELLED WITH THE STAGE'S OWN NAME (21). All four wore `Note:`,
/// the page's generic word for "not speech", so the loop had no name on any
/// screen: a critic searched the rendered text of all six views and found
/// `verify` 0 times, `stage` 0, `loop` 0. The label comes off the
/// `core.stage_entered` fact already in the log — no second state (I8).
pub(crate) fn stage_note(payload_json: &str) -> (String, String) {
    let (label, said) = match agent::stage_of(payload_json).as_str() {
        s if s == agent::STAGE_PLAN => (
            "Plan stage",
            "Turning the request into a brief — what will be true when this is done, which \
             files, and the command that would show it. It calls nothing at this point.",
        ),
        s if s == agent::STAGE_VERIFY => (
            "Verify stage",
            "Running the check the brief named, and reading what it prints.",
        ),
        s if s == agent::STAGE_CRITIQUE => (
            "Critique stage",
            "Reading the turn back to name what is still missing, before answering.",
        ),
        _ => ("Work stage", "Doing the work."),
    };
    (label.to_string(), said.to_string())
}

/// A LAP OF THE STAGES, ON SCREEN (22). An agent that keeps working across
/// passes is a token meter running behind a spinner unless the laps are
/// visible, so the fact `agent::passes` emits gets a line of its own — with the
/// count, because "still going" and "going for the fourth time out of five" are
/// different things to read. The sentence also says what earned it: the
/// continue condition is mechanical, and nobody should have to read the source
/// to find out that the model was not asked whether it was done.
pub(crate) fn pass_note(payload_json: &str) -> (String, String) {
    let (pass, of) = agent::pass_of(payload_json);
    (
        format!("Pass {pass} of {of}"),
        "The last pass changed or ran something and the goal is not done, so it is going \
         round again from the work stage. Nothing asked the model whether it was finished — \
         a pass that touches nothing ends the turn."
            .to_string(),
    )
}
