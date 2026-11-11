//! Answers: pages and the sidebar.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;
use crate::core::routes::{nav, resolve, scan};

pub async fn resolve_route(path: Vec<String>) -> Result<Option<Resolved>, String> {
    Ok(resolve(&scan(&*crate::core::store::data(), &crate::core::manifest::manifest().routes), &path))
}

pub async fn nav_links() -> Result<Vec<NavLink>, String> {
    Ok(nav(&scan(&*crate::core::store::data(), &crate::core::manifest::manifest().routes)))
}
