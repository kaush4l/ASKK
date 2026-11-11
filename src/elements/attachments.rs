//! # attachments
//! What the user attached to the conversation: images, sound, video. A message names an
//! attachment with a token (`[media:ab12cd]`, see [`crate::core::media`]); this element notices
//! the tokens in each input, asks the host what it sensed in the file, and gives the engine
//! both forms of it:
//!
//! - **words** in the prompt: what the file is, what was heard in it (a transcript), which
//!   frames were taken from a video;
//! - **pictures** beside the prompt ([`Component::media`]): the image itself, or a video's
//!   frames, for a model that sees. The newest `shown` (default 4) are sent with each request.
//!
//! ```json
//! {"kind": "attachments", "config": {"shown": 4}}
//! ```
use crate::core::media::{refs, senses, token, Attachment, Sensed};
use crate::core::{read, value, Component, Event, Spec};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const DOC: &str = "Attachments of the conversation (image, sound, video): the prompt says what each is and what was heard in it; images and video frames are shown to a model that sees.";

/// Attachments remembered per conversation.
const KEEP: usize = 12;
/// Characters of one transcript put in the prompt.
const MAX_TEXT: usize = 6000;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Cfg {
    /// Images sent with each request (the newest); default 4.
    #[serde(default, skip_serializing_if = "is_zero")]
    shown: usize,
}

