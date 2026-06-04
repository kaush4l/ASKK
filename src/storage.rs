use crate::state::{AppResult, AppSnapshot};
use async_trait::async_trait;
use indexed_db_futures::database::Database;
use indexed_db_futures::prelude::*;
use indexed_db_futures::transaction::TransactionMode;

const DB_NAME: &str = "askk";
const STORE_NAME: &str = "workspace";
const SNAPSHOT_KEY: &str = "snapshot";

#[async_trait(?Send)]
pub trait StorageAdapter {
    async fn load_snapshot(&self) -> AppResult<Option<AppSnapshot>>;
    async fn save_snapshot(&self, snapshot: &AppSnapshot) -> AppResult<()>;
}

#[derive(Clone)]
pub struct IndexedDbStorage {
    db: Database,
}

impl IndexedDbStorage {
    pub async fn open() -> AppResult<Self> {
        let db = Database::open(DB_NAME)
            .with_version(1u8)
            .with_on_upgrade_needed(|event, db| {
                if event.old_version() == 0.0 {
                    db.create_object_store(STORE_NAME).build()?;
                }
                Ok(())
            })
            .await
            .map_err(|err| format!("Unable to open IndexedDB: {err}"))?;

        Ok(Self { db })
    }
}

#[async_trait(?Send)]
impl StorageAdapter for IndexedDbStorage {
    async fn load_snapshot(&self) -> AppResult<Option<AppSnapshot>> {
        let tx = self
            .db
            .transaction(STORE_NAME)
            .build()
            .map_err(|err| format!("Unable to start IndexedDB read transaction: {err}"))?;
        let store = tx
            .object_store(STORE_NAME)
            .map_err(|err| format!("Unable to open IndexedDB object store: {err}"))?;
        store
            .get(SNAPSHOT_KEY.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB get request: {err}"))?
            .await
            .map(|snapshot: Option<AppSnapshot>| snapshot.map(AppSnapshot::with_profile_defaults))
            .map_err(|err| format!("Unable to read IndexedDB snapshot: {err}"))
    }

    async fn save_snapshot(&self, snapshot: &AppSnapshot) -> AppResult<()> {
        let mut persisted = snapshot.clone();
        persisted.ensure_provider_profiles();
        persisted.ensure_prompt_defaults();
        persisted.normalize_agent_branding();
        persisted.sanitize_api_keys();

        let tx = self
            .db
            .transaction(STORE_NAME)
            .with_mode(TransactionMode::Readwrite)
            .build()
            .map_err(|err| format!("Unable to start IndexedDB write transaction: {err}"))?;
        let store = tx
            .object_store(STORE_NAME)
            .map_err(|err| format!("Unable to open IndexedDB object store: {err}"))?;
        store
            .put(persisted)
            .with_key(SNAPSHOT_KEY.to_string())
            .serde()
            .map_err(|err| format!("Unable to create IndexedDB put request: {err}"))?
            .await
            .map_err(|err| format!("Unable to write IndexedDB snapshot: {err}"))?;
        tx.commit()
            .await
            .map_err(|err| format!("Unable to commit IndexedDB transaction: {err}"))?;
        Ok(())
    }
}
