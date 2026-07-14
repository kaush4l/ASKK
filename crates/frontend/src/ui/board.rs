//! Board stage: the persistent kanban board, five columns in `CardStage::ALL`
//! order. Pure data component (askk-core types only, ADR-013); `app.rs`
//! re-reads the snapshot through the host facade on every refold, so tool
//! mutations (board_add/move/check) appear live.

use dioxus::prelude::*;

use askk_core::{Card, CardStage};

/// Criteria progress: (met, total).
fn progress(card: &Card) -> (usize, usize) {
    (
        card.criteria.iter().filter(|c| c.met).count(),
        card.criteria.len(),
    )
}

/// The run chip shows only while work is actively on the card
/// (doing/testing); elsewhere the note trail is the interesting footer.
fn show_run(card: &Card) -> bool {
    card.run_id.is_some() && matches!(card.stage, CardStage::Doing | CardStage::Testing)
}

#[component]
pub fn BoardStage(cards: Vec<Card>) -> Element {
    rsx! {
        div { class: "board-wrap",
            div { class: "settings-title", "Board" }
            if cards.is_empty() {
                p { class: "hint",
                    "the orchestrator fills this board — try: \"plan and build X\" in Chat."
                }
            }
            div { class: "board",
                for stage in CardStage::ALL {
                    div { key: "{stage.name()}", class: "board-col",
                        div { class: "col-head",
                            span { class: "col-name", "{stage.name()}" }
                            span { class: "col-count",
                                "{cards.iter().filter(|c| c.stage == stage).count()}"
                            }
                        }
                        for card in cards.iter().filter(|c| c.stage == stage) {
                            {
                                let (met, total) = progress(card);
                                rsx! {
                                    div { key: "{card.id}", class: "board-card",
                                        div { class: "card-title", "{card.title}" }
                                        div { class: "card-meta",
                                            if !card.assignee.is_empty() {
                                                span { class: "meta-tag", "{card.assignee}" }
                                            }
                                            if total > 0 {
                                                span { class: "card-ticks",
                                                    for (i, c) in card.criteria.iter().enumerate() {
                                                        span {
                                                            key: "{i}",
                                                            class: if c.met { "tick met" } else { "tick" },
                                                            title: "{c.text}",
                                                            if c.met { "✓" } else { "○" }
                                                        }
                                                    }
                                                    span { class: "tick-count", "{met}/{total}" }
                                                }
                                            }
                                        }
                                        if show_run(card) {
                                            if let Some(run) = card.run_id.as_ref() {
                                                div { class: "card-run", "run {run}" }
                                            }
                                        }
                                        if !card.note.is_empty() {
                                            div { class: "card-note", "{card.note}" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::Criterion;

    fn card(stage: CardStage, run: Option<&str>) -> Card {
        Card {
            id: "c".into(),
            title: "t".into(),
            goal: String::new(),
            criteria: vec![
                Criterion {
                    text: "a".into(),
                    met: true,
                },
                Criterion {
                    text: "b".into(),
                    met: false,
                },
            ],
            stage,
            assignee: String::new(),
            order: 1,
            run_id: run.map(String::from),
            note: String::new(),
        }
    }

    #[test]
    fn progress_counts_met_over_total() {
        assert_eq!(progress(&card(CardStage::Testing, None)), (1, 2));
    }

    #[test]
    fn run_chip_only_while_work_is_active() {
        assert!(show_run(&card(CardStage::Doing, Some("r1"))));
        assert!(show_run(&card(CardStage::Testing, Some("r1"))));
        assert!(!show_run(&card(CardStage::Backlog, Some("r1"))));
        assert!(!show_run(&card(CardStage::Doing, None)));
    }
}
