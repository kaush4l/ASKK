//! THE ENDINGS, AND WHAT EACH ONE IS CALLED. Split from `ending.rs`, which owns
//! the FOLD that decides which one a log is showing — that file was at exactly
//! 200 lines (I12) before a fifth ending needed a word and a sentence.
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
    /// You pressed Stop. `halted.rs` owns what that leaves behind; this only
    /// has to keep the row and the card from calling it finished.
    StoppedByYou,
    /// The turn raised. The status fact already says `failed` and the card
    /// already has a branch for it, so this ending adds no word of its own — it
    /// is here so that a failure cannot be mistaken for the ending before it.
    Failed,
}

impl Ending {
    /// Whether there is an answer to read. The `Read the reply` button is
    /// offered on this and nothing else: a button that lands on a raw tool call
    /// is worse than no button. `Unchecked` counts — the reply exists and is
    /// the model's own prose; the row beside the button is what says what is
    /// not known about it.
    pub(crate) fn answered(self) -> bool {
        matches!(self, Ending::Answered | Ending::Unchecked)
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
            Ending::StoppedByYou => {
                "nothing new was started after you pressed Stop; ask again to carry on"
            }
        };
        Some(said.to_string())
    }
}
