use crate::state::AppResult;
use crate::storage::{IndexedDbStorage, PROJECT_FILES_STORE_NAME};
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
            store_name: PROJECT_FILES_STORE_NAME.to_string(),
        }
    }
}

impl ProjectVfs {
    pub fn new() -> Self {
        Self::default()
    }

    /// Legacy write path. The live workspace filesystem is now
    /// [`crate::storage::opfs_vfs::OpfsVfs`]; this store is kept intact as the
    /// read-only source for its one-time migration, so nothing writes here
    /// anymore.
    #[allow(dead_code)]
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
        Ok(self.read_entry(path).await?.map(|entry| entry.content))
    }

    /// Read the full entry (content + `is_dir`) at `path`, if any.
    pub async fn read_entry(&self, path: &str) -> AppResult<Option<VfsEntry>> {
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
            .map_err(|err| format!("Unable to read IndexedDB VFS entry: {err}"))
    }

    /// Create an explicit directory entry at `path`.
    pub async fn mkdir(&self, path: &str) -> AppResult<()> {
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
                content: String::new(),
                is_dir: true,
            })
            .with_key(path.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB put request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to write IndexedDB VFS directory entry: {err}"))?;

        tx.commit()
            .await
            .map_err(|err| format!("Unable to commit IndexedDB transaction for VFS: {err}"))?;
        Ok(())
    }

    /// Delete the single entry at `path`. Missing keys are a no-op (IndexedDB
    /// `delete` semantics).
    pub async fn delete(&self, path: &str) -> AppResult<()> {
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
            .delete(path.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB delete request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to delete IndexedDB VFS entry: {err}"))?;

        tx.commit()
            .await
            .map_err(|err| format!("Unable to commit IndexedDB transaction for VFS: {err}"))?;
        Ok(())
    }

    /// Move the single entry at `from` to `to` (read, put, delete in one
    /// transaction). Errors if `from` does not exist.
    pub async fn rename(&self, from: &str, to: &str) -> AppResult<()> {
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

        let entry: Option<VfsEntry> = store
            .get(from.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB get request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to read IndexedDB VFS entry: {err}"))?;
        let Some(entry) = entry else {
            return Err(format!("Unable to rename VFS entry: {from} does not exist"));
        };

        store
            .put(entry)
            .with_key(to.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB put request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to write IndexedDB VFS entry: {err}"))?;
        store
            .delete(from.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB delete request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to delete IndexedDB VFS entry: {err}"))?;

        tx.commit()
            .await
            .map_err(|err| format!("Unable to commit IndexedDB transaction for VFS: {err}"))?;
        Ok(())
    }

    /// Every stored entry as `(path, is_dir)`. IndexedDB returns both
    /// `getAllKeys` and `getAll` sorted by key, so zipping them is sound.
    pub async fn list_entries(&self) -> AppResult<Vec<(String, bool)>> {
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
        let entries = store
            .get_all::<VfsEntry>()
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB records request for VFS: {err}"))?
            .await
            .map_err(|err| format!("Unable to read IndexedDB VFS records: {err}"))?
            .collect::<Result<Vec<VfsEntry>, _>>()
            .map_err(|err| format!("Unable to decode IndexedDB VFS records: {err}"))?;
        if keys.len() != entries.len() {
            return Err(format!(
                "IndexedDB VFS listing is inconsistent: {} keys but {} records",
                keys.len(),
                entries.len()
            ));
        }

        Ok(keys
            .into_iter()
            .zip(entries)
            .map(|(path, entry)| (path, entry.is_dir))
            .collect())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_store_uses_indexeddb_migration_store_name() {
        assert_eq!(ProjectVfs::default().store_name, PROJECT_FILES_STORE_NAME);
    }
}