fn is_zero(n: &usize) -> bool {
    *n == 0
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct St {
    /// Ids named in the conversation, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    seen: Vec<String>,
}

pub struct Media {
    name: String,
    cfg: Cfg,
    st: St,
}

pub fn new(s: Spec) -> Result<Box<dyn Component>, String> {
    let cfg: Cfg = read(&s.config)?;
    if cfg.shown > 20 {
        return Err("shown: at most 20 images with one request".into());
    }
    Ok(Box::new(Media { name: s.name, cfg, st: read(&s.state)? }))
}

/// One attachment as a line of the prompt.
pub fn describe(id: &str, s: Option<&Sensed>) -> String {
    let Some(s) = s else { return format!("{} is no longer kept", token(id)) };
    let len = if s.seconds > 0.0 { format!(" ({:.1}s)", s.seconds) } else { String::new() };
    let head = format!("{} {} \"{}\"{len}", token(id), s.kind, s.name);
    if s.status == "error" {
        return format!("{head}: could not be sensed: {}", s.text);
    }
    let words = |t: &str| if t.chars().count() > MAX_TEXT { format!("{}… (cut)", t.chars().take(MAX_TEXT).collect::<String>()) } else { t.to_string() };
    let heard = if s.text.trim().is_empty() { String::new() } else { format!("{}: \"{}\"", if s.kind == "text" { "it reads" } else { "heard in it" }, words(s.text.trim())) };
    let seen = match (s.kind.as_str(), s.parts.len()) {
        (_, 0) => String::new(),
        ("image", _) => "attached to this request as an image".to_string(),
        (_, n) => format!("{n} frames attached to this request as images ({})", s.parts.iter().map(|p| p.label.trim_start_matches("frame ").to_string()).collect::<Vec<_>>().join(", ")),
    };
    match (seen.is_empty(), heard.is_empty()) {
        (true, true) => format!("{head}: nothing could be taken from it"),
        (false, true) => format!("{head}: {seen}"),
        (true, false) => format!("{head}: {heard}"),
        (false, false) => format!("{head}: {seen}; {heard}"),
    }
}

impl Media {
    fn shown(&self) -> usize {
        if self.cfg.shown == 0 { 4 } else { self.cfg.shown }
    }
}

impl Component for Media {
    fn kind(&self) -> &'static str { "attachments" }
    fn unique(&self) -> bool { true }
    fn category(&self) -> &'static str { "live" }
    fn icon(&self) -> &'static str { "eye" }
    fn slot(&self) -> crate::core::Slot { crate::core::Slot::World }
    fn name(&self) -> &str { &self.name }
    fn doc(&self) -> &'static str { DOC }
    fn config(&self) -> Value { value(&self.cfg) }
    fn state(&self) -> Value { if self.st.seen.is_empty() { Value::Null } else { value(&self.st) } }
    fn view(&self) -> crate::core::node::Node {
        let port = senses();
        let lines: Vec<String> = self.st.seen.iter().rev().take(5).map(|id| match port.sensed(id) {
            Some(s) => format!("{} · {} · {}", s.name, s.kind, s.status),
            None => format!("{id} · gone"),
        }).collect();
        super::tile(&self.name, "attachments", std::iter::once(format!("{} attached", self.st.seen.len())).chain(lines))
    }
    fn on(&mut self, ev: &Event) {
        match ev {
            Event::Input(text) => {
                for id in refs(text) {
                    self.st.seen.retain(|x| *x != id);
                    self.st.seen.push(id);
                }
                let extra = self.st.seen.len().saturating_sub(KEEP);
                self.st.seen.drain(..extra);
            }
            Event::Cleared => self.st.seen.clear(),
            _ => {}
        }
    }
    fn prompt(&self) -> Option<String> {
        if self.st.seen.is_empty() {
            return None;
        }
        let port = senses();
        let lines: Vec<String> = self.st.seen.iter().map(|id| format!("- {}", describe(id, port.sensed(id).as_ref()))).collect();
        Some(format!("Attached by the user (oldest first; a message points at one with its [media:…] token):\n{}", lines.join("\n")))
    }
    fn media(&self) -> Vec<Attachment> {
        let port = senses();
        // The newest attachments first, until the limit; then back in the order they came.
        let mut out: Vec<Attachment> = vec![];
        for id in self.st.seen.iter().rev() {
            let Some(s) = port.sensed(id).filter(|s| s.status == "ready") else { continue };
            if !out.is_empty() && out.len() + s.parts.len() > self.shown() {
                break;
            }
            out.splice(0..0, s.parts.into_iter().take(self.shown()));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use crate::core::held::Held;
    use super::*;
    use crate::core::engine::tests::{file, spec, Scripted};
    use crate::core::{Engine, Fut, Infer, Sampling};
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    fn el(shown: usize) -> Box<dyn Component> {
        new(Spec { kind: "attachments".into(), name: "attached".into(), config: json!({"shown": shown}), ..Default::default() }).unwrap()
    }

    #[test]
    fn each_stream_reaches_the_prompt_as_words_and_the_model_as_pictures() {
        let mut m = el(4);
        assert!(m.prompt().is_none() && m.media().is_empty());
        m.on(&Event::Input(format!("what is this? {} and this {} and {} and {} {}", token("img1"), token("aud1"), token("vid1"), token("bad1"), token("gone9"))));
        let p = m.prompt().unwrap();
        assert!(p.contains("[media:img1] image \"img1.png\": attached to this request as an image"), "{p}");
        assert!(p.contains("[media:aud1] audio \"aud1.m4a\" (2.5s): heard in it: \"hello from the recording\""), "{p}");
        assert!(p.contains("[media:vid1] video \"vid1.mov\" (4.0s): 2 frames attached to this request as images (at 1.0s, at 3.0s); heard in it: \"hello from the recording\""), "{p}");
        assert!(p.contains("[media:bad1] audio \"bad1.m4a\": could not be sensed: no transcriber"), "{p}");
        assert!(p.contains("[media:gone9] is no longer kept"), "{p}");
        let shown: Vec<String> = m.media().iter().map(|a| format!("{}:{}", a.id, a.label)).collect();
        assert_eq!(shown, ["img1:", "vid1:frame at 1.0s", "vid1:frame at 3.0s"], "pictures in the order they came");
        let back = new(m.spec()).unwrap();
        assert_eq!(back.media().len(), 3, "what was attached survives a restart");
        m.on(&Event::Cleared);
        assert!(m.prompt().is_none());
    }

    #[test]
    fn only_the_newest_pictures_are_shown() {
        let mut m = el(2);
        m.on(&Event::Input(format!("{} {} {}", token("img1"), token("img2"), token("img3"))));
        assert_eq!(m.media().iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["img2", "img3"]);
        m.on(&Event::Input(format!("again {}", token("img1"))));
        assert_eq!(m.media().iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["img3", "img1"], "naming one again makes it the newest");
        m.on(&Event::Input(token("vid1")));
        assert_eq!(m.media().iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["vid1", "vid1"], "a video's frames stay together");
    }

    /// A runtime that records what it was shown.
    struct Seeing(Mutex<Vec<usize>>);
    impl Infer for Seeing {
        fn complete(&self, _: &str, _: String, _: Sampling) -> Fut<Result<String, String>> {
            self.0.held().push(0);
            Box::pin(async { Ok("blind".into()) })
        }
        fn complete_with(&self, _: &str, _: String, _: Sampling, media: Vec<Attachment>) -> Fut<Result<String, String>> {
            self.0.held().push(media.len());
            Box::pin(async { Ok("a red square".into()) })
        }
    }

    #[tokio::test]
    async fn the_engine_shows_the_model_what_was_attached() {
        let infer = Arc::new(Seeing(Mutex::default()));
        let e = Engine::new(file("e"), "e".into(), vec![spec("attachments", "attached", Value::Null), spec("history", "h", Value::Null)], vec![], vec![], infer.clone()).unwrap();
        assert_eq!(e.run(&format!("what shape? {}", token("img1"))).await.unwrap(), "a red square");
        assert_eq!(*infer.0.held(), [1], "one request, shown one image");
        let run = e.runs().pop().unwrap();
        let think = run.steps[0].marks.iter().find(|m| m.stage == crate::core::flow::Stage::Think).unwrap();
        assert!(think.note.contains("shown 1 image(s)"), "{}", think.note);
        // A runtime that cannot be shown anything still answers from the words.
        let blind = Engine::new(file("b"), "b".into(), vec![spec("attachments", "attached", Value::Null)], vec![], vec![], Scripted::new(&["from words"])).unwrap();
        assert_eq!(blind.run(&format!("hear this {}", token("aud1"))).await.unwrap(), "from words");
    }
}
