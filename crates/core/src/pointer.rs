//! WHICH VIEW A CALL'S ROW IS IN — the one answer every sentence that points at
//! one reads. Its own file so `failed.rs` keeps the 200-line rule (I12) with its
//! tests, which is where the predicate it wraps is exercised in anger.

/// WHERE THE CALLS THIS CLAUSE COUNTS ACTUALLY LANDED (R17-P1-3).
///
/// Chat said *"a tool call was refused and the retry after it worked — the Tool
/// trace has both"* over a refused `exec`. R15 moved every shell row OUT of the
/// trace and into Commands, and the trace itself says so on its own empty
/// state; the sentence was wrong precisely because of a change made two rounds
/// earlier. The pointer is computed from `trace::is_shell` — the same predicate
/// that did the moving — so the two cannot drift apart again.
#[derive(Default, Clone, Copy)]
pub(crate) struct Where {
    trace: bool,
    commands: bool,
    /// HOW MANY OF THIS AGENT'S OWN CALLS RAN IN THAT TURN (R18-P1-5), counted
    /// here because this is already the one place every one of them passes
    /// through with the page's own housekeeping filtered out. Zero is the fact
    /// the Dashboard card needed and had no way to ask for: a turn that
    /// answered without running anything is not a turn that did anything.
    calls: usize,
}

impl Where {
    /// One call, filed where its row went — when it is one this clause counts.
    pub(crate) fn note(&mut self, tool: &str, counted: bool) {
        self.calls += 1;
        if !counted {
            return;
        }
        match crate::trace::is_shell(tool) {
            true => self.commands = true,
            false => self.trace = true,
        }
    }

    /// How many calls that turn made, failed or not.
    pub(crate) fn ran(self) -> usize {
        self.calls
    }

    /// The view's name, and the verb that agrees with it. Nothing counted at
    /// all names the trace, which is where a tool call goes by default.
    pub(crate) fn named(self) -> (&'static str, &'static str) {
        match (self.trace, self.commands) {
            (true, true) => ("the Tool trace and Commands", "have"),
            (false, true) => ("Commands", "has"),
            _ => ("the Tool trace", "has"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Where;

    /// R17-P1-3: the sentence points at the view the call's row is really in.
    /// A refused SHELL call is in Commands — R15 moved it there — and saying
    /// "the Tool trace has both" sends the reader to a pane that states, on
    /// itself, that it does not.
    #[test]
    fn the_pointer_names_the_view_the_failing_call_is_actually_in() {
        let (mut shell, mut both) = (Where::default(), Where::default());
        shell.note("exec", true);
        both.note("exec", true);
        both.note("write_file", true);
        assert!(crate::failed::note(1, 0, shell).unwrap().ends_with("— Commands has it"));
        assert!(crate::failed::note(1, 1, shell).unwrap().ends_with("— Commands has both"));
        assert!(crate::failed::note(2, 0, both).unwrap().ends_with("— the Tool trace and Commands have them"));
        let mut tool = Where::default();
        tool.note("write_file", true);
        assert!(crate::failed::note(1, 0, tool).unwrap().ends_with("— the Tool trace has it"));
    }
}
