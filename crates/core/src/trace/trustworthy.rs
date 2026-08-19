//! WHAT A ROW MAY VOUCH FOR (R13-2).
//!
//! A turn was asked for a CSV and a total. The trace held, in black,
//! `main ran write_file contents="item,cost\ncoffee,4.50\nrent,1800\
//! ninternet,60"}) path=budget.csv — ok`, then `main ran $ awk -F, 'NR>1
//! {sum+=$2} END {print sum}' budget.csv — ok` over `exec: (no output)`. The
//! chat said `The total cost is 1864.50.` The file was one line of fifty bytes
//! with the call's own `"})` on the end, `wc -l` said 0, the `awk` never
//! summed anything, and the number was the model's arithmetic alone.
//!
//! Both rows carried the evidence AND the word `ok`. `ok` on a call whose
//! argument ends in the three bytes that end a call, and `ok` on a command
//! whose whole job was to print a number and printed nothing, is the interface
//! vouching for something it did not check — a plausible wrong answer with a
//! green tick, which is the failure mode that makes an agent unusable.
//!
//! ONE predicate, so the trace's word and the conversation's clause cannot
//! disagree about which calls this page can stand behind. It never says the
//! ANSWER is wrong: this page cannot know that and does not guess. It says only
//! what the call's own record already shows.

use module::view::{Fragment, FragmentBuilder};

/// Why a successful call is still not something to vouch for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Doubt {
    /// A string argument ends in the call's own closing text — the model
    /// escaped it one level too many and the tool was handed the delimiters.
    Malformed,
    /// A command exited 0 and printed nothing. `mkdir` does that and is fine,
    /// so this is not a failure and is never called one; it is the difference
    /// between a call that did work and a call that produced an ANSWER.
    Silent,
}

/// This call's doubt, or `None` when the record backs it. Only successful calls
/// are asked: a failure already has a word of its own.
pub(crate) fn doubt(tool: &str, args: &str, ok: bool, output: &str) -> Option<Doubt> {
    if !ok {
        return None;
    }
    if agent::swallowed_close(args) {
        return Some(Doubt::Malformed);
    }
    match tool == "exec" && crate::chat::call_announcement::says_nothing(output) {
        true => Some(Doubt::Silent),
        false => None,
    }
}

/// The outcome WORD, beside the colour and never instead of it — the same rule
/// R3-18 set for `ok`/`failed` and R5-11 for `not there yet`. A row that cannot
/// say `ok` says which half of `ok` it means.
pub(crate) fn word(doubt: Option<Doubt>) -> &'static str {
    match doubt {
        None => "ok",
        Some(Doubt::Malformed) => "ok, but the arguments end with this call's own \"})",
        Some(Doubt::Silent) => "ok, and it printed nothing",
    }
}

/// THE SAME DOUBT, SAID TO A PERSON WHO HAS TO ACT ON IT (R16-P1-2). It read
/// `Tool trace cannot vouch for 2 of them` — two of what, why can it not, and
/// do what? — and it was the ONE warning on the page that was right: the reply
/// claimed a word count over three files having created one.
///
/// It says only what `doubt` checks: the call reported success and its own
/// record shows nothing behind it. NOT that it is missing from the trace — it
/// is there, with its own word — and not that the answer is wrong.
pub(crate) fn unbacked(n: usize) -> String {
    let (calls, backs) = match n {
        1 => ("1 call".to_string(), "its own record does not back it"),
        n => (format!("{n} calls"), "their own records do not back them"),
    };
    format!(
        "{calls} came back ok, but {backs}: an argument arrived mangled, or a command printed \
         nothing. Check the Tool trace before you trust the answer below"
    )
}

/// THE REFUSAL, AS A PERSON READS IT (R15-P1-5). The malformed-argument refusal
/// is written for the model — repair instructions plus the tool's whole
/// docstring — and it works: the model reads it and writes the call again. It
/// also rendered as ONE LINE, measured at 4973px against a 644px pane, and
/// wrapped in the Tool trace while the same string did not wrap in Commands.
///
/// The string the model gets is untouched. What changes is the rendering: one
/// sentence, and the whole of it behind a disclosure — which also gives both
/// panes the same box, so the two cannot wrap differently.
/// `None` for every other output, which is then the plain block it always was.
pub(crate) fn folded(output: &str) -> Option<Fragment> {
    if !output.contains(agent::NOTHING_RAN) {
        return None;
    }
    Some(
        FragmentBuilder::new("details")
            .class("refusal")
            .child(
                FragmentBuilder::new("summary")
                    .text("Nothing ran: an argument ended with this call's own closing text, so \
                           the tool was handed the delimiters instead of the value.")
                    .build(),
            )
            .child(
                FragmentBuilder::new("p")
                    .class("note")
                    .text("This is what was sent back to the model, in full — it says how to \
                           write the call again.")
                    .build(),
            )
            .child(
                FragmentBuilder::new("pre")
                    .attr("tabindex", "0")
                    .attr("role", "region")
                    .attr("aria-label", "the refusal the model was sent")
                    .text(output)
                    .build(),
            )
            .build(),
    )
}

