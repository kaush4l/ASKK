//! §8.1 second stage: how THIS provider wants to hear the paper. Pure and
//! deterministic like `assemble`; the two never collapse (§8.1). Three
//! targets suffice per the multimodal research; provider quirks live only here.
//!
//! TWO LAWS MET HERE AND ONE HAD TO WIN. The compaction notice was appended
//! after EVERY section for a cache reason — a notice that changes each turn
//! must not sit in the stable prefix — and `Slot::RESPONSE` is pinned last
//! because the reply's shape is the instruction to hold while writing. Both
//! cannot be last, and the notice silently won: measured, ONE extra tool in
//! `public/agents/main/agent.md` ended the headings `…, "## compaction_notice"`.
//!
//! THE RESPONSE CONTRACT WINS, and the cache argument survives whole, because
//! `Slot::is_tail`'s own comment had already answered it — caching caches a
//! PREFIX, so once `environment` and `history` have changed nothing after them
//! was going to be cached wherever it sat. The notice always follows `history`,
//! so moving it before the tail costs no cache that was reachable. THE COST:
//! this stage now reads a STRUCTURAL property of the paper (`Section::slot`)
//! where it walked an opaque list — accepted, because emitting the notice as a
//! section would put a ladder-derived string into the very document the ladder
//! is deciding about, and that is a loop, not a component.

use serde::{Deserialize, Serialize};

use crate::types::{CompactionReport, Document, Fidelity, Part};

/// Provider wire formats `render` knows (RESEARCH multimodal: OpenAI-compat
/// intersection + the two majors). Capability flags ride the variant: not every
/// "OpenAI-compatible" endpoint accepts the same parts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderFormat {
    OpenAiChat { vision: bool, audio: bool },
    Anthropic,
    Gemini,
}

/// Message roles across all three targets. Closed: a fourth role is a provider
/// quirk to map here, not a concept the paper needs.
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
/// Document order becomes the cacheable prefix; every downgrade is visible.
pub fn render(doc: &Document, target: ProviderFormat) -> Vec<Message> {
    match target {
        ProviderFormat::OpenAiChat { vision, audio } => render_chat(doc, vision, audio),
        ProviderFormat::Anthropic | ProviderFormat::Gemini => todo!("G5: second provider"),
    }
}

/// One system message carrying the paper in document order (the assembled
/// text IS the cacheable prefix), then one fixed user message (Spike C).
fn render_chat(doc: &Document, vision: bool, audio: bool) -> Vec<Message> {
    let mut parts: Vec<ContentPart> = Vec::new();
    let mut text = String::new();
    for s in &doc.sections {
        // Before the tail, never after it (header). Ahead of the Elided skip
        // because `law::ends` guarantees exactly one tail, words or not.
        if s.slot.is_tail() {
            append_compaction_notice(&mut text, &doc.report);
        }
        if s.fidelity == Fidelity::Elided {
            continue;
        }
        text.push_str(&format!("## {}\n({})\n", s.id.0, s.intent));
        for p in &s.parts {
            place(&mut parts, &mut text, p, vision, audio);
        }
        text.push('\n');
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

/// What was compacted out of this document, emitted immediately BEFORE the
/// tail section and never after it — the header records why.
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
