//! §8.1 + §8.5: pure assembly and deterministic budget degradation.
//! `assemble` decides WHAT is said; `render` (render.rs) decides HOW.
//! Section content lives in sections.rs; this file owns order and budget.

use crate::sections::starter_sections;
use crate::state::State;
use crate::types::{cost, Budget, Degradation, Document, Phase};

/// Build the paper for one call. No I/O, deterministic: same state + phase +
/// budget always yields the same document (tested).
pub fn assemble(state: &State, phase: Phase, budget: Budget) -> Document {
    let mut sections = starter_sections(state, phase);
    // §8.3: most stable first. Vec::sort_by_key is stable, so the canonical
    // §8.2 build order is preserved WITHIN each stability class. This is the
    // line that makes provider-side prompt caching hit.
    sections.sort_by_key(|s| s.stability);
    let mut doc = Document {
        phase,
        budget,
        spent: 0,
        sections,
        degradations: Vec::new(),
    };
    degrade_to_budget(&mut doc);
    doc.spent = spent(&doc);
    doc
}

fn spent(doc: &Document) -> u32 {
    doc.sections.iter().map(|s| s.budget_hint).sum()
}

/// §8.5: when the budget binds, degrade Full -> Summarized -> Pointer ->
/// Elided, lowest priority first, fully exhausting one section before
/// touching the next-more-important one. Ties break toward the later
/// (more volatile) section. Every step is recorded on the document.
fn degrade_to_budget(doc: &mut Document) {
    let max = doc.budget.max_tokens;
    if spent(doc) <= max {
        return;
    }
    let mut order: Vec<usize> = (0..doc.sections.len()).collect();
    order.sort_by_key(|&i| (doc.sections[i].priority, std::cmp::Reverse(i)));
    for &i in &order {
        // A tiny section's Summarized form can cost MORE than Full (the
        // marker text). Still terminates and still reaches the budget: the
        // while loop just steps it on to Pointer/Elided. Do not "optimize"
        // by skipping steps — the recorded ladder is part of the contract.
        while spent(doc) > max {
            let s = &mut doc.sections[i];
            let Some(next) = s.compaction.next() else {
                break;
            };
            let from = s.compaction;
            s.compaction = next;
            s.budget_hint = cost(&s.effective_parts());
            doc.degradations.push(Degradation {
                section: s.id.clone(),
                from,
                to: next,
            });
        }
        if spent(doc) <= max {
            return;
        }
    }
    // Everything elided and still over budget: nothing left to cut. The
    // document records the outcome (spent > budget); the caller decides.
}
