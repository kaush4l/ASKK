//! # Run: what one run of the loop did, step by step
//!
//! The engine writes a [`Run`] as it goes through the stages of [`super::flow`]: one [`Step`]
//! per pass of the loop, one [`Mark`] per stage entered. A mark says how long the stage took,
//! one line on what happened, and the texts worth reading in full (the prompt as sent, the
//! reply as received, each call with its result). Nothing here decides anything: it is the
//! record a person reads to tune a loop.
//!
//! The last [`KEEP`] runs stay with the engine; each is saved under `<engine>/runs/<id>.json`,
//! so the record survives a restart.
use super::flow::Stage;
use serde::{Deserialize, Serialize};

/// Runs kept per engine (in memory and in the store).
pub const KEEP: usize = 12;

/// Longest text kept in one detail; the rest is cut with a note of how much.
pub const MAX_TEXT: usize = 120_000;

/// One stage of one step.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    pub stage: Stage,
    /// Milliseconds spent in the stage (0 while it is still open).
    #[serde(default)]
    pub ms: u64,
    /// One line: what happened.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    /// Texts to read in full, each `(label, text)`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub detail: Vec<(String, String)>,
}

/// One pass of the loop.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Step {
    /// 1-based.
    pub n: usize,
    #[serde(default)]
    pub marks: Vec<Mark>,
}

impl Step {
    pub fn ms(&self) -> u64 {
        self.marks.iter().map(|m| m.ms).sum()
    }
}

/// One run: an input, the steps it took, how it ended.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Run {
    /// Unix milliseconds at the start; also the order of runs.
    pub id: u64,
    pub input: String,
    /// The model asked (empty = the default).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
    /// running | done | stopped | error | out of steps | interrupted
    pub status: String,
    /// The final answer, or the error.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub answer: String,
    /// Milliseconds from start to end (so far, while running).
    #[serde(default)]
    pub ms: u64,
    #[serde(default)]
    pub steps: Vec<Step>,
}

impl Run {
    pub fn new(id: u64, input: &str, model: &str) -> Run {
        Run { id, input: input.into(), model: model.into(), status: "running".into(), ..Default::default() }
    }

    /// Start step `n` (1-based).
    pub fn step(&mut self, n: usize) {
        self.steps.push(Step { n, marks: vec![] });
    }

    /// Enter a stage: the open stage (if any) is closed with `ms`, the time it took.
    pub fn enter(&mut self, stage: Stage, ms: u64) {
        self.close(ms);
        if let Some(s) = self.steps.last_mut() {
            s.marks.push(Mark { stage, ms: 0, note: String::new(), detail: vec![] });
        }
    }

    /// Close the open stage with the time it took.
    pub fn close(&mut self, ms: u64) {
        if let Some(m) = self.steps.last_mut().and_then(|s| s.marks.last_mut()) {
            if m.ms == 0 {
                m.ms = ms.max(1);
            }
        }
    }

    /// Say what the open stage did.
    pub fn note(&mut self, note: &str, detail: Vec<(String, String)>) {
        if let Some(m) = self.steps.last_mut().and_then(|s| s.marks.last_mut()) {
            m.note = note.into();
            m.detail.extend(detail.into_iter().map(|(k, v)| (k, cut(&v))));
        }
    }

    /// The stage the run is in now (the last one entered).
    pub fn stage(&self) -> Option<Stage> {
        self.steps.last().and_then(|s| s.marks.last()).map(|m| m.stage)
    }

    /// The run without its long texts: every stage with its time and its one line.
    pub fn outline(&self) -> Run {
        let mut r = self.clone();
        for m in r.steps.iter_mut().flat_map(|s| s.marks.iter_mut()) {
            m.detail.clear();
        }
        if r.answer.chars().count() > 200 {
            r.answer = format!("{}…", r.answer.chars().take(200).collect::<String>());
        }
        r
    }

    pub fn running(&self) -> bool {
        self.status == "running"
    }
}

/// A text no longer than [`MAX_TEXT`], with a note of what was cut.
pub fn cut(text: &str) -> String {
    if text.len() <= MAX_TEXT {
        return text.into();
    }
    let mut end = MAX_TEXT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n… ({} more characters not kept)", &text[..end], text.len() - end)
}

/// A duration the short way: 840ms, 3.2s, 1m 04s.
pub fn took(ms: u64) -> String {
    match ms {
        0..=999 => format!("{ms}ms"),
        1_000..=59_999 => format!("{:.1}s", ms as f64 / 1000.0),
        _ => format!("{}m {:02}s", ms / 60_000, (ms % 60_000) / 1000),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_is_steps_of_timed_stages() {
        let mut r = Run::new(7, "hi", "m");
        r.enter(Stage::Prompt, 0);
        assert!(r.steps.is_empty(), "a stage outside a step is not recorded");
        r.step(1);
        r.enter(Stage::Prompt, 0);
        r.note("3 sections", vec![("prompt".into(), "## input\nhi".into())]);
        r.enter(Stage::Think, 12);
        assert_eq!(r.stage(), Some(Stage::Think));
        r.close(3400);
        r.close(9999);
        let m = &r.steps[0].marks;
        assert_eq!((m[0].ms, m[1].ms), (12, 3400), "a closed stage keeps its time");
        assert_eq!(m[0].detail[0].1, "## input\nhi");
        assert_eq!(r.steps[0].ms(), 3412);
        let back: Run = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert_eq!(back, r, "a run is its own file form");
    }

    #[test]
    fn long_texts_are_cut_and_durations_read_short() {
        let long = "é".repeat(MAX_TEXT);
        let c = cut(&long);
        assert!(c.len() < long.len() && c.contains("more characters not kept"));
        assert_eq!(cut("short"), "short");
        assert_eq!([took(840), took(3200), took(64_000)], ["840ms", "3.2s", "1m 04s"]);
    }
}
