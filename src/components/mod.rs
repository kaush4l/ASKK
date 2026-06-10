mod agents_page;
mod app_shell;
mod artifact_view;
mod chat_panel;
mod code_editor;
mod compiled_prompt_panel;
mod event_log;
mod inspector;
mod mcp_page;
mod provider_settings;
mod run_panel;
mod shared;
mod soul_page;
mod terminal;
mod tools_page;
mod workspace_page;

pub use app_shell::AppShell;
pub use shared::set_status;

use crate::state::AppSnapshot;
use crate::storage::{IndexedDbStorage, StorageAdapter};
use dioxus::prelude::*;

const FAVICON: Asset = asset!("/assets/favicon.svg");
const MAIN_CSS: Asset = asset!("/assets/main.css");

async fn save_snapshot(snapshot: AppSnapshot) -> String {
    match IndexedDbStorage::open().await {
        Ok(storage) => match storage.save_snapshot(&snapshot).await {
            Ok(()) => "Workspace saved to IndexedDB.".to_string(),
            Err(err) => format!("Save failed: {err}"),
        },
        Err(err) => err,
    }
}
