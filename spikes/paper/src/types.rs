//! Paper types (§8.2): every section declares itself; the document records
//! what happened to it under budget. No I/O anywhere in this crate's core.

/// Content parts — multimodal from day one (§8.6). A `String` pipeline here
/// would be the rewrite §8.1 warns about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Part {
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
    /// An htmx fragment rendered into the paper (§8.4 — one composition
    /// mechanism, two renderers).
    Fragment {
        id: String,
        html: String,
    },
}

/// §8.3 — sort key for stable-first ordering. Declaration order IS the sort
/// order (derived `Ord`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Stability {
    Static,
    SemiStatic,
    Dynamic,
    Volatile,
}

/// §8.5 — current compaction level. Assembly starts every section at `Full`;
/// degradation steps it down and records each step on the document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compaction {
    Full,
    Summarized,
    Pointer,
    Elided,
}

impl Compaction {
    /// One degradation step; `None` when there is nothing left to give up.
    pub fn next(self) -> Option<Compaction> {
        match self {
            Compaction::Full => Some(Compaction::Summarized),
            Compaction::Summarized => Some(Compaction::Pointer),
            Compaction::Pointer => Some(Compaction::Elided),
            Compaction::Elided => None,
        }
    }
}

/// §8.7 — what produced this content, and when. `at` is injected state (the
/// clock is data, never `SystemTime::now()` — that would break determinism).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provenance {
    pub module: String,
    pub at: String,
}

/// One declared section of the paper (§8.2). `intent` is mandatory and
/// enforced at assembly: a section that cannot say what it is for is a bug.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub id: String,
    pub intent: String,
    pub stability: Stability,
    /// Higher survives longer when the budget bites.
    pub priority: u8,
    pub compaction: Compaction,
    /// Estimated token cost of the section at its CURRENT compaction level.
    pub budget_hint: u32,
    pub provenance: Provenance,
    pub content: Vec<Part>,
}

impl Section {
    /// The parts this section actually contributes at its current compaction
    /// level. Shared by cost estimation and rendering so they can never
    /// disagree. Deterministic: mechanical truncation, no model in the loop.
    pub fn effective_parts(&self) -> Vec<Part> {
        match self.compaction {
            Compaction::Full => self.content.clone(),
            Compaction::Summarized => vec![Part::Text {
                text: self.summarize(),
            }],
            Compaction::Pointer => vec![Part::Text {
                text: format!(
                    "[section '{}': {} part(s) available; ask for them]",
                    self.id,
                    self.content.len()
                ),
            }],
            Compaction::Elided => Vec::new(),
        }
    }

    /// Mechanical summary: leading text, char-boundary safe. A real summary
    /// needs a precomputed artifact — noted for ADR-009.
    fn summarize(&self) -> String {
        const KEEP: usize = 200;
        let joined: String = self
            .content
            .iter()
            .filter_map(|p| match p {
                Part::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        let head: String = joined.chars().take(KEEP).collect();
        let non_text = self
            .content
            .iter()
            .filter(|p| !matches!(p, Part::Text { .. }))
            .count();
        format!(
            "{head} ...[summarized; {non_text} non-text part(s) withheld; ask for full '{}']",
            self.id
        )
    }
}

/// Rough token cost of a part list: bytes/4, floor 1 per part. Good enough
/// to make a budget bind deterministically; not a tokenizer.
pub fn cost(parts: &[Part]) -> u32 {
    parts
        .iter()
        .map(|p| {
            let bytes = match p {
                Part::Text { text } => text.len(),
                Part::Image { data_base64, .. } | Part::Audio { data_base64, .. } => {
                    data_base64.len()
                }
                Part::File { data_base64, .. } => data_base64.len(),
                Part::Fragment { html, .. } => html.len(),
            };
            (bytes / 4).max(1) as u32
        })
        .sum()
}

/// Token budget for one assembly. `unlimited()` for golden snapshots.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub max_tokens: u32,
}

impl Budget {
    pub fn unlimited() -> Budget {
        Budget {
            max_tokens: u32::MAX,
        }
    }
}

/// The phase being assembled for (§9). Only the `response_contract` section
/// varies with it — "Static per phase".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Converse,
    Act,
}

/// One recorded degradation step (§8.5 — "the agent is told").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Degradation {
    pub section: String,
    pub from: Compaction,
    pub to: Compaction,
}

/// The assembled paper: sections in stable-first order plus the budget
/// outcome. This is what `render` consumes and what the event log persists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
    pub phase: Phase,
    pub budget: Budget,
    /// Estimated spend after degradation.
    pub spent: u32,
    pub sections: Vec<Section>,
    pub degradations: Vec<Degradation>,
}
