//! Session state (MODELS.md §State model): UI picks that survive a reload —
//! active agent, provider profiles, misc prefs. Written by UI commands,
//! mirrored through whatever `KvStore` is injected (memory on host, OPFS in
//! web). Plain `Result`s; session writes are not run events, so no signals.

use std::rc::Rc;

use serde_json::Value;

use super::store::{KvStore, StoreError};

const ACTIVE_AGENT_KEY: &str = "session/active_agent";
const PROVIDER_PREFIX: &str = "session/provider/";
const PREF_PREFIX: &str = "session/pref/";

pub struct SessionStore {
    kv: Rc<dyn KvStore>,
}

impl SessionStore {
    pub fn new(kv: Rc<dyn KvStore>) -> Self {
        Self { kv }
    }

    pub async fn active_agent_id(&self) -> Result<Option<String>, StoreError> {
        Ok(self
            .kv
            .get(ACTIVE_AGENT_KEY)
            .await?
            .and_then(|v| v.as_str().map(String::from)))
    }

    pub async fn set_active_agent_id(&self, id: &str) -> Result<(), StoreError> {
        self.kv.set(ACTIVE_AGENT_KEY, Value::from(id)).await
    }

    /// Provider profiles are opaque `Value`s here; the config layer owns
    /// their shape.
    pub async fn provider_profile(&self, id: &str) -> Result<Option<Value>, StoreError> {
        self.kv.get(&format!("{PROVIDER_PREFIX}{id}")).await
    }

    pub async fn set_provider_profile(&self, id: &str, profile: Value) -> Result<(), StoreError> {
        self.kv
            .set(&format!("{PROVIDER_PREFIX}{id}"), profile)
            .await
    }

    pub async fn provider_profile_ids(&self) -> Result<Vec<String>, StoreError> {
        Ok(self
            .kv
            .list_prefix(PROVIDER_PREFIX)
            .await?
            .into_iter()
            .map(|key| key[PROVIDER_PREFIX.len()..].to_string())
            .collect())
    }

    /// Misc UI preference, opaque `Value`.
    pub async fn pref(&self, name: &str) -> Result<Option<Value>, StoreError> {
        self.kv.get(&format!("{PREF_PREFIX}{name}")).await
    }

    pub async fn set_pref(&self, name: &str, value: Value) -> Result<(), StoreError> {
        self.kv.set(&format!("{PREF_PREFIX}{name}"), value).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::block_on;
    use crate::state::store::MemKv;
    use serde_json::json;

    fn store() -> SessionStore {
        SessionStore::new(Rc::new(MemKv::new()))
    }

    #[test]
    fn active_agent_roundtrip() {
        let session = store();
        block_on(async {
            assert_eq!(session.active_agent_id().await.unwrap(), None);
            session.set_active_agent_id("coder").await.unwrap();
            assert_eq!(
                session.active_agent_id().await.unwrap(),
                Some("coder".to_string())
            );
        });
    }

    #[test]
    fn provider_profiles_roundtrip_and_list() {
        let session = store();
        block_on(async {
            let profile = json!({"base_url": "http://localhost:1234", "model": "x"});
            session
                .set_provider_profile("lmstudio", profile.clone())
                .await
                .unwrap();
            session
                .set_provider_profile("anthropic", json!({"model": "y"}))
                .await
                .unwrap();
            assert_eq!(
                session.provider_profile("lmstudio").await.unwrap(),
                Some(profile)
            );
            assert_eq!(session.provider_profile("nope").await.unwrap(), None);
            assert_eq!(
                session.provider_profile_ids().await.unwrap(),
                vec!["anthropic", "lmstudio"]
            );
        });
    }

    #[test]
    fn prefs_roundtrip() {
        let session = store();
        block_on(async {
            assert_eq!(session.pref("theme").await.unwrap(), None);
            session.set_pref("theme", json!("dark")).await.unwrap();
            assert_eq!(session.pref("theme").await.unwrap(), Some(json!("dark")));
        });
    }
}
