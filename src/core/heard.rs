//! # Heard: a reply while it arrives
//!
//! A runtime that can stream ([`super::Infer::stream`]) hands each piece of a reply on as it
//! comes. The engine keeps what has come for the run and step it belongs to ([`Heard`]), and
//! marks a key of its own changed ([`heard_key`]) at most every [`EVERY_MS`], so a window shows
//! the answer being written without reading the whole conversation again for every piece.
//! Which part of what has come is the answer is the reply format's to say
//! ([`super::Component::partial`]). Held in memory only: the run's record keeps the whole
//! reply once it is in.
use super::engine::Engine;
use super::held::Held;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

/// The reply arriving now: the run and step it is for, and the text so far.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Heard {
    pub run: u64,
    pub step: usize,
    pub text: String,
}

/// The key marked changed as a reply arrives, apart from the engine's own key.
pub fn heard_key(engine_key: &str) -> String {
    format!("said/{}", engine_key.trim_matches('/'))
}

/// How often, at most, the arriving reply is marked changed (a reader asks again each time).
pub const EVERY_MS: u128 = 60;

/// The reply arriving now for each engine, by its key.
fn all() -> &'static Mutex<BTreeMap<String, Heard>> {
    static ALL: OnceLock<Mutex<BTreeMap<String, Heard>>> = OnceLock::new();
    ALL.get_or_init(Default::default)
}

impl Engine {
    /// The reply arriving now, and the answer in it as far as it has come (the element that
    /// reads replies says which part is the answer; with none, all of it is).
    pub fn heard(&self) -> (Heard, String) {
        let h = all().held().get(&self.key).cloned().unwrap_or_default();
        let answer = self.elements.held().iter().find_map(|e| e.partial(&h.text)).unwrap_or_else(|| h.text.clone());
        (h, answer)
    }

    /// Ask the model for the reply to `step` of the current run, hearing it as it arrives.
    pub(crate) async fn stream(&self, model: &str, prompt: String, sampling: super::Sampling, media: Vec<super::media::Attachment>, step: usize) -> Result<String, String> {
        let out = self.infer.stream(model, prompt, sampling, media, self.hear(step)).await;
        // The whole reply is in: marked once more, so its last pieces are read.
        super::changes::mark(&heard_key(&self.key));
        out
    }

    /// Begin hearing the reply to `step` of the current run: where its pieces go.
    fn hear(&self, step: usize) -> super::Said {
        let key = heard_key(&self.key);
        let run = self.runs.held().back().map_or(0, |r| r.id);
        all().held().insert(self.key.clone(), Heard { run, step, text: String::new() });
        super::changes::mark(&key);
        let me = self.key.clone();
        let last = Mutex::new(None::<web_time::Instant>);
        Arc::new(move |piece: &str| {
            if let Some(h) = all().held().get_mut(&me) {
                h.text.push_str(piece);
            }
            let mut l = last.held();
            if l.is_none_or(|t| t.elapsed().as_millis() >= EVERY_MS) {
                *l = Some(web_time::Instant::now());
                drop(l);
                super::changes::mark(&key);
            }
        })
    }
}
