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
    match target {
        ProviderFormat::OpenAiChat { vision, audio } => render_chat(doc, vision, audio),
        ProviderFormat::Anthropic | ProviderFormat::Gemini => todo!("G5: second provider"),
    }
}

/// One system message carrying the paper in document order (the assembled
/// text IS the cacheable prefix), then one fixed user message. The
/// compaction notice renders LAST so it never invalidates the stable prefix.
/// Ported from Spike C; non-text parts the target can't hear become typed
/// placeholder text — visible, never silently dropped (I15).
fn render_chat(doc: &Document, vision: bool, audio: bool) -> Vec<Message> {
    use crate::types::{Fidelity, Part};
    let mut parts: Vec<ContentPart> = Vec::new();
    let mut text = String::new();
    for s in &doc.sections {
        if s.fidelity == Fidelity::Elided {
            continue;
        }
        text.push_str(&format!("## {}\n({})\n", s.id.0, s.intent));
        for p in &s.parts {
            match p {
                Part::Text { text: t } => {
                    text.push_str(t);
                    text.push('\n');
                }
                Part::Fragment { id, html } => {
                    text.push_str(&format!("<fragment id=\"{id}\">\n{html}\n</fragment>\n"));
                }
                Part::Image {
                    media_type,
                    data_base64,
                } if vision => {
                    flush_text(&mut parts, &mut text);
                    parts.push(ContentPart::Image {
                        media_type: media_type.clone(),
                        data_base64: data_base64.clone(),
                    });
                }
                Part::Audio {
                    media_type,
                    data_base64,
                } if audio => {
                    flush_text(&mut parts, &mut text);
                    parts.push(ContentPart::Audio {
                        media_type: media_type.clone(),
                        data_base64: data_base64.clone(),
                    });
                }
                Part::File {
                    name,
                    media_type,
                    data_base64,
                } if vision => {
                    flush_text(&mut parts, &mut text);
                    parts.push(ContentPart::File {
                        name: name.clone(),
                        media_type: media_type.clone(),
                        data_base64: data_base64.clone(),
                    });
                }
                // Typed placeholders for parts this target cannot hear.
                Part::Image { media_type, .. } => {
                    text.push_str(&format!(
                        "[image ({media_type}) withheld: text-only target]\n"
                    ));
                }
                Part::Audio { media_type, .. } => {
                    text.push_str(&format!(
                        "[audio ({media_type}) withheld: text-only target]\n"
                    ));
                }
                Part::File {
                    name, media_type, ..
                } => {
                    text.push_str(&format!(
                        "[file '{name}' ({media_type}) withheld: text-only target]\n"
                    ));
                }
            }
        }
        text.push('\n');
    }
    if !doc.report.steps.is_empty() || !doc.report.withheld.is_empty() {
        text.push_str("## compaction_notice\n");
        text.push_str("(what was compacted out of this document; ask to restore)\n");
        for d in &doc.report.steps {
            text.push_str(&format!("- {}: {:?} -> {:?}\n", d.section.0, d.from, d.to));
        }
        for id in &doc.report.withheld {
            text.push_str(&format!("- {}: a binary part was withheld\n", id.0));
        }
    }
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

/// Close out the running text buffer as one text part, so non-text parts
/// keep their in-document position.
fn flush_text(parts: &mut Vec<ContentPart>, text: &mut String) {
    if !text.is_empty() {
        parts.push(ContentPart::Text {
            text: std::mem::take(text),
        });
    }
}

/// Content hash of a rendered document, for the per-turn event-log record
/// (ADR-009: hash + fidelities persist; full text only on request — it
/// contains everything personal). PROVISIONAL: hand-rolled FNV-style hash,
/// no crypto dependency — collision resistance is not the requirement,
/// stable identity in `git diff`-able logs is.
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
