//! Content parts — the modality capability of the rendered "sheet of paper".
//!
//! The rendered prompt an engine sends to the model is one big sheet of paper:
//! mostly text, but able to carry image/audio attachments alongside it. [`Part`]
//! is one such attachment; [`MultimodalCollector`]s contribute parts fresh at
//! every render, so a collector can snapshot a camera frame or an audio buffer
//! at the moment the model is called.

use std::rc::Rc;

/// One content part attached to a model request alongside the rendered text.
///
/// The loop is modality-agnostic: parts are collected at render time and travel
/// on the request; a provider that cannot ship a given modality ignores it.
#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    /// Plain text content.
    Text(String),
    /// An image, base64-encoded with its MIME type (e.g. `image/png`).
    Image { mime: String, data_base64: String },
    /// An audio clip, base64-encoded with its MIME type (e.g. `audio/wav`).
    Audio { mime: String, data_base64: String },
}

/// A callback that contributes [`Part`]s to the next model call — e.g. a screen
/// capture or a microphone buffer. Collected fresh on every render.
pub type MultimodalCollector = Rc<dyn Fn() -> Vec<Part>>;
