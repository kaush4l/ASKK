use crate::state::AppResult;
use crate::storage::IndexedDbStorage;
use indexed_db_futures::prelude::*;
use indexed_db_futures::transaction::TransactionMode;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VfsEntry {
    pub content: String,
    pub is_dir: bool,
}

#[derive(Clone, Debug)]
pub struct ProjectVfs {
    pub store_name: String,
}

impl Default for ProjectVfs {
    fn default() -> Self {
        // Use a dedicated store for project files to avoid collisions with app snapshot
        Self {
            store_name: "project_files".to_string(),
        }
    }
}

impl ProjectVfs {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn write_file(&self, path: &str, content: &str) -> AppResult<()> {
        let db = IndexedDbStorage::open().await?;
        let tx = db
            .db()
            .transaction(self.store_name.as_str())
            .with_mode(TransactionMode::Readwrite)
            .build()
            .map_err(|err| format!("Unable to start IndexedDB write transaction for VFS: {err}"))?;
        let store = tx
            .object_store(self.store_name.as_str())
            .map_err(|err| format!("Unable to open IndexedDB object store for VFS: {err}"))?;

        store
            .put(VfsEntry {
                content: content.to_string(),
                is_dir: false,
            })
            .with_key(path.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB put request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to write IndexedDB VFS entry: {err}"))?;

        tx.commit()
            .await
            .map_err(|err| format!("Unable to commit IndexedDB transaction for VFS: {err}"))?;
        Ok(())
    }

    pub async fn read_file(&self, path: &str) -> AppResult<Option<String>> {
        let db = IndexedDbStorage::open().await?;
        let tx = db
            .db()
            .transaction(self.store_name.as_str())
            .build()
            .map_err(|err| format!("Unable to start IndexedDB read transaction for VFS: {err}"))?;
        let store = tx
            .object_store(self.store_name.as_str())
            .map_err(|err| format!("Unable to open IndexedDB object store for VFS: {err}"))?;

        store
            .get(path.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB get request for VFS: {err}"))?
            .await
            .map(|entry: Option<VfsEntry>| entry.map(|e| e.content))
            .map_err(|err| format!("Unable to read IndexedDB VFS entry: {err}"))
    }

    pub async fn list_files(&self) -> AppResult<Vec<String>> {
        let db = IndexedDbStorage::open().await?;
        let tx = db
            .db()
            .transaction(self.store_name.as_str())
            .build()
            .map_err(|err| format!("Unable to start IndexedDB read transaction for VFS: {err}"))?;
        let store = tx
            .object_store(self.store_name.as_str())
            .map_err(|err| format!("Unable to open IndexedDB object store for VFS: {err}"))?;

        let keys = store
            .get_all_keys::<String>()
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB keys request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to read IndexedDB VFS keys: {err}"))?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|err| format!("Unable to decode IndexedDB VFS keys: {err}"))?;

        Ok(keys)
    }
}
