//! Answers: the faces of a shell.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::api::say;

/// `surfaces.json`, checked. A bad file is an error here, never a silent default.
pub async fn surfaces() -> Result<Surfaces, String> {
    crate::core::world::world();
    let key = &crate::core::manifest::manifest().surfaces;
    match crate::core::store::data().get(key) {
        Some(t) => Surfaces::read(&t).map_err(|e| say(format!("{key}: {e}"))),
        None => Ok(Surfaces::default()),
    }
}

/// How many engines run and how many messages wait.
pub async fn glance() -> Result<Glance, String> {
    let cards = crate::api::answers::engine_cards().await?;
    Ok(Glance { waiting: cards.iter().map(|c| c.new_msgs).sum(), running: cards.iter().filter(|c| crate::core::engine::working(&c.status)).count() })
}
