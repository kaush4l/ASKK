//! Boot: migration gate, event replay, built-in registration — through
//! the same install path as forged modules (ADR-004; that symmetry is I9's
//! live demonstration at every startup).

use agent::AgentState;
use kernel::{BoxFuture, Event, EventKind, EventLog, StoreError, StorePort};
use module::{Logic, Registry};

use crate::app::{App, Ports};
use crate::builtins;
use crate::error::CoreError;

const SCHEMA_KEY: &str = "meta/schema_version";

/// The storage schema version this build expects (ADR-005 `meta/
/// schema_version`). A function, not a const, so the value has one audited
/// definition site the migration ladder and tests share.
pub fn schema_version() -> u32 {
    1
}

/// Run the forward-only migration ladder from `from` up to
/// `schema_version()` (ADR-005). v1 is the first schema, so the only real
/// rung is 0 → 1 (stamp a fresh store); a newer store than the code refuses
/// with the export offer (ADR-007) — never a silent downgrade.
pub fn migrate(store: &dyn StorePort, from: u32) -> BoxFuture<'_, Result<(), CoreError>> {
    Box::pin(async move {
        let expected = schema_version();
        if from > expected {
            return Err(CoreError::SchemaNewerThanCode {
                stored: from,
                expected,
            });
        }
        if from < expected {
            // Rung 0→1: initialize. Later rungs: snapshot-first migrate_vN.
            store
                .kv()
                .put(SCHEMA_KEY, &expected.to_string())
                .await
                .map_err(CoreError::Store)?;
        }
        Ok(())
    })
}

/// Replay every persisted `events/<seq>` record, in key order, into a fresh
/// in-memory log. Corrupt records refuse boot loudly (ADR-005: no silent
/// drops of history).
async fn replay_events(store: &dyn StorePort) -> Result<EventLog, CoreError> {
    let mut log = EventLog::new();
    let keys = store
        .kv()
        .list_prefix("events/")
        .await
        .map_err(CoreError::Store)?;
    for key in keys {
        let raw = store
            .kv()
            .get(&key)
            .await
            .map_err(CoreError::Store)?
            .ok_or_else(|| {
                CoreError::Store(StoreError::Backend {
                    message: format!("listed key vanished: {key}"),
                })
            })?;
        let event: Event = serde_json::from_str(&raw).map_err(|e| {
            CoreError::Store(StoreError::Corrupt {
                key,
                message: e.to_string(),
            })
        })?;
        log.append(event); // seq reassigned identically: keys are seq-ordered
    }
    Ok(log)
}

/// Build the running App: check/migrate schema, replay the persisted event
/// log, install built-ins through the one install path (each install is a
/// fresh fact — G4 keeps no persisted registry state yet), seed the agent.
/// The ONE constructor — `App` has no `new` because an App that skipped boot
/// would be an unmigrated, unreplayed lie.
pub fn boot(ports: Ports) -> BoxFuture<'static, Result<App, CoreError>> {
    Box::pin(async move {
        let store = std::rc::Rc::clone(&ports.store);
        let stored: u32 = store
            .kv()
            .get(SCHEMA_KEY)
            .await
            .map_err(CoreError::Store)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        migrate(store.as_ref(), stored).await?;

        let log = replay_events(store.as_ref()).await?;

        let mut app = App {
            registry: Registry::new(),
            agent: AgentState::new(),
            phases: agent::v1_phases(),
            log,
            ports,
            pending: Vec::new(),
            unpersisted: Vec::new(),
            agents: Vec::new(),
            agent_problems: Vec::new(),
            board: agent::Board::default(),
        };
        for manifest in builtins::manifests() {
            let (module, version) = (manifest.id.clone(), manifest.version);
            app.registry
                .install(manifest, Logic::BuiltIn)
                .map_err(CoreError::Module)?;
            app.append(EventKind::ModuleInstalled { module, version });
        }
        Ok(app)
    })
}
