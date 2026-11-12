//! # Talk: ask an engine, see what its loop did, read the conversation
//!
//! The loop keeps a record of each run ([`crate::core::run::Run`]) and the engine keeps its
//! conversation. This file says how a person reads them, once, for every UI.
use crate::api::ChatTurn;
use crate::core::run::Run;

/// The engine a person talks to when they have not chosen one: the developer, which does
/// the work itself and can run a program it wrote; else the first.
pub fn first_choice(engines: &[String]) -> Option<usize> {
    if engines.is_empty() {
        return None;
    }
    Some(engines.iter().position(|e| e == "askk/developer").unwrap_or(0))
}

/// One run as lines, a line per stage of each step, with the texts the stage kept under it
/// (the prompt is left out: it is long, and `engine_prompt` shows it).
// Asked for by the tab's own page (local/page.rs) only, so other builds leave it unused.
#[cfg_attr(not(feature = "local"), allow(dead_code))]
pub fn stages(run: &Run) -> Vec<String> {
    let mut lines = vec![];
    for step in &run.steps {
        for m in &step.marks {
            lines.push(format!("step {} · {:?} ({} ms): {}", step.n, m.stage, m.ms, m.note));
            for (label, text) in m.detail.iter().filter(|(label, _)| label != "prompt") {
                lines.push(format!("    {label}: {text}"));
            }
        }
    }
    lines
}

/// The conversation as `(who, what they said)`, oldest first.
pub fn turns(chat: Vec<ChatTurn>) -> Vec<(String, String)> {
    chat.into_iter().map(|t| (t.role, t.text)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::flow::Stage;
    use crate::core::run::{Mark, Step};

    #[test]
    fn a_run_reads_as_one_line_per_stage_with_what_it_kept_and_no_prompt() {
        let mark = Mark { stage: Stage::Act, note: "1 call(s) ran".into(), ms: 7, detail: vec![("prompt".into(), "long".into()), ("run_code".into(), "{\"result\":4}".into())] };
        let run = Run { steps: vec![Step { n: 1, marks: vec![mark] }], ..Default::default() };
        let lines = stages(&run);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "step 1 · Act (7 ms): 1 call(s) ran");
        assert_eq!(lines[1], "    run_code: {\"result\":4}");
    }

    #[test]
    fn the_first_choice_is_the_engine_that_runs_programs() {
        assert_eq!(first_choice(&["askk".into(), "askk/developer".into()]), Some(1));
        assert_eq!(first_choice(&["askk".into()]), Some(0));
        assert_eq!(first_choice(&[]), None);
    }
}
