//! # Layout: what the terminal's lines look like
//!
//! Every line a person sees in the terminal is made here, from values, by functions that touch
//! nothing (no screen, no service), so each can be tested as text.
//!
//! The layout follows herdr, a terminal application that runs agents (`docs/components.md`,
//! "The terminal"): a head line with a state mark, sections under a dim lowercase heading,
//! a thin rule between sections, fields joined by ` · `, and a last line of commands where the
//! key is bright and its meaning is dim.
//!
//! ```text
//!  askk  ○ askk/coder · ready · 6 engines
//!  this build has: store, engines, code
//! ────────────────────────────────────────────────────────────────
//!  /engines list  /use <path> choose  /history read  /steps last run  /can build  /quit leave
//! > What is 17 * 23?
//!  ✓ Worked for 41ms · 2 steps · 1 call
//!  run
//!    think    asked the model · replied ~24 tokens  30ms
//!    parse    read as 1 call(s) · fields: summary  1ms
//!      summary: Work it out with a program
//!    act      1 call(s) ran  7ms
//!      → run_code(code: "17 * 23", language: "js")
//!        {"result":391}
//! ────────────────────────────────────────────────────────────────
//!  answer
//! 17 * 23 is 391.
//! ```
//!
//! [`Look`] says whether lines may carry colour. When they may not (the output goes to a file
//! or a pipe, or the person asked for no colour) the very same lines are written without it:
//! colour never carries a meaning the words and marks do not.
use crate::core::caps::Cap;
use crate::core::run::Run;
use crate::ui::features::run::{self as words, Tone};

/// Whether lines carry colour and emphasis (ANSI), or are plain text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Look {
    pub styled: bool,
}

/// What a piece of text is, so it can be told apart: the 16 colours every terminal has.
#[derive(Clone, Copy)]
pub enum Ink {
    /// Secondary: labels, separators, what is not in focus.
    Dim,
    /// A section's heading.
    Heading,
    /// The thing in focus: a name.
    Strong,
    /// Something to type or press.
    Key,
    /// Resting, ready.
    Ready,
    /// Finished well.
    Done,
    /// At work.
    Busy,
    /// Failed, or needs attention.
    Bad,
}

impl Look {
    /// `text` in `ink`; plain when this look has no colour.
    pub fn ink(self, ink: Ink, text: &str) -> String {
        if !self.styled || text.is_empty() {
            return text.to_string();
        }
        let code = match ink {
            Ink::Dim => "90",
            Ink::Heading => "1;90",
            Ink::Strong => "1",
            Ink::Key => "1;34",
            Ink::Ready => "32",
            Ink::Done => "36",
            Ink::Busy => "33",
            Ink::Bad => "91",
        };
        format!("\x1b[{code}m{text}\x1b[0m")
    }
}

/// How wide a rule is drawn.
const RULE: usize = 64;
/// Lines of one kept text shown before the rest is counted instead.
const MOST_LINES: usize = 12;

/// A thin line between two sections.
pub fn rule(look: Look) -> String {
    look.ink(Ink::Dim, &"─".repeat(RULE))
}

/// A section's heading: one lowercase word.
pub fn heading(look: Look, word: &str) -> String {
    look.ink(Ink::Heading, &format!(" {word}"))
}

/// The mark of a run's tone: at work, done, ended early, failed.
fn run_mark(look: Look, tone: Tone) -> String {
    match tone {
        Tone::Busy => look.ink(Ink::Busy, "◐"),
        Tone::Ok => look.ink(Ink::Done, "✓"),
        Tone::Warn => look.ink(Ink::Busy, "!"),
        Tone::Error => look.ink(Ink::Bad, "×"),
    }
}

/// The head line: the app, then the engine being talked to with a mark for its state.
/// `doing`: what the engine is doing, in words (`ready`, `thinking · step 2`).
pub fn header(look: Look, engine: &str, doing: &str, working: bool, engines: usize) -> String {
    let mark = if working { look.ink(Ink::Busy, "◐") } else { look.ink(Ink::Ready, "○") };
    let rest = look.ink(Ink::Dim, &format!("· {doing} · {engines} engine{}", if engines == 1 { "" } else { "s" }));
    format!(" {}  {mark} {} {rest}", look.ink(Ink::Strong, "askk"), look.ink(Ink::Strong, engine))
}

