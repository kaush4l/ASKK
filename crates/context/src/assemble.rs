//! §8.1 first stage + §8.5 budget degradation. Pure, deterministic, no I/O:
//! same state + phase + budget ⇒ the same document, bit for bit (I14).

use kernel::{PhaseId, SectionId};

use crate::degrade::{degrade, withhold_oversized, BINARY_SHARE_DIVISOR};
use crate::state::{SectionSource, State};
use crate::types::{Budget, CompactionReport, Document, Fidelity, Part, Section};

/// Rough token cost of a part list: bytes/4, floor 1 per part (Spike C).
/// Not a tokenizer; good enough to make a budget bind deterministically.
pub(crate) fn cost(parts: &[Part]) -> u32 {
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

/// The parts a section contributes at `fid`, derived from its FULL parts
/// (each level derives from the original, never from the previous level).
/// Summarized uses the provider's precomputed summary when present, else a
/// mechanical char-boundary-safe truncation (Spike C friction 3).
pub(crate) fn effective_parts(src: &SectionSource, fid: Fidelity) -> Vec<Part> {
    let s = &src.section;
    match fid {
        Fidelity::Full => s.parts.clone(),
        Fidelity::Summarized => match &src.summary {
            Some(parts) => parts.clone(),
            None => vec![Part::Text {
                text: mechanical_summary(s),
            }],
        },
        Fidelity::Pointer => vec![Part::Text {
            text: format!(
                "[section '{}': {} part(s) available; ask for them]",
                s.id.0,
                s.parts.len()
            ),
        }],
        Fidelity::Elided => Vec::new(),
    }
}

/// Leading text of the FULL parts, char-boundary safe, with a notice of what
/// was withheld — deterministic, no model in the loop (ADR-009).
fn mechanical_summary(s: &Section) -> String {
    const KEEP: usize = 200;
    let joined: String = s
        .parts
        .iter()
        .filter_map(|p| match p {
            Part::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ");
    let head: String = joined.chars().take(KEEP).collect();
    let non_text = s
        .parts
        .iter()
        .filter(|p| !matches!(p, Part::Text { .. }))
        .count();
    format!(
        "{head} ...[summarized; {non_text} non-text part(s) withheld; ask for full '{}']",
        s.id.0
    )
}

/// Every section, at the fidelity it starts from, ordered for the prompt.
///
/// A section starts at Full with its real (recomputed) cost — except one with
/// nothing to say, which starts Elided. A component that does not apply this
/// turn (no stage brief, no observations yet) vanishes rather than rendering
/// an empty heading: Elided is how the paper already spells "absent", and it
/// is the level at which empty IS the content, so the law holds without an
/// exception written for it.
///
/// Order is structural: the slot decides, and nothing else. The sort is
/// stable, so two components sharing a slot keep the order they were supplied
/// in — deliberately NOT tie-broken on `Section::priority`, which is the
/// budget rank. Letting a budget number reorder the prompt would be the same
/// category error the slot type was introduced to end.
///
/// An oversized binary part is withheld here, before any ladder runs: charged
/// at bytes/4 a screenshot outweighs the conversation the ladder would
/// otherwise shred to make room for it.
fn gather(
    state: &State,
    ceiling: u32,
    withheld: &mut Vec<SectionId>,
) -> Vec<(SectionSource, Fidelity, u32)> {
    let mut work: Vec<(SectionSource, Fidelity, u32)> = state
        .sources
        .iter()
        .map(|src| {
            let mut src = src.clone();
            withhold_oversized(&mut src, ceiling, withheld);
            let c = cost(&src.section.parts); // >= 1 per part: 0 means empty
            let start = match c {
                0 => Fidelity::Elided,
                _ => Fidelity::Full,
            };
            (src, start, c)
        })
        .collect();
    work.sort_by_key(|(src, _, _)| src.section.slot);
    work
}

/// Build the paper for one call — the frozen §8.1 signature: gather every
/// section at its starting fidelity in slot order, let the budget take what it
/// must (`degrade`), and emit the document with a receipt for both. Total, not
/// fallible: malformed sections are rejected at module install time (ADR-004).
/// Sections carry their EFFECTIVE parts at the chosen fidelity: the document
/// is what the model sees, never a full-fidelity intermediate (ADR-009 Option
/// C's lie).
pub fn assemble(state: &State, phase: PhaseId, budget: Budget) -> Document {
    let mut withheld: Vec<SectionId> = Vec::new();
    let ceiling = budget.max_tokens / BINARY_SHARE_DIVISOR;
    let mut work = gather(state, ceiling, &mut withheld);
    let steps = degrade(&mut work, budget);
    let spent = work.iter().map(|(_, _, c)| *c).sum();
    let sections = work
        .into_iter()
        .map(|(src, fid, c)| {
            let mut s = src.section.clone();
            s.parts = effective_parts(&src, fid);
            s.fidelity = fid;
            s.budget_hint = c;
            s
        })
        .collect();
    Document {
        phase,
        sections,
        report: CompactionReport {
            budget,
            spent,
            steps,
            withheld,
        },
    }
}
