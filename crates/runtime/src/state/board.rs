//! `BoardStore`: the persistent kanban board over a `KvStore` (OPFS in the
//! browser, memory on host). One key per card under `board/`; cards are
//! plain `askk_core::Card` JSON. Board writes are config-shaped (plain
//! `Result`s, no signals) — the mutating *tools* that drive them already
//! emit ToolRequested/ToolCompleted, which is what the UI refolds on.

use std::rc::Rc;

use askk_core::{Card, CardStage};

use super::store::{KvStore, StoreError};

const PREFIX: &str = "board/";

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
}