/// What this build can do, in one dim line.
pub fn has_line(look: Look, caps: &[Cap]) -> String {
    let has: Vec<&str> = caps.iter().filter(|c| c.here).map(|c| c.name.as_str()).collect();
    look.ink(Ink::Dim, &format!(" this build has: {}", has.join(", ")))
}

/// Each command and what it does, in the order a person needs them.
pub const COMMANDS: [(&str, &str); 6] = [("/engines", "list"), ("/use <path>", "choose"), ("/history", "read"), ("/steps", "last run"), ("/can", "build"), ("/quit", "leave")];

/// The commands in one line: the key bright, its meaning dim, two spaces between pairs.
pub fn commands(look: Look) -> String {
    let pairs: Vec<String> = COMMANDS.iter().map(|(key, does)| format!("{} {}", look.ink(Ink::Key, key), look.ink(Ink::Dim, does))).collect();
    format!(" {}", pairs.join("  "))
}

/// The first lines a person sees: head, what the build has, the commands.
pub fn greeting(look: Look, engine: &str, doing: &str, working: bool, engines: usize, caps: &[Cap]) -> String {
    [header(look, engine, doing, working, engines), has_line(look, caps), rule(look), commands(look)].join("\n")
}

/// A text of several lines under `indent`, cut after [`MOST_LINES`] with a count of the rest.
fn block(look: Look, ink: Option<Ink>, indent: &str, text: &str) -> Vec<String> {
    let all: Vec<&str> = text.lines().collect();
    let mut out: Vec<String> = all.iter().take(MOST_LINES).map(|l| format!("{indent}{}", ink.map_or(l.to_string(), |i| look.ink(i, l)))).collect();
    if all.len() > MOST_LINES {
        out.push(format!("{indent}{}", look.ink(Ink::Dim, &format!("… {} more lines", all.len() - MOST_LINES))));
    }
    out
}

/// The texts a stage kept that the terminal does not repeat under the stage: the prompt and
/// the reply are long (the page shows them), each call is shown where it ran with its result,
/// and the answer is set apart at the end.
const NOT_REPEATED: [&str; 5] = ["prompt", "sections", "reply", "call", "answer"];

/// One run as lines: how it stands, then every stage with what it did and how long it took;
/// under a stage, the short notes the model wrote first (its `summary`, its `thinking`); under
/// the stage that acts, each tool call (the program) and what came back.
pub fn run_lines(look: Look, run: &Run) -> Vec<String> {
    let mut out = vec![format!(" {} {}", run_mark(look, words::tone(&run.status)), look.ink(Ink::Strong, &words::headline(run))), heading(look, "run")];
    let many = run.steps.len() > 1;
    for step in &run.steps {
        if many {
            out.push(look.ink(Ink::Dim, &format!("   step {}", step.n)));
        }
        for m in &step.marks {
            let (name, note, time) = words::stage_head(m);
            out.push(format!("   {} {note}  {}", look.ink(Ink::Key, &format!("{name:<8}")), look.ink(Ink::Dim, &time)));
            for (label, text, _) in words::kept(m).into_iter().filter(|(label, _, _)| !NOT_REPEATED.contains(&label.as_str())) {
                // One line when it is one line; else the label, then the text under it.
                if text.lines().count() <= 1 {
                    out.push(format!("     {}", look.ink(Ink::Dim, &format!("{label}: {text}"))));
                } else {
                    out.push(format!("     {}", look.ink(Ink::Dim, &format!("{label}:"))));
                    out.extend(block(look, Some(Ink::Dim), "       ", &text));
                }
            }
            for call in words::calls(m) {
                out.push(format!("     {} {}", look.ink(Ink::Key, "→"), call.written()));
                out.extend(block(look, if call.failed { Some(Ink::Bad) } else { None }, "       ", &call.result));
            }
        }
    }
    out
}

