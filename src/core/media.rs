//! # Media: what is not text (images, sound, video)
//!
//! A person attaches a file to a message. The host keeps it and **senses** it: turns it into
//! what a model can take — an image stays an image (made smaller), sound becomes the words
//! spoken in it, a video becomes a few still frames plus the words of its sound track. The
//! result is a [`Sensed`]: text, and the [`Attachment`]s a model that sees can be shown.
//!
//! A message names its attachments with a token in its text (`[media:ab12cd]`, see [`token`]),
//! so they travel through the board and the history like any other word. The core and the
//! elements never open a file: they ask this port ([`senses`]); the host answers
//! (`host/media.rs`). How each kind is sensed is a value (`senses.json`), not code.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

/// Something a model can be shown beside the prompt.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Attachment {
    /// The media it comes from.
    pub id: String,
    /// What it is: `image` (the only kind models are shown today).
    pub kind: String,
    /// `image/jpeg`, …
    pub mime: String,
    /// Where the host keeps it.
    pub path: String,
    /// What it shows, when it is a part of something longer (`frame at 4.0s`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
}

/// One attached file after sensing.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Sensed {
    pub id: String,
    /// image | audio | video | text | file
    pub kind: String,
    /// The file's own name.
    pub name: String,
    /// ready | error
    pub status: String,
    /// What was heard or read (a transcript, a text file's contents); when `status` is
    /// `error`, why.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// What a model can be shown: the image, or the frames of a video.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<Attachment>,
    /// Length in seconds (sound, video); 0 = not known.
    #[serde(default)]
    pub seconds: f64,
    /// Each sensing step taken, `(what, how long in ms, how it went)`: the record of the stream.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<(String, u64, String)>,
}

/// The kind of a file by its mime type or its name.
pub fn kind_of(mime: &str, name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or_default().to_lowercase();
    let is = |list: &[&str]| list.contains(&ext.as_str());
    if mime.starts_with("image/") || is(&["png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tiff"]) {
        "image"
    } else if mime.starts_with("audio/") || is(&["mp3", "wav", "m4a", "aac", "aiff", "aif", "flac", "ogg", "opus"]) {
        "audio"
    } else if mime.starts_with("video/") || is(&["mp4", "mov", "m4v", "webm", "mkv", "avi"]) {
        "video"
    } else if mime.starts_with("text/") || is(&["txt", "md", "csv", "json", "log"]) {
        "text"
    } else {
        "file"
    }
}

/// How a message names an attachment.
pub fn token(id: &str) -> String {
    format!("[media:{id}]")
}

/// The attachments a text names, in order, each once.
pub fn refs(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let mut rest = text;
    while let Some(at) = rest.find("[media:") {
        rest = &rest[at + 7..];
        let Some(end) = rest.find(']') else { break };
        let id = &rest[..end];
        if valid_id(id) && !out.iter().any(|x| x == id) {
            out.push(id.into());
        }
        rest = &rest[end..];
    }
    out
}

