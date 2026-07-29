//! §8.1 second stage: how THIS provider wants to hear the paper.
//! One target for the spike: OpenAI-compatible chat messages.

use serde::Serialize;

use crate::types::{Compaction, Document, Part};

/// Provider wire formats `render` knows about. One implementer today; a
/// second (Anthropic) is the G1 test that the seam holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderFormat {
    OpenAiChat,
}

/// One chat message in OpenAI's shape. Content is always the array form so
/// multimodal parts need no special casing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Message {
    pub role: String,
    pub content: Vec<ContentPart>,
}

/// OpenAI content-part union (text / image_url / input_audio / file).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text { text: String },
    ImageUrl { image_url: ImageUrl },
    InputAudio { input_audio: InputAudio },
    File { file: FileData },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImageUrl {
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InputAudio {
    pub data: String,
    /// e.g. "wav" — derived from the part's media type.
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileData {
    pub filename: String,
    pub file_data: String,
}

/// Render the assembled paper for one provider. Pure and deterministic, like
/// `assemble`; the two never collapse into one step (§8.1).
pub fn render(doc: &Document, target: ProviderFormat) -> Vec<Message> {
    match target {
        ProviderFormat::OpenAiChat => render_openai(doc),
    }
}

/// One system message carrying the paper in document order (the assembled
/// string IS the cacheable prefix), then one fixed user message. The
/// compaction notice renders LAST so it never invalidates the stable prefix.
fn render_openai(doc: &Document) -> Vec<Message> {
    let mut parts: Vec<ContentPart> = Vec::new();
    let mut text = String::new();
    for s in &doc.sections {
        if s.compaction == Compaction::Elided {
            continue;
        }
        text.push_str(&format!("## {}\n({})\n", s.id, s.intent));
        for p in s.effective_parts() {
            push_part(&mut parts, &mut text, p);
        }
        text.push('\n');
    }
    if !doc.degradations.is_empty() {
        text.push_str(
            "## compaction_notice\n(what was compacted out of this document; ask to restore)\n",
        );
        for d in &doc.degradations {
            text.push_str(&format!("- {}: {:?} -> {:?}\n", d.section, d.from, d.to));
        }
    }
    flush_text(&mut parts, &mut text);
    vec![
        Message {
            role: "system".into(),
            content: parts,
        },
        Message {
            role: "user".into(),
            content: vec![ContentPart::Text {
                text: "Proceed as the response_contract instructs.".into(),
            }],
        },
    ]
}

fn push_part(parts: &mut Vec<ContentPart>, text: &mut String, p: Part) {
    match p {
        Part::Text { text: t } => {
            text.push_str(&t);
            text.push('\n');
        }
        Part::Fragment { id, html } => {
            text.push_str(&format!("<fragment id=\"{id}\">\n{html}\n</fragment>\n"));
        }
        Part::Image {
            media_type,
            data_base64,
        } => {
            flush_text(parts, text);
            parts.push(ContentPart::ImageUrl {
                image_url: ImageUrl {
                    url: format!("data:{media_type};base64,{data_base64}"),
                },
            });
        }
        Part::Audio {
            media_type,
            data_base64,
        } => {
            flush_text(parts, text);
            let format = media_type
                .split('/')
                .next_back()
                .unwrap_or("wav")
                .to_string();
            parts.push(ContentPart::InputAudio {
                input_audio: InputAudio {
                    data: data_base64,
                    format,
                },
            });
        }
        Part::File {
            name,
            media_type,
            data_base64,
        } => {
            flush_text(parts, text);
            parts.push(ContentPart::File {
                file: FileData {
                    filename: name,
                    file_data: format!("data:{media_type};base64,{data_base64}"),
                },
            });
        }
    }
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