/// The answer, set apart under its own heading. The text itself starts at the margin, as it
/// was given: it is what a person copies.
pub fn answer_lines(look: Look, answer: &str, failed: bool) -> Vec<String> {
    vec![rule(look), heading(look, if failed { "error" } else { "answer" }), if failed { look.ink(Ink::Bad, answer) } else { answer.to_string() }]
}

/// What one question led to: the run, then the answer.
pub fn asked(look: Look, run: Option<&Run>, answer: &str) -> String {
    let mut out = run.map(|r| run_lines(look, r)).unwrap_or_default();
    out.extend(answer_lines(look, answer, run.is_some_and(|r| words::tone(&r.status) == Tone::Error)));
    out.join("\n")
}

/// The one line shown while a run is going (it is written over itself as the run moves).
pub fn live_line(look: Look, run: &Run, waited_ms: u64) -> String {
    format!(" {} {} {}", run_mark(look, Tone::Busy), words::headline(run), look.ink(Ink::Dim, &format!("· {}", crate::core::run::took(waited_ms))))
}

/// The conversation: who, then what they said, oldest first.
pub fn turn_lines(look: Look, turns: &[(String, String)]) -> Vec<String> {
    turns.iter().map(|(who, text)| format!("{}: {text}", look.ink(if who == "user" { Ink::Key } else { Ink::Done }, who))).collect()
}

/// Every engine, the chosen one marked.
pub fn engine_lines(look: Look, engines: &[String], chosen: Option<usize>) -> Vec<String> {
    engines.iter().enumerate().map(|(i, e)| if Some(i) == chosen { format!("{} {}", look.ink(Ink::Key, "→"), look.ink(Ink::Strong, e)) } else { format!("  {e}") }).collect()
}

/// What this build can do, a line each: what it has, and what a missing thing means.
pub fn cap_lines(look: Look, caps: &[Cap]) -> Vec<String> {
    caps.iter().map(|c| if c.here { format!("{} {}: {}", look.ink(Ink::Ready, "✓"), c.name, look.ink(Ink::Dim, &c.note)) } else { format!("{} {}: {}", look.ink(Ink::Dim, "—"), c.name, c.note) }).collect()
}

/// Something that could not be done, as the one sentence it is.
pub fn failed(look: Look, why: &str) -> String {
    format!("{} could not: {why}", look.ink(Ink::Bad, "×"))
}

