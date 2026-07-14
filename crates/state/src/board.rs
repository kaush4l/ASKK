//! `BoardStore`: the persistent kanban board over a [`KvStore`] (OPFS in
//! the browser, memory on host). One key per card: `board/<id>`; cards are
//! plain `askk_core::Card` JSON.
//!
//! [`BoardStore::digest`] is the reorientation summary agents re-read
//! between turns. Writers: the board tools (`tools/board.rs`). Readers: the
//! board UI (`web/src/ui/board.rs`), the dashboard wall
//! (`web/src/ui/dashboard.rs`), and the latest-state artifact refresh
//! (`run/live.rs`). Board writes are config-shaped (plain `Result`s, no
//! signals) — the mutating *tools* that drive them already emit
//! ToolRequested/ToolCompleted, which is what the UI refolds on.

use std::rc::Rc;

use askk_core::{Card, CardStage};

use super::store::{KvStore, StoreError};

const PREFIX: &str = "board/";

/// Digest line cap: counts line + card lines + a possible elision marker.
const DIGEST_MAX_LINES: usize = 15;

pub struct BoardStore {
    kv: Rc<dyn KvStore>,
}

impl BoardStore {
    pub fn new(kv: Rc<dyn KvStore>) -> Self {
        Self { kv }
    }

    pub async fn get(&self, id: &str) -> Result<Option<Card>, StoreError> {
        match self.kv.get(&key(id)).await? {
            Some(v) => Ok(serde_json::from_value(v).ok()),
            None => Ok(None),
        }
    }

    pub async fn put(&self, card: &Card) -> Result<(), StoreError> {
        let v =
            serde_json::to_value(card).map_err(|e| StoreError::new(format!("card encode: {e}")))?;
        self.kv.set(&key(&card.id), v).await
    }

    pub async fn remove(&self, id: &str) -> Result<(), StoreError> {
        self.kv.remove(&key(id)).await
    }

    /// Every card, board order (order asc, id tiebreak).
    pub async fn list(&self) -> Result<Vec<Card>, StoreError> {
        let mut cards = Vec::new();
        for k in self.kv.list_prefix(PREFIX).await? {
            if let Some(v) = self.kv.get(&k).await? {
                if let Ok(card) = serde_json::from_value::<Card>(v) {
                    cards.push(card);
                }
            }
        }
        cards.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        Ok(cards)
    }

    /// Creates a card at the back of the given stage. Id = slug of the
    /// title, suffixed -2, -3… on collision.
    pub async fn add(
        &self,
        title: &str,
        goal: &str,
        criteria: Vec<String>,
        stage: CardStage,
    ) -> Result<Card, StoreError> {
        let existing = self.list().await?;
        let base = slug(title);
        let mut id = base.clone();
        let mut n = 1u32;
        while existing.iter().any(|c| c.id == id) {
            n += 1;
            id = format!("{base}-{n}");
        }
        let order = existing.iter().map(|c| c.order).max().unwrap_or(0) + 1;
        let card = Card {
            id,
            title: title.trim().to_string(),
            goal: goal.trim().to_string(),
            criteria: criteria
                .into_iter()
                .map(|text| askk_core::Criterion { text, met: false })
                .collect(),
            stage,
            assignee: String::new(),
            order,
            run_id: None,
            note: String::new(),
        };
        self.put(&card).await?;
        Ok(card)
    }

    /// Reorientation digest of the whole board; `None` when the board is
    /// empty or the store is sick (a broken board must never block a run).
    pub async fn digest(&self) -> Option<String> {
        digest_cards(&self.list().await.ok()?)
    }
}

/// Compact reorientation block: one line of per-stage counts, then the
/// in-flight (doing/testing) cards with their unmet criteria, capped at
/// `DIGEST_MAX_LINES` with an elision marker. Empty board → `None`.
fn digest_cards(cards: &[Card]) -> Option<String> {
    if cards.is_empty() {
        return None;
    }
    let counts = CardStage::ALL
        .iter()
        .map(|s| {
            let n = cards.iter().filter(|c| c.stage == *s).count();
            format!("{} {n}", s.name())
        })
        .collect::<Vec<_>>()
        .join(" · ");
    let mut lines = vec![counts];
    let in_flight: Vec<&Card> = cards
        .iter()
        .filter(|c| matches!(c.stage, CardStage::Doing | CardStage::Testing))
        .collect();
    let room = DIGEST_MAX_LINES - 1; // the counts line is spent
    let shown = if in_flight.len() > room {
        room.saturating_sub(1) // leave a line for the elision marker
    } else {
        in_flight.len()
    };
    for card in &in_flight[..shown] {
        let unmet: Vec<&str> = card
            .criteria
            .iter()
            .filter(|c| !c.met)
            .map(|c| c.text.as_str())
            .collect();
        lines.push(if unmet.is_empty() {
            format!("- [{}] {}", card.stage.name(), card.title)
        } else {
            format!(
                "- [{}] {} — unmet: {}",
                card.stage.name(),
                card.title,
                unmet.join("; ")
            )
        });
    }
    if in_flight.len() > shown {
        lines.push(format!("… {} more in flight", in_flight.len() - shown));
    }
    Some(lines.join("\n"))
}

