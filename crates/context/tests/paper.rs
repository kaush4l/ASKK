//! The context test contract (MODULES/context.md): determinism, prefix
//! byte-identity, deterministic recorded floor-respecting degradation,
//! validate law coverage, and the committed golden on rendered output.

mod fixture;

use context::{
    assemble, content_hash, render, validate, Budget, ContextError, Fidelity, Part, ProviderFormat,
    Stability,
};
use kernel::PhaseId;

const FMT: ProviderFormat = ProviderFormat::OpenAiChat {
    vision: true,
    audio: true,
};

fn json(state: &context::State, budget: Budget) -> String {
    serde_json::to_string(&render(&assemble(state, PhaseId::Work, budget), FMT)).unwrap()
}

/// (1) Same inputs ⇒ bit-identical Document and rendered bytes.
#[test]
fn determinism_same_inputs_same_document() {
    let state = fixture::example();
    let a = assemble(&state, PhaseId::Work, Budget::unlimited());
    let b = assemble(&state, PhaseId::Work, Budget::unlimited());
    assert_eq!(a, b);
    assert_eq!(
        json(&state, Budget::unlimited()),
        json(&state, Budget::unlimited())
    );
    validate(&a).unwrap();
}

/// (2) Volatile mutation leaves the prefix byte-identical (§8.3 cache hit).
#[test]
fn static_prefix_byte_identity_under_volatile_change() {
    let base = fixture::example();
    let mut changed = base.clone();
    changed.sources.last_mut().unwrap().section.parts = vec![Part::Text {
        text: "timer.set(5) -> armed; fires at 10:05.".into(),
    }];
    assert_eq!(
        changed.sources.last().unwrap().section.stability,
        Stability::Volatile
    );
    let s1 = json(&base, Budget::unlimited());
    let s2 = json(&changed, Budget::unlimited());
    assert_ne!(s1, s2, "volatile change must actually change the output");
    let idx = s1.find("## observations").expect("volatile header present");
    assert_eq!(s1[..idx], s2[..idx], "prefix must be byte-identical");
}

/// (3) Degradation ladder: deterministic, recorded, floor-respecting,
/// highest-priority-number-first (lower number survives longer, ADR-009).
#[test]
fn budget_degradation_deterministic_recorded_floored() {
    let state = fixture::example();
    let full = assemble(&state, PhaseId::Work, Budget::unlimited())
        .report
        .spent;
    // A budget one token short of full: degrading history alone must cover it.
    let budget = Budget {
        max_tokens: full - 1,
    };
    let a = assemble(&state, PhaseId::Work, budget);
    let b = assemble(&state, PhaseId::Work, budget);
    assert_eq!(a, b, "same state + budget must degrade identically");
    assert!(!a.report.steps.is_empty(), "a binding budget is recorded");
    assert!(a.report.spent <= budget.max_tokens, "budget reached");
    // history has the highest priority number: it gives first, and a gentle
    // budget never touches anything else.
    assert!(a.report.steps.iter().all(|d| d.section.0 == "history"));
    // No section below its floor; the report is rendered to the model.
    validate(&a).unwrap();
    let rendered = serde_json::to_string(&render(&a, FMT)).unwrap();
    assert!(rendered.contains("compaction_notice"));
}

/// Degenerate budget: floors hold even when the budget cannot be reached,
/// and the document records the honest overshoot.
#[test]
fn budget_of_one_respects_floors_and_records() {
    let state = fixture::example();
    let doc = assemble(&state, PhaseId::Work, Budget { max_tokens: 1 });
    validate(&doc).unwrap();
    let contract = doc
        .sections
        .iter()
        .find(|s| s.id.0 == "response_contract")
        .unwrap();
    assert_eq!(
        contract.fidelity,
        Fidelity::Full,
        "floor Full never degrades"
    );
    assert!(doc.report.spent > 1, "overshoot is recorded, not hidden");
}

/// (4) validate rejects each law violation.
#[test]
fn validate_rejects_law_violations() {
    let state = fixture::example();
    let good = assemble(&state, PhaseId::Work, Budget::unlimited());

    let mut empty_intent = good.clone();
    empty_intent.sections[0].intent = "  ".into();
    assert!(matches!(
        validate(&empty_intent),
        Err(ContextError::EmptyIntent { .. })
    ));

    let mut empty_section = good.clone();
    empty_section.sections[0].parts.clear();
    assert!(matches!(
        validate(&empty_section),
        Err(ContextError::EmptySection { .. })
    ));

    let mut interleaved = good.clone();
    interleaved.sections.swap(0, 10); // Volatile before Static
    assert!(matches!(
        validate(&interleaved),
        Err(ContextError::InterleavedStability { .. })
    ));

    let mut below_floor = good.clone();
    below_floor.sections[0].fidelity = Fidelity::Elided; // soul floors at Summarized
    below_floor.sections[0].parts.clear();
    assert!(matches!(
        validate(&below_floor),
        Err(ContextError::BelowFloor { .. })
    ));

    let mut duplicate = good.clone();
    duplicate.sections[1] = duplicate.sections[0].clone();
    assert!(matches!(
        validate(&duplicate),
        Err(ContextError::DuplicateSection { .. })
    ));
}

/// Ordering: stable-first, canonical §8.2 order within each class.
#[test]
fn sections_ordered_most_stable_first() {
    let doc = assemble(&fixture::example(), PhaseId::Work, Budget::unlimited());
    let ids: Vec<&str> = doc.sections.iter().map(|s| s.id.0.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "soul",
            "identity",
            "operating_rules",
            "response_contract",
            "affordances",
            "user",
            "memory",
            "environment",
            "task",
            "history",
            "observations",
        ]
    );
    assert!(doc
        .sections
        .windows(2)
        .all(|w| w[0].stability <= w[1].stability));
}

/// (5) Golden: the rendered paper, byte for byte. A prompt regression is a
/// `git diff`, not archaeology. Regenerate with UPDATE_GOLDEN=1.
#[test]
fn golden_openai_chat_byte_for_byte() {
    let doc = assemble(&fixture::example(), PhaseId::Work, Budget::unlimited());
    let got = serde_json::to_string_pretty(&render(&doc, FMT)).unwrap();
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/openai_chat.json");
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(path, &got).unwrap();
        return;
    }
    let want = std::fs::read_to_string(path)
        .expect("golden snapshot missing; run once with UPDATE_GOLDEN=1");
    assert_eq!(got, want, "rendered paper diverged from committed golden");
}

/// content_hash: stable across runs, sensitive to content.
#[test]
fn content_hash_is_stable_and_sensitive() {
    let state = fixture::example();
    let m1 = render(&assemble(&state, PhaseId::Work, Budget::unlimited()), FMT);
    let h1 = content_hash(&m1);
    assert_eq!(h1, content_hash(&m1));
    let mut changed = state.clone();
    changed.sources.last_mut().unwrap().section.parts = vec![Part::Text { text: "x".into() }];
    let m2 = render(&assemble(&changed, PhaseId::Work, Budget::unlimited()), FMT);
    assert_ne!(h1, content_hash(&m2));
}
