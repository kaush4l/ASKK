//! Kanban work model (pure): a goal splits into ordered cards; agents push
//! cards through stages; work bounces between planning and testing until
//! every acceptance criterion on a card is met — only then may it enter
//! Done. This module is data + rules only; persistence lives in the runtime.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardStage {
    Backlog,
    Planning,
    Doing,
    Testing,
    Done,
}

impl CardStage {
    /// Column order, left to right.
    pub const ALL: [CardStage; 5] = [
        CardStage::Backlog,
        CardStage::Planning,
        CardStage::Doing,
        CardStage::Testing,
        CardStage::Done,
    ];

    pub fn name(self) -> &'static str {
        match self {
            CardStage::Backlog => "backlog",
            CardStage::Planning => "planning",
            CardStage::Doing => "doing",
            CardStage::Testing => "testing",
            CardStage::Done => "done",
        }
    }

    pub fn parse(s: &str) -> Option<CardStage> {
        let s = s.trim().to_ascii_lowercase();
        CardStage::ALL.into_iter().find(|st| st.name() == s)
    }
}

/// One acceptance criterion; a card is finishable only when all are met.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Criterion {
    pub text: String,
    #[serde(default)]
    pub met: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub criteria: Vec<Criterion>,
    pub stage: CardStage,
    /// Agent currently responsible ("" = unassigned).
    #[serde(default)]
    pub assignee: String,
    /// Board ordering; lower first.
    pub order: u64,
    /// Run currently working this card, if any.
    #[serde(default)]
    pub run_id: Option<String>,
    /// Free-form trail: verdicts, bounce reasons, steering notes.
    #[serde(default)]
    pub note: String,
}

impl Card {
    pub fn criteria_met(&self) -> bool {
        self.criteria.iter().all(|c| c.met)
    }

    /// The one hard rule: Done demands every criterion met. Every other
    /// move — including backward testing→planning bounces — is allowed.
    pub fn may_enter(&self, stage: CardStage) -> Result<(), String> {
        if stage == CardStage::Done && !self.criteria_met() {
            let open: Vec<&str> = self
                .criteria
                .iter()
                .filter(|c| !c.met)
                .map(|c| c.text.as_str())
                .collect();
            return Err(format!(
                "cannot enter done — unmet criteria: {}",
                open.join("; ")
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(criteria: Vec<Criterion>) -> Card {
        Card {
            id: "c".into(),
            title: "t".into(),
            goal: String::new(),
            criteria,
            stage: CardStage::Testing,
            assignee: String::new(),
            order: 1,
            run_id: None,
            note: String::new(),
        }
    }

    fn crit(text: &str, met: bool) -> Criterion {
        Criterion {
            text: text.into(),
            met,
        }
    }

    #[test]
    fn done_requires_every_criterion_met() {
        let c = card(vec![crit("a", true), crit("b", false)]);
        let err = c.may_enter(CardStage::Done).unwrap_err();
        assert!(err.contains("b"), "{err}");
        assert!(!err.contains("a;"), "{err}");
        let done = card(vec![crit("a", true), crit("b", true)]);
        assert!(done.may_enter(CardStage::Done).is_ok());
        // No criteria = nothing blocking.
        assert!(card(vec![]).may_enter(CardStage::Done).is_ok());
    }

    #[test]
    fn backward_moves_are_always_allowed() {
        let c = card(vec![crit("a", false)]);
        for stage in [CardStage::Backlog, CardStage::Planning, CardStage::Doing] {
            assert!(c.may_enter(stage).is_ok(), "{stage:?}");
        }
    }

    #[test]
    fn stage_names_round_trip() {
        for stage in CardStage::ALL {
            assert_eq!(CardStage::parse(stage.name()), Some(stage));
        }
        assert_eq!(CardStage::parse(" Testing "), Some(CardStage::Testing));
        assert_eq!(CardStage::parse("nope"), None);
    }

    #[test]
    fn card_serde_round_trips_and_defaults() {
        let json = r#"{"id":"x","title":"T","stage":"doing","order":3}"#;
        let c: Card = serde_json::from_str(json).unwrap();
        assert_eq!(c.stage, CardStage::Doing);
        assert!(c.criteria.is_empty() && c.run_id.is_none());
        let back: Card = serde_json::from_str(&serde_json::to_string(&c).unwrap()).unwrap();
        assert_eq!(back, c);
    }
}
