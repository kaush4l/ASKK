//! # Steer: a word from the owner into the run in hand
//!
//! A message sent while an engine works goes to its message box and is read by the next run.
//! A steer is sent into *this* run: the engine reads it at the very next step it begins
//! (before its next prompt is written, the soonest a loop that asks a model whole can hear
//! anything), as part of that step's input. When it lands, the steer says where: run and step.
//!
//! | when | what happens |
//! | --- | --- |
//! | sent ([`push`]) | it waits for the next step of the run in hand |
//! | the next step begins ([`into`]) | it is put in that step's input; it has landed at that step |
//! | the run ends before another step ([`settle`]) | it goes to the message box as a plain message, so the next run reads it |
use super::held::Held;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

/// One steer, as a window shows it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Steer {
    pub id: u64,
    pub text: String,
    /// The run and step it landed in; 0 = not yet.
    pub run: u64,
    pub step: usize,
    /// It came too late for the run and went to the message box instead.
    #[serde(default)]
    pub posted: bool,
}

impl Steer {
    pub fn landed(&self) -> bool {
        self.step > 0
    }
}

/// Steers kept per engine: the waiting ones and the last that landed.
const KEEP: usize = 8;

fn all() -> &'static Mutex<(u64, BTreeMap<String, Vec<Steer>>)> {
    static A: OnceLock<Mutex<(u64, BTreeMap<String, Vec<Steer>>)>> = OnceLock::new();
    A.get_or_init(Default::default)
}

/// Send `text` into the run of the engine at `path` (its key `key` is marked).
pub fn push(path: &str, key: &str, text: &str) -> u64 {
    let id = {
        let mut a = all().held();
        a.0 += 1;
        let id = a.0;
        let list = a.1.entry(path.to_string()).or_default();
        list.push(Steer { id, text: text.trim().to_string(), ..Default::default() });
        let over = list.len().saturating_sub(KEEP);
        list.drain(..over);
        id
    };
    super::changes::mark(key);
    id
}

/// The steers of the engine at `path`, oldest first.
pub fn of(path: &str) -> Vec<Steer> {
    all().held().1.get(path).cloned().unwrap_or_default()
}

/// The input of a step about to begin, with every steer that waits put in it: they land here.
pub fn into(path: &str, shown: String, run: u64, step: usize) -> String {
    let mut a = all().held();
    let Some(list) = a.1.get_mut(path) else { return shown };
    let mut said = vec![];
    for s in list.iter_mut().filter(|s| !s.landed() && !s.posted) {
        (s.run, s.step) = (run, step);
        said.push(format!("- {}", s.text));
    }
    if said.is_empty() {
        return shown;
    }
    format!("{shown}\n\nThe owner says, while you work (read it before you go on; it may change what you do):\n{}", said.join("\n"))
}

/// The steers that waited when the run ended: taken off, marked as posted, their texts given
/// back to go to the message box.
pub fn settle(path: &str) -> Vec<String> {
    let mut a = all().held();
    let Some(list) = a.1.get_mut(path) else { return vec![] };
    let mut out = vec![];
    for s in list.iter_mut().filter(|s| !s.landed() && !s.posted) {
        s.posted = true;
        out.push(s.text.clone());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_steer_lands_at_the_next_step_or_goes_to_the_box() {
        let id = push("steer-test", "engines/steer-test", "use metres");
        assert!(!of("steer-test")[0].landed());
        let shown = into("steer-test", "the input".into(), 7, 3);
        assert!(shown.starts_with("the input") && shown.ends_with("- use metres"), "{shown}");
        let s = &of("steer-test")[0];
        assert_eq!((s.id, s.run, s.step, s.landed()), (id, 7, 3, true), "it says where it landed");
        assert_eq!(into("steer-test", "next".into(), 7, 4), "next", "a steer lands once");
        assert!(settle("steer-test").is_empty());
        push("steer-test", "engines/steer-test", "too late");
        assert_eq!(settle("steer-test"), ["too late"], "one that came after the last step goes to the box");
        assert!(of("steer-test").last().unwrap().posted);
        assert_eq!(into("unknown", "x".into(), 1, 1), "x");
    }
}
