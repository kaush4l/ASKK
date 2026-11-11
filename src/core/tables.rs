//! # Tables: the port to the user's own data files
//!
//! A figure may take its numbers straight from one of the user's files (`from`). Where those
//! files are, and how one is read as a table, is the host's business (`host/data.rs` on the
//! server). The core only asks.
//!
//! With no host behind it the answer is a sentence saying so, and the figure is drawn with
//! that sentence as its note.
use serde_json::Value;
use std::sync::{Arc, OnceLock};

pub trait Tables: Send + Sync {
    /// Answer `query` (which file, which columns, which rows) with at most `limit` rows:
    /// `{"columns": […], "rows": […], "total": n}`.
    fn query(&self, query: &Value, limit: usize) -> Result<Value, String>;
}

static TABLES: OnceLock<Arc<dyn Tables>> = OnceLock::new();

/// Name who reads the user's data in this build. The first call wins.
pub fn set(t: Arc<dyn Tables>) {
    let _ = TABLES.set(t);
}

/// Rows a figure may take.
pub const MAX_ROWS: usize = 2000;

pub fn query(query: &Value, limit: usize) -> Result<Value, String> {
    match TABLES.get() {
        Some(t) => t.query(query, limit),
        None => Err("this build cannot read the user's data files".into()),
    }
}