/// Where a person types.
pub fn prompt(look: Look) -> String {
    format!("{} ", look.ink(Ink::Key, ">"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::flow::Stage;
    use crate::core::run::{Mark, Step};

    const PLAIN: Look = Look { styled: false };
    const STYLED: Look = Look { styled: true };

    /// `text` without its colour.
    fn bare(text: &str) -> String {
        let mut out = String::new();
        let mut rest = text;
        while let Some(at) = rest.find('\x1b') {
            out.push_str(&rest[..at]);
            rest = rest[at..].split_once('m').map(|(_, r)| r).unwrap_or("");
        }
        out + rest
    }

    fn a_run() -> Run {
        let think = Mark { stage: Stage::Think, note: "asked scripted · replied ~24 tokens".into(), ms: 30, detail: vec![("reply".into(), "act: [run_code(code: \"1+1\")]".into())] };
        let prompt = Mark { stage: Stage::Prompt, note: "5 sections".into(), ms: 2, detail: vec![("prompt".into(), "## goal\nlong".into())] };
        let parse = Mark { stage: Stage::Parse, note: "read as 1 call(s) · fields: summary".into(), ms: 1, detail: vec![("summary".into(), "Work it out".into()), ("call".into(), "run_code(code: \"1+1\")".into())] };
        let act = Mark { stage: Stage::Act, note: "1 call(s) ran".into(), ms: 7, detail: vec![("run_code(code: \"1+1\", language: \"js\")".into(), "{\"result\":30007,\"logs\":[]}".into())] };
        Run { id: 1, input: "q".into(), status: "done".into(), ms: 41, steps: vec![Step { n: 1, marks: vec![prompt, think, parse, act] }], ..Default::default() }
    }

    #[test]
    fn plain_lines_carry_no_colour_and_say_the_same_as_coloured_ones() {
        let run = a_run();
        let makers: [fn(Look) -> String; 7] = [
            |l| asked(l, Some(&a_run()), "The sum is 30007."),
            |l| greeting(l, "askk/coder", "ready", false, 2, &[Cap { name: "code".into(), here: true, note: "node".into() }]),
            |l| turn_lines(l, &[("user".into(), "hi".into()), ("model".into(), "ho".into())]).join("\n"),
            |l| cap_lines(l, &[Cap { name: "code".into(), here: true, note: "node".into() }, Cap { name: "files".into(), here: false, note: "none".into() }]).join("\n"),
            |l| failed(l, "no engine"),
            commands,
            prompt,
        ];
        for make in makers {
            let (plain, styled) = (make(PLAIN), make(STYLED));
            assert!(!plain.contains('\x1b'), "plain text has no escape codes: {plain:?}");
            assert!(styled.contains('\x1b'), "the styled form is coloured: {styled:?}");
            assert_eq!(bare(&styled), plain, "colour adds nothing the words do not say");
        }
        assert_eq!(live_line(PLAIN, &run, 1200), " ◐ Worked for 41ms · 1 step · 1 call · 1.2s");
    }

    #[test]
    fn a_run_shows_each_stage_the_program_and_its_result_and_the_answer_apart() {
        let text = asked(PLAIN, Some(&a_run()), "The sum of the squares of the first 20 primes is 30007.");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], " ✓ Worked for 41ms · 1 step · 1 call");
        assert_eq!(lines[1], " run");
        assert!(lines.contains(&"   act      1 call(s) ran  7ms"), "{text}");
        assert!(lines.contains(&"     → run_code(code: \"1+1\", language: \"js\")"), "the program is shown as it was written: {text}");
        assert!(lines.contains(&"       {\"result\":30007,\"logs\":[]}"), "its result sits under it: {text}");
        assert!(lines.contains(&"     summary: Work it out"), "what the model noted first sits under the stage that read it: {text}");
        assert!(!text.contains("## goal") && !text.contains("reply:") && !text.contains("call:"), "the prompt, the raw reply and a second copy of the call are left out: {text}");
        let rule_at = lines.iter().position(|l| l.starts_with('─')).expect("a rule sets the answer apart");
        assert_eq!((lines[rule_at + 1], lines[rule_at + 2]), (" answer", "The sum of the squares of the first 20 primes is 30007."));
        // An answer with no run kept (the record is gone) is still an answer.
        assert!(asked(PLAIN, None, "42").ends_with(" answer\n42"));
    }

    #[test]
    fn the_head_says_who_and_how_and_the_last_line_lists_the_commands() {
        assert_eq!(header(PLAIN, "askk/coder", "ready", false, 6), " askk  ○ askk/coder · ready · 6 engines");
        assert_eq!(header(PLAIN, "askk", "thinking · step 2", true, 1), " askk  ◐ askk · thinking · step 2 · 1 engine");
        assert_eq!(commands(PLAIN), " /engines list  /use <path> choose  /history read  /steps last run  /can build  /quit leave");
        assert_eq!(turn_lines(PLAIN, &[("user".into(), "What is 2 + 2?".into())]), ["user: What is 2 + 2?"]);
        assert_eq!(engine_lines(PLAIN, &["askk".into(), "askk/coder".into()], Some(1)), ["  askk", "→ askk/coder"]);
        assert_eq!(failed(PLAIN, "no engine 'x'. /engines lists them"), "× could not: no engine 'x'. /engines lists them");
        let long = (1..=20).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
        assert_eq!(block(PLAIN, None, " ", &long).last().map(String::as_str), Some(" … 8 more lines"));
    }
}