/// WHETHER A CALL IS THE RETRY THAT WORKED (R15-P1-5). The refusal is only
/// worth showing a person if they can see it landed, and nothing said so: the
/// row after it looked like any other. Fed every call in log order — a tool
/// refused for a swallowed terminator is remembered, and the next call of that
/// tool that comes back `ok` is its recovery and clears it. …AND IT IS THE
/// SUMMARIES' FACT TOO (R16-P1-1): three surfaces cried failure over a turn
/// that had recovered inside itself. `failure::within_turn::note` counts the `true`s below.
#[derive(Default)]
pub(crate) struct Retries(Vec<String>);

impl Retries {
    pub(crate) fn note(&mut self, tool: &str, args: &str, ok: bool) -> bool {
        if let Some(at) = self.0.iter().position(|t| t == tool) {
            if ok {
                self.0.remove(at);
                return true;
            }
        }
        if !ok && agent::swallowed_close(args) {
            self.0.push(tool.to_string());
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{doubt, folded, word, Doubt, Retries};

    /// The exact bytes the browser measured, from the model text that produced
    /// them: valid JSON, `ok` from the port, and not a thing to vouch for.
    #[test]
    fn a_swallowed_terminator_is_seen_and_an_ordinary_write_is_not() {
        let bad = r#"{"path": "budget.csv", "contents": "\"item,cost\\ncoffee,4.50\\nrent,1800\\ninternet,60\"})"}"#;
        assert_eq!(doubt("write_file", bad, true, "wrote budget.csv"), Some(Doubt::Malformed));
        assert!(word(doubt("write_file", bad, true, "wrote budget.csv")) != "ok");
        let good = r#"{"path": "budget.csv", "contents": "item,cost\ncoffee,4.50\n"}"#;
        assert_eq!(doubt("write_file", good, true, "wrote budget.csv"), None);
        // A call that FAILED already has its own word; this adds nothing.
        assert_eq!(doubt("write_file", bad, false, "no such directory"), None);
    }

    /// `mkdir` printing nothing is not a failure and is not called one — but a
    /// command asked for a number that printed none has not answered either.
    #[test]
    fn a_command_that_printed_nothing_is_said_to_have_printed_nothing() {
        let args = r#"{"command":"awk -F, 'NR>1 {sum+=$2} END {print sum}' budget.csv"}"#;
        assert_eq!(doubt("exec", args, true, "(no output)"), Some(Doubt::Silent));
        assert_eq!(doubt("exec", args, true, ""), Some(Doubt::Silent));
        assert_eq!(doubt("exec", args, true, "1864.5"), None);
        // Only `exec` — a `write_file` that prints nothing did its work.
        assert_eq!(doubt("write_file", r#"{"path":"a.md"}"#, true, ""), None);
        assert_eq!(word(None), "ok");
    }

    /// R15-P1-5. One sentence on the summary, the model's whole copy inside.
    #[test]
    fn the_refusal_folds_and_ordinary_output_does_not() {
        let sent = format!("{} \"}}), this call's own closing text. …", agent::NOTHING_RAN);
        let html = folded(&sent).expect("a refusal folds").into_html();
        assert!(html.starts_with("<details"), "{html}");
        assert!(html.contains("<summary>Nothing ran: an argument ended with"), "{html}");
        assert!(html.contains("closing text. …"), "the model's copy is kept whole: {html}");
        assert!(folded("wrote budget.csv").is_none(), "ordinary output is a plain block");
    }

    /// …and the retry after it is marked, once, on the call that worked.
    #[test]
    fn the_call_that_recovers_from_a_refusal_is_the_one_marked() {
        let bad = r#"{"path": "a.csv", "contents": "x\"})"}"#;
        let good = r#"{"path": "a.csv", "contents": "x"}"#;
        let mut retries = Retries::default();
        assert!(!retries.note("write_file", bad, false), "the refusal is not its own retry");
        assert!(!retries.note("exec", good, true), "another tool is not the retry");
        assert!(retries.note("write_file", good, true), "the next write that worked is");
        assert!(!retries.note("write_file", good, true), "and only that one");
    }
}
