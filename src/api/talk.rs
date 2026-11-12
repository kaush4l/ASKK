//! Talk: the conversation with an engine, as the chat draws it.
//!
//! One answer ([`talk`]) holds everything the chat shows for an engine: the conversation as
//! **beats** (what was asked, what was attached, the run that answered it, what it drew, what
//! it said), the whole board, and the last runs. The record of a run comes without its long
//! texts; [`engine_run`] gives one run in full when its card is opened.
//!
//! Attachments arrive in pieces ([`media_begin`], [`media_piece`]) and are sensed when whole
//! ([`media_done`]). [`modes`] lists the engines the chat offers as conversation modes.
use crate::core::media::Sensed;
use crate::core::node::Node;
use crate::core::run::Run;
use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

/// A conversation mode: an engine that names one in its `engine.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Mode {
    pub name: String,
    pub path: String,
    pub icon: String,
    pub about: String,
}

/// An attachment as the chat shows it (never where the host keeps it).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Chip {
    pub id: String,
    /// image | audio | video | text | file
    pub kind: String,
    pub name: String,
    /// ready | error | gone
    pub status: String,
    /// What was heard or read in it, or why it could not be sensed.
    pub text: String,
    pub seconds: f64,
    /// Pictures a model is shown from it (the image, or a video's frames).
    pub pictures: usize,
    /// Each sensing step: `(what, ms, how it went)`.
    pub steps: Vec<(String, u64, String)>,
}

impl Chip {
    pub fn of(id: &str, s: Option<Sensed>) -> Chip {
        match s {
            Some(s) => Chip { id: s.id, kind: s.kind, name: s.name, status: s.status, text: s.text, seconds: s.seconds, pictures: s.parts.len(), steps: s.steps },
            None => Chip { id: id.into(), kind: "file".into(), name: id.into(), status: "gone".into(), ..Default::default() },
        }
    }
}

/// One exchange: something was asked, the engine ran, drew and answered.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Beat {
    /// Who asked: `user`, or an engine's path.
    pub from: String,
    /// What was asked, without attachment tokens.
    pub text: String,
    pub media: Vec<Chip>,
    /// The run that answered it (its outline), when its record is still kept.
    pub run: Option<Run>,
    /// What that run put on the board.
    pub figures: Vec<Node>,
    /// What the engine said, in order.
    pub replies: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Talk {
    pub beats: Vec<Beat>,
    /// Everything on the board, oldest first.
    pub board: Vec<Node>,
    /// The last runs (outlines), oldest first: also those no beat shows (alerts, other engines).
    pub runs: Vec<Run>,
    /// The engine's live activity and its detail.
    pub activity: String,
    pub detail: String,
}

/// `"from user: hi"` → (`user`, `hi`); an input with no sender is the user's.
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub fn sender(input: &str) -> (String, String) {
    match input.strip_prefix("from ").and_then(|r| r.split_once(": ")) {
        Some((who, text)) if !who.contains(char::is_whitespace) => (who.to_string(), text.to_string()),
        _ => ("user".into(), input.to_string()),
    }
}

/// What a reply says to whoever asked: its answer, and what it sent back through its message
/// box (`ack {reply}`, `answer {text}`, `post {to: user}`).
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub fn said(reply: &crate::core::Reply) -> Vec<String> {
    let mut out: Vec<String> = reply
        .calls
        .iter()
        .filter_map(|c| match c.tool.as_str() {
            "ack" => c.args["reply"].as_str(),
            "answer" => c.args["text"].as_str(),
            "post" if c.args["to"] == "user" => c.args["text"].as_str(),
            _ => None,
        })
        .map(|s| s.trim().to_string())
        .collect();
    out.extend(reply.answer.iter().map(|a| a.trim().to_string()));
    out.retain(|s| !s.is_empty());
    out.dedup();
    out
}