fn key(id: &str) -> String {
    format!("{PREFIX}{id}")
}

fn slug(title: &str) -> String {
    let s: String = title
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>();
    if s.is_empty() {
        "card".to_string()
    } else {
        s.join("-")
    }
}

#[cfg(test)]
mod tests {
    use super::super::block_on;
    use super::super::store::MemKv;
    use super::*;

    fn store() -> BoardStore {
        BoardStore::new(Rc::new(MemKv::new()))
    }

    #[test]
    fn add_slugs_orders_and_dedupes_ids() {
        block_on(async {
            let s = store();
            let a = s
                .add(
                    "Ship it!",
                    "goal a",
                    vec!["works".into()],
                    CardStage::Backlog,
                )
                .await
                .unwrap();
            let b = s
                .add("Ship it", "goal b", vec![], CardStage::Planning)
                .await
                .unwrap();
            assert_eq!(a.id, "ship-it");
            assert_eq!(b.id, "ship-it-2");
            assert!(a.order < b.order);
            let all = s.list().await.unwrap();
            assert_eq!(
                all.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
                vec!["ship-it", "ship-it-2"]
            );
            assert!(!all[0].criteria[0].met);
        });
    }

    #[test]
    fn put_get_remove_round_trip() {
        block_on(async {
            let s = store();
            let mut card = s.add("A", "", vec![], CardStage::Doing).await.unwrap();
            card.stage = CardStage::Testing;
            card.note = "bounced once".into();
            s.put(&card).await.unwrap();
            let back = s.get(&card.id).await.unwrap().unwrap();
            assert_eq!(back.stage, CardStage::Testing);
            assert_eq!(back.note, "bounced once");
            s.remove(&card.id).await.unwrap();
            assert!(s.get(&card.id).await.unwrap().is_none());
        });
    }

    #[test]
    fn digest_empty_board_is_none() {
        block_on(async {
            assert_eq!(store().digest().await, None);
            assert_eq!(digest_cards(&[]), None);
        });
    }

    #[test]
    fn digest_counts_stages_and_lists_unmet_criteria() {
        block_on(async {
            let s = store();
            s.add("Backlog item", "", vec![], CardStage::Backlog)
                .await
                .unwrap();
            let mut auth = s
                .add(
                    "auth module",
                    "",
                    vec!["tests green".into(), "reviewed".into()],
                    CardStage::Doing,
                )
                .await
                .unwrap();
            auth.criteria[1].met = true;
            s.put(&auth).await.unwrap();
            s.add("clean card", "", vec![], CardStage::Testing)
                .await
                .unwrap();
            let d = s.digest().await.unwrap();
            let lines: Vec<&str> = d.lines().collect();
            assert_eq!(
                lines[0],
                "backlog 1 · planning 0 · doing 1 · testing 1 · done 0"
            );
            assert_eq!(lines[1], "- [doing] auth module — unmet: tests green");
            // Met criteria never appear; a criteria-free card has no suffix.
            assert!(!d.contains("reviewed"));
            assert_eq!(lines[2], "- [testing] clean card");
            assert_eq!(lines.len(), 3);
        });
    }

    #[test]
    fn digest_caps_lines_with_an_elision_marker() {
        let cards: Vec<Card> = (0..20)
            .map(|i| Card {
                id: format!("c{i}"),
                title: format!("card {i}"),
                goal: String::new(),
                criteria: vec![],
                stage: CardStage::Doing,
                assignee: String::new(),
                order: i,
                run_id: None,
                note: String::new(),
            })
            .collect();
        let d = digest_cards(&cards).unwrap();
        let lines: Vec<&str> = d.lines().collect();
        assert_eq!(lines.len(), DIGEST_MAX_LINES);
        assert_eq!(*lines.last().unwrap(), "… 7 more in flight");
    }
}