/// A text without its attachment tokens (what a person reads).
pub fn without_refs(text: &str) -> String {
    let mut out = text.to_string();
    for id in refs(text) {
        out = out.replace(&token(&id), "");
    }
    out.trim().to_string()
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Bytes as base64 text (how a file crosses the wire, and how a model is handed an image).
pub fn b64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            out.push(if i <= c.len() { B64[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// Base64 text back to bytes.
pub fn unb64(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let (mut n, mut bits) = (0u32, 0u32);
    for c in text.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        let v = B64.iter().position(|b| *b == c).ok_or("not base64")? as u32;
        n = n << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((n >> bits) as u8);
            n &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

/// Ids are made by the host: letters and digits only, so an id is never a path.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The port: what the host knows about an attachment.
pub trait Senses: Send + Sync {
    fn sensed(&self, id: &str) -> Option<Sensed>;
}

struct Nothing;

impl Senses for Nothing {
    fn sensed(&self, _: &str) -> Option<Sensed> {
        None
    }
}

static SENSES: OnceLock<Arc<dyn Senses>> = OnceLock::new();

/// Give the app its senses (the host does this once, at start).
pub fn set(s: Arc<dyn Senses>) {
    let _ = SENSES.set(s);
}

pub fn senses() -> Arc<dyn Senses> {
    SENSES.get_or_init(unset).clone()
}

#[cfg(not(test))]
fn unset() -> Arc<dyn Senses> {
    Arc::new(Nothing)
}

/// Tests sense by name: an id that starts with `img` is an image, `aud` sound, `vid` a video
/// of two frames, `bad` sound nothing could hear; anything else is not kept.
#[cfg(test)]
fn unset() -> Arc<dyn Senses> {
    struct Fake;
    impl Senses for Fake {
        fn sensed(&self, id: &str) -> Option<Sensed> {
            let part = |label: &str| Attachment { id: id.into(), kind: "image".into(), mime: "image/jpeg".into(), path: format!("/media/{id}.jpg"), label: label.into() };
            let s = |kind: &str, ext: &str| Sensed { id: id.into(), kind: kind.into(), name: format!("{id}.{ext}"), status: "ready".into(), ..Default::default() };
            let _ = Nothing.sensed(id);
            match &id[..id.len().min(3)] {
                "img" => Some(Sensed { parts: vec![part("")], ..s("image", "png") }),
                "aud" => Some(Sensed { text: "hello from the recording".into(), seconds: 2.5, ..s("audio", "m4a") }),
                "vid" => Some(Sensed { text: "hello from the recording".into(), seconds: 4.0, parts: vec![part("frame at 1.0s"), part("frame at 3.0s")], ..s("video", "mov") }),
                "bad" => Some(Sensed { status: "error".into(), text: "no transcriber".into(), ..s("audio", "m4a") }),
                _ => None,
            }
        }
    }
    Arc::new(Fake)
}

/// One command that senses: a program with its arguments, where `{input}`, `{output}`, `{dir}`,
/// `{stem}` and `{at}` are filled in. `text` names the file the words end up in (empty = what
/// the command prints). `field`: the output is JSON and the words are in this field of it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    #[serde(default)]
    pub command: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub field: String,
}

/// `senses.json`: how each kind of input becomes something a model can take.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Image → a smaller image (`{input}` → `{output}`, a jpeg).
    pub image: Command,
    /// Sound → the words spoken.
    pub hear: Command,
    /// Video → one still frame at `{at}` seconds (`{input}` → `{output}`, a jpeg).
    pub frame: Command,
    /// Video → its sound track (`{input}` → `{output}`, a wav), which is then heard.
    pub sound: Command,
    /// Sound or video → its length in seconds, printed.
    pub length: Command,
    /// Frames taken from one video, spread evenly.
    pub frames: usize,
}

impl Config {
    /// The structure the value must keep.
    pub fn validate(&self) -> Result<(), String> {
        if self.frames > 24 {
            return Err("frames: at most 24 per video".into());
        }
        for (name, c) in [("image", &self.image), ("hear", &self.hear), ("frame", &self.frame), ("sound", &self.sound), ("length", &self.length)] {
            if c.command.first().is_some_and(|p| p.trim().is_empty()) {
                return Err(format!("{name}: the command's program is empty"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_names_its_attachments_with_tokens() {
        let t = format!("look at this {} and {} again {}", token("ab12"), token("zz9"), token("ab12"));
        assert_eq!(refs(&t), ["ab12", "zz9"]);
        assert_eq!(without_refs(&format!("what is this? {}", token("ab12"))), "what is this?");
        assert!(refs("[media:../etc] [media:] [media:ok1").is_empty(), "an id is never a path");
    }

    #[test]
    fn bytes_cross_the_wire_as_base64() {
        for bytes in [&b""[..], b"f", b"fo", b"foo", b"foob", &[0u8, 255, 16, 128, 7]] {
            assert_eq!(unb64(&b64(bytes)).unwrap(), bytes);
        }
        assert_eq!(b64(b"foob"), "Zm9vYg==");
        assert!(unb64("not base64!").is_err());
    }

    #[test]
    fn a_file_has_a_kind() {
        assert_eq!(kind_of("image/png", "x"), "image");
        assert_eq!(kind_of("", "talk.M4A"), "audio");
        assert_eq!(kind_of("application/octet-stream", "clip.mov"), "video");
        assert_eq!(kind_of("", "notes.md"), "text");
        assert_eq!(kind_of("", "thing.bin"), "file");
    }

    #[test]
    fn the_senses_config_keeps_its_structure() {
        assert!(Config::default().validate().is_ok());
        assert!(serde_json::from_str::<Config>(r#"{"smell": {}}"#).is_err(), "an unknown sense is not a sense");
        let c: Config = serde_json::from_str(r#"{"frames": 99}"#).unwrap();
        assert!(c.validate().unwrap_err().contains("frames"));
    }
}
