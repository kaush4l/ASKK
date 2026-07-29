//! §8.1 second stage: how THIS provider wants to hear the paper. Pure and
//! deterministic like `assemble`; the two never collapse (§8.1). Three
//! targets suffice per the multimodal research; provider quirks live only here.

use serde::{Deserialize, Serialize};

use crate::types::Document;

/// Provider wire formats `render` knows (RESEARCH multimodal: OpenAI-compat
/// intersection + the two majors). Capability flags ride the variant because
/// "OpenAI-compatible" endpoints differ in what parts they accept — the flag
/// decides degrade-vs-send per part, recorded, never a silent drop (I15).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderFormat {
    OpenAiChat { vision: bool, audio: bool },
    Anthropic,
    Gemini,
}

/// Message roles across all three targets. Closed: a fourth role is a
/// provider quirk to map here, not a concept the paper needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    System,
    User,
    Assistant,
}

/// Provider-neutral content block. Neutral on purpose: the exact JSON shape
/// per provider (image_url vs source, `cache_control` breakpoints — the
/// prompt-caching post-pass) is serialization detail applied when the request
/// body is written, so goldens diff structure, not provider syntax.
/// PROVISIONAL: breakpoint markers may become a variant if the post-pass
/// proves awkward in G4.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContentPart {
    Text {
        text: String,
    },
    Image {
        media_type: String,
        data_base64: String,
    },
    Audio {
        media_type: String,
        data_base64: String,
    },
    File {
        name: String,
        media_type: String,
        data_base64: String,
    },
}

/// One rendered message. Content is always the array form so multimodal parts
/// need no special casing (Spike C).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: Vec<ContentPart>,
}

/// Render the assembled paper for one provider — the frozen §8.1 signature.
/// Document order becomes the cacheable prefix; text-only targets get typed
/// placeholders for non-text parts, and every downgrade is visible in the
/// output (never silent).
pub fn render(doc: &Document, target: ProviderFormat) -> Vec<Message> {
    let _ = (doc, target);
    todo!("G4")
}

/// Content hash of a rendered document, for the per-turn event-log record
/// (ADR-009: hash + fidelities persist; full text only on request — it
/// contains everything personal). PROVISIONAL: hand-rolled FNV-style hash,
/// no crypto dependency — collision resistance is not the requirement,
/// stable identity in `git diff`-able logs is.
pub fn content_hash(messages: &[Message]) -> String {
    let _ = messages;
    todo!("G4")
}
