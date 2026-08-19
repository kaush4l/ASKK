//! §8.1 second stage: how THIS provider wants to hear the paper. Pure and
//! deterministic like `assemble`; the two never collapse (§8.1). Three
//! targets suffice per the multimodal research; provider quirks live only here.

use serde::{Deserialize, Serialize};

use crate::types::{CompactionReport, Document, Fidelity, Part};

/// Provider wire formats `render` knows (RESEARCH multimodal: OpenAI-compat
/// intersection + the two majors). Capability flags ride the variant because
/// "OpenAI-compatible" endpoints differ in what parts they accept.
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
/// per provider (image_url vs source, `cache_control` breakpoints) is
/// serialization detail applied when the request body is written, so goldens
/// diff structure, not provider syntax.
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
/// Document order becomes the cacheable prefix; every downgrade a target
/// forces is visible in the output, never silent.
pub fn render(doc: &Document, target: ProviderFormat) -> Vec<Message> {
    match target {
        ProviderFormat::OpenAiChat { vision, audio } => render_chat(doc, vision, audio),
        ProviderFormat::Anthropic | ProviderFormat::Gemini => todo!("G5: second provider"),
    }
}

/// One system message carrying the paper in document order (the assembled
/// text IS the cacheable prefix), then one fixed user message. Ported from
/// Spike C.
fn render_chat(doc: &Document, vision: bool, audio: bool) -> Vec<Message> {
    let mut parts: Vec<ContentPart> = Vec::new();
    let mut text = String::new();
    for s in &doc.sections {
        if s.fidelity == Fidelity::Elided {
            continue;
        }
        text.push_str(&format!("## {}\n({})\n", s.id.0, s.intent));
        for p in &s.parts {
            place(&mut parts, &mut text, p, vision, audio);
        }
        text.push('\n');
    }
    append_compaction_notice(&mut text, &doc.report);
    flush_text(&mut parts, &mut text);
    vec![
        Message {
            role: Role::System,
            content: parts,
        },
        Message {
            role: Role::User,
            content: vec![ContentPart::Text {
                text: "Proceed as the response_contract instructs.".into(),
            }],
        },
    ]
}

/// Put one part where it goes: prose joins the running text, a part this
/// target can hear becomes its own block at that position, one it cannot
/// becomes a visible placeholder — never a silent drop (I15).
fn place(parts: &mut Vec<ContentPart>, text: &mut String, p: &Part, vision: bool, audio: bool) {
    match p {
        Part::Text { text: t } => {
            text.push_str(t);
            text.push('\n');
        }
        Part::Fragment { id, html } => {
            text.push_str(&format!("<fragment id=\"{id}\">\n{html}\n</fragment>\n"));
        }
        _ => match audible(p, vision, audio) {
            Some(block) => {
                flush_text(parts, text);
                parts.push(block);
            }
            None => text.push_str(&withheld(p)),
        },
    }
}

/// The part as its own content block, if this target can hear it: `vision`
/// carries images and files, `audio` carries sound. `None` is "not for this
/// target", which is the only reason a part is ever withheld.
fn audible(p: &Part, vision: bool, audio: bool) -> Option<ContentPart> {
    match p {
        Part::Image { media_type, data_base64 } if vision => Some(ContentPart::Image {
            media_type: media_type.clone(),
            data_base64: data_base64.clone(),
        }),
        Part::Audio { media_type, data_base64 } if audio => Some(ContentPart::Audio {
            media_type: media_type.clone(),
            data_base64: data_base64.clone(),
        }),
        Part::File { name, media_type, data_base64 } if vision => Some(ContentPart::File {
            name: name.clone(),
            media_type: media_type.clone(),
            data_base64: data_base64.clone(),
        }),
        _ => None,
    }
}

/// What the model reads in place of a part it cannot hear: typed, named, and
/// present — so a downgrade is visible in the prompt itself (I15).
fn withheld(p: &Part) -> String {
    let kind = match p {
        Part::Image { media_type, .. } => format!("image ({media_type})"),
        Part::Audio { media_type, .. } => format!("audio ({media_type})"),
        Part::File { name, media_type, .. } => format!("file '{name}' ({media_type})"),
        Part::Text { .. } | Part::Fragment { .. } => return String::new(),
    };
    format!("[{kind} withheld: text-only target]\n")
}

/// What was compacted out of this document, appended AFTER every section: a
/// notice that changes each turn must not sit inside the stable prefix.
fn append_compaction_notice(text: &mut String, report: &CompactionReport) {
    if report.steps.is_empty() && report.withheld.is_empty() {
        return;
    }
    text.push_str("## compaction_notice\n");
    text.push_str("(what was compacted out of this document; ask to restore)\n");
    for d in &report.steps {
        text.push_str(&format!("- {}: {:?} -> {:?}\n", d.section.0, d.from, d.to));
    }
    for id in &report.withheld {
        text.push_str(&format!("- {}: a binary part was withheld\n", id.0));
    }
}

/// Close the running text buffer, so non-text parts keep their position.
fn flush_text(parts: &mut Vec<ContentPart>, text: &mut String) {
    if !text.is_empty() {
        parts.push(ContentPart::Text {
            text: std::mem::take(text),
        });
    }
}

/// Content hash of a rendered document, for the per-turn event-log record
/// (ADR-009: hash + fidelities persist; full text only on request — it
/// contains everything personal). Hand-rolled FNV-style, no crypto dependency:
/// the requirement is stable identity in a diffable log, not collision
/// resistance.
pub fn content_hash(messages: &[Message]) -> String {
    // FNV-1a 64 over the serde_json bytes of the messages.
    let bytes = serde_json::to_string(messages).expect("messages serialize");
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes.bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}
