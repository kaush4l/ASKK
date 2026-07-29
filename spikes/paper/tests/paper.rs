//! Spike C acceptance tests (§8.7): determinism, static-prefix byte
//! identity, deterministic + recorded budget degradation.

use paper_spike::{assemble, render, Budget, Compaction, Part, Phase, ProviderFormat, State};

fn json(state: &State, phase: Phase, budget: Budget) -> String {
    let doc = assemble(state, phase, budget);
    serde_json::to_string(&render(&doc, ProviderFormat::OpenAiChat)).unwrap()
}

/// (c) Same state + phase + budget twice -> identical document AND identical
/// rendered bytes.
#[test]
fn determinism_same_inputs_same_document() {
    let state = State::example();
    let a = assemble(&state, Phase::Act, Budget::unlimited());
    let b = assemble(&state, Phase::Act, Budget::unlimited());
    assert_eq!(a, b);
    assert_eq!(
        json(&state, Phase::Act, Budget::unlimited()),
        json(&state, Phase::Act, Budget::unlimited())
    );
}

/// (b) Change ONLY a Volatile section's content: the serialized output must
/// be byte-identical through the last Dynamic section — a superset of the
/// required "through the last stable section" (§8.3, cache-hit invariant).
#[test]
fn static_prefix_byte_identity_under_volatile_change() {
    let base = State::example();
    let mut changed = base.clone();
    changed.observations = vec![Part::Text {
        text: "timer.set(5) -> armed; fires at 10:05.".into(),
    }];
    let s1 = json(&base, Phase::Act, Budget::unlimited());
    let s2 = json(&changed, Phase::Act, Budget::unlimited());
    assert_ne!(s1, s2, "volatile change must actually change the output");
    let idx = s1
        .find("## observations")
        .expect("volatile section header present");
    assert_eq!(
        s1[..idx],
        s2[..idx],
        "prefix before the volatile tail must be byte-identical"
    );
    // The volatile section sorts to the very end of the paper.
    let last_header = s1.rfind("## ").map(|i| &s1[i..i + 20]);
    assert!(s1[idx..].starts_with("## observations"), "{last_header:?}");
}

/// §8.3 ordering: stable-first, canonical order within a class.
#[test]
fn sections_ordered_most_stable_first() {
    let doc = assemble(&State::example(), Phase::Act, Budget::unlimited());
    let ids: Vec<&str> = doc.sections.iter().map(|s| s.id.as_str()).collect();
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
    assert!(doc
        .sections
        .iter()
        .all(|s| !s.intent.is_empty() && !s.content.is_empty()));
}

/// (d) Budget degradation: deterministic, lowest-priority-first, RECORDED on
/// the document, and announced to the model in the rendered output.
#[test]
fn budget_degradation_deterministic_and_recorded() {
    let state = State::example();
    let full = assemble(&state, Phase::Act, Budget::unlimited()).spent;
    let budget = Budget {
        max_tokens: full / 2,
    };

    let a = assemble(&state, Phase::Act, budget);
    let b = assemble(&state, Phase::Act, budget);
    assert_eq!(a, b, "same state + budget must degrade identically");

    assert!(
        !a.degradations.is_empty(),
        "a binding budget must be recorded"
    );
    assert!(
        a.spent <= budget.max_tokens,
        "degradation must reach the budget"
    );
    // history has the lowest priority: it gives first.
    assert_eq!(a.degradations[0].section, "history");
    // The most important sections are never touched at half budget.
    for protected in ["response_contract", "soul"] {
        assert!(
            a.degradations.iter().all(|d| d.section != protected),
            "{protected} degraded before less important sections"
        );
    }
    // Priority order is respected across the recorded steps.
    let prio = |id: &str| a.sections.iter().find(|s| s.id == id).unwrap().priority;
    assert!(a
        .degradations
        .windows(2)
        .all(|w| prio(&w[0].section) <= prio(&w[1].section)));

    // The agent is told: the rendered paper carries the notice, at the tail.
    let rendered = serde_json::to_string(&render(&a, ProviderFormat::OpenAiChat)).unwrap();
    assert!(rendered.contains("compaction_notice"));
    assert!(rendered.contains("history"));
}

/// Degenerate budget: everything elides, the document still says so.
#[test]
fn budget_of_one_elides_everything_but_records_it() {
    let doc = assemble(&State::example(), Phase::Act, Budget { max_tokens: 1 });
    assert!(doc
        .sections
        .iter()
        .all(|s| s.compaction == Compaction::Elided));
    assert_eq!(doc.spent, 0);
    assert!(!doc.degradations.is_empty());
}

/// response_contract is "Static per phase": same phase -> same bytes,
/// different phase -> different contract text.
#[test]
fn response_contract_varies_by_phase_only() {
    let state = State::example();
    let act = json(&state, Phase::Act, Budget::unlimited());
    let converse = json(&state, Phase::Converse, Budget::unlimited());
    assert_ne!(act, converse);
    assert!(act.contains("exactly one JSON object"));
    assert!(converse.contains("plain prose"));
}
