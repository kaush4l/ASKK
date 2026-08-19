//! What a budget does to a document when it bites: withhold the binary parts
//! it cannot afford, then walk sections down the fidelity ladder until the
//! arithmetic closes. Deciding WHAT the paper says (`assemble`) and deciding
//! what a ceiling takes away from it are two jobs with two failure modes —
//! one is about order and provenance, this one is about arithmetic — so the
//! second reads and tests on its own terms rather than as a loop buried in
//! the first. Every reduction here is recorded; none is silent (I15).

use kernel::SectionId;

use crate::assemble::{cost, effective_parts};
use crate::state::SectionSource;
use crate::types::{Budget, CompactionStep, Fidelity, Part};

/// The largest share of the budget one binary part may claim: a quarter, so
/// three quarters always remain for the words. A divisor, not a fixed size:
/// "too big" is only ever a claim about the budget in hand (unlimited ⇒ never).
pub(crate) const BINARY_SHARE_DIVISOR: u32 = 4;

/// Replace every binary part costing more than `ceiling` with a typed text
/// placeholder naming the media type and its cost — `render`'s vocabulary for
/// a part a target cannot hear. Names the section in `withheld`, a PART-level
/// record kept out of `steps` because the section's own fidelity did not move
/// (I8: no false receipts). The swap is 1:1, so nothing empties.
pub(crate) fn withhold_oversized(
    src: &mut SectionSource,
    ceiling: u32,
    withheld: &mut Vec<SectionId>,
) {
    let mut hit = false;
    let summary = src.summary.iter_mut().flatten(); // a curated summary too
    for p in src.section.parts.iter_mut().chain(summary) {
        let c = cost(std::slice::from_ref(p));
        let what = match p {
            _ if c <= ceiling => continue,
            Part::Image { media_type, .. } => format!("image ({media_type})"),
            Part::Audio { media_type, .. } => format!("audio ({media_type})"),
            Part::File { media_type, .. } => format!("file ({media_type})"),
            _ => continue, // text and fragments: not what breaks a budget
        };
        *p = Part::Text {
            text: format!("[{what} withheld: ~{c} tokens over the {ceiling}-token part ceiling]"),
        };
        hit = true;
    }
    if hit {
        withheld.push(src.section.id.clone());
    }
}

/// The ADR-009 ladder: while over budget, step the highest priority number
/// not yet at its floor down ONE level (lower number survives longer, ties to
/// the later section), recomputing its cost from the ORIGINAL parts each time.
/// Stops when the budget is met or everything sits at its floor — the honest
/// overshoot is then visible in the report rather than forced away.
pub(crate) fn degrade(
    work: &mut [(SectionSource, Fidelity, u32)],
    budget: Budget,
) -> Vec<CompactionStep> {
    let mut steps: Vec<CompactionStep> = Vec::new();
    loop {
        let spent: u32 = work.iter().map(|(_, _, c)| *c).sum();
        if spent <= budget.max_tokens {
            return steps;
        }
        let candidate = work
            .iter()
            .enumerate()
            .filter(|(_, (src, fid, _))| *fid < src.section.floor)
            .max_by_key(|(i, (src, _, _))| (src.section.priority, *i))
            .map(|(i, _)| i);
        let Some(i) = candidate else {
            return steps; // everything at floor and still over: recorded above
        };
        let (src, fid, c) = &mut work[i];
        let from = *fid;
        *fid = fid.next().expect("below floor implies a next level");
        *c = cost(&effective_parts(src, *fid));
        steps.push(CompactionStep {
            section: src.section.id.clone(),
            from,
            to: *fid,
        });
    }
}