/// The conversation as beats. `turns` are `(role, raw text)` in order; each `user` turn opens a
/// beat, and is tied to the newest run not yet tied whose input is that turn's text.
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub fn beats(turns: &[(String, String)], runs: &[Run], says: impl Fn(&str) -> Vec<String>, chip: impl Fn(&str) -> Chip) -> Vec<Beat> {
    let mut out: Vec<(Beat, String)> = vec![];
    for (role, raw) in turns {
        match role.as_str() {
            "user" => {
                let (from, text) = sender(raw);
                let media = crate::core::media::refs(&text).iter().map(|id| chip(id)).collect();
                out.push((Beat { from, text: crate::core::media::without_refs(&text), media, ..Default::default() }, raw.clone()));
            }
            "summary" => out.push((Beat { from: "summary".into(), text: raw.clone(), ..Default::default() }, String::new())),
            "model" => {
                if out.is_empty() {
                    out.push((Beat { from: "user".into(), ..Default::default() }, String::new()));
                }
                out.last_mut().unwrap().0.replies.extend(says(raw));
            }
            _ => {}
        }
    }
    // Newest beats take the newest runs, so a question asked twice shows each its own run.
    let mut free: Vec<&Run> = runs.iter().collect();
    for (beat, raw) in out.iter_mut().rev() {
        if let Some(i) = free.iter().rposition(|r| !raw.is_empty() && r.input == *raw) {
            beat.run = Some(free.remove(i).outline());
        }
    }
    out.into_iter().map(|(b, _)| b).collect()
}

/// A figure as a node, with real data put in when it names some.

// The answers are plain functions in `answers`; these are their Dioxus form (see `wire!`).
#[cfg(any(feature = "server", feature = "local"))]
mod answers;
#[cfg(feature = "local")]
pub use answers::*;

wire! {
    talk(path: String) -> Talk;
    engine_run(path: String, id: u64) -> Run;
    engine_runs(path: String) -> Vec<Run>;
    modes() -> Vec<Mode>;
    busy() -> Vec<Busy>;
    media_begin(name: String, mime: String) -> String;
    media_piece(id: String, data: String) -> u64;
    media_done(id: String) -> Chip;
    media_picture(id: String) -> String;
    run_partial(path: String) -> Arriving;
    talks(path: String) -> Vec<TalkInfo>;
    talk_new(path: String) -> u64;
    talk_open(path: String, id: u64) -> ();
    talk_saved(path: String, id: u64) -> Talk;
    engine_permit(path: String) -> Permit;
    set_engine_permit(path: String, mode: String) -> ();
    approve(path: String, id: u64, yes: bool) -> ();
    engine_model(path: String) -> String;
    set_engine_model(path: String, model: String) -> ();
    set_engine_goal(path: String, text: String) -> ();
    compact(path: String) -> String;
    steer(path: String, text: String) -> u64;
    steers(path: String) -> Vec<Steer>;
    talk_rename(path: String, id: u64, name: String) -> ();
    talk_archive(path: String, id: u64, archived: bool) -> ();
    talk_settle(path: String, id: u64, settled: bool) -> ();
    talk_search(path: String, query: String) -> Vec<TalkHit>;
    rewind(path: String, n: usize) -> String;
}

/// What an engine may do without asking (`ask`, `edits`, `all`), and the calls that wait for a yes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Permit {
    pub mode: String,
    pub waiting: Vec<crate::core::permit::Approval>,
}

pub use crate::core::steer::Steer;
pub use crate::core::talks::TalkHit;

/// The answer an engine is writing now, as far as it has come: the run and step it is for,
/// the answer so far (what the reply format calls the answer; all of it without one), and how
/// many characters of reply have come in all (fields and calls too).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Arriving {
    pub run: u64,
    pub step: usize,
    pub said: String,
    pub chars: usize,
}

/// One conversation of an engine, as its list shows it.
pub use crate::core::talks::TalkInfo;

/// An engine at work right now: who it is, what it is doing, and the run it is in.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Busy {
    pub path: String,
    pub name: String,
    pub icon: String,
    /// thinking | calling | refocusing
    pub activity: String,
    /// `step 2`, or the tools being called.
    pub detail: String,
    /// The run in progress (its outline), when there is one.
    pub run: Option<Run>,
}
