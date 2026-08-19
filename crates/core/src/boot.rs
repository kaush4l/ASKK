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
    2
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
            // Rung 1→2: drop the polling noise. Until this build every seam
            // GET appended a `RequestHandled` fact, and four panes poll the
            // seam while a page is open — one real browser had **39,237**
            // events, essentially all of them "somebody looked". Every one was
            // replayed at boot and cloned into `Ctx` on every request, so the
            // cost of looking grew with how long you had looked.
            //
            // `handle` no longer writes them; this clears what is already
            // there. It is a DELETION of history, which this codebase does not
            // do lightly (ADR-005: no silent drops) — the justification is that
            // these facts record no event in the world, and the alternative is
            // a store that is slower every day and never recovers.
            if from >= 1 {
                drop_request_noise(store).await?;
            }
            store
                .kv()
                .put(SCHEMA_KEY, &expected.to_string())
                .await
                .map_err(CoreError::Store)?;
        }
        Ok(())
    })
}

/// Rewrite `events/*` without the `RequestHandled` records, renumbering as it
/// goes so the keys stay dense and seq-ordered. One `replace_prefix`, which
/// IndexedDB does in a single transaction: a reader sees the old log or the
/// new one, never half of either.
async fn drop_request_noise(store: &dyn StorePort) -> Result<(), CoreError> {
    let keys = store
        .kv()
        .list_prefix("events/")
        .await
        .map_err(CoreError::Store)?;
    let mut kept: Vec<(String, String)> = Vec::with_capacity(keys.len());
    for key in keys {
        let Some(raw) = store.kv().get(&key).await.map_err(CoreError::Store)? else {
            continue;
        };
        // A record this build cannot read is KEPT, unchanged: a migration that
        // deletes what it does not understand is a migration that eats data.
        let noise = serde_json::from_str::<Event>(&raw)
            .map(|e| matches!(e.kind, EventKind::RequestHandled { .. }))
            .unwrap_or(false);
        if !noise {
            // The SAME key format `log::store::record` writes (`{:08}`): two widths
            // sort differently as strings, and these keys are read back in key
            // order to rebuild the log.
            kept.push((format!("events/{:08}", kept.len()), raw));
        }
    }
    store
        .kv()
        .replace_prefix("events/", &kept)
        .await
        .map_err(CoreError::Store)
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
        let booted = log.len() as usize;

        // Both halves of every faculty this crate can host, taken BEFORE
        // `ports` is moved into the literal below. They are computed here and
        // not by a composition root so that a build cannot forget one: an app
        // that reached `handle` without its hosts would offer `keep` to the
        // model and then refuse every call to it.
        let senses = crate::faculty::installed_by_default(&ports);
        let tool_hosts = crate::faculty::hosts_by_default(&ports);

        let mut app = App {
            registry: Registry::new(),
            agent: AgentState::new(),
            phases: agent::v1_phases(),
            log,
            ports,
            senses,
            tool_hosts,
            pending: Vec::new(),
            unpersisted: Vec::new(),
            unlogged: Vec::new(),
            logbook: crate::log::decisions::Logbook::default(),
            agents: Vec::new(),
            files: Vec::new(),
            authored: Vec::new(),
            agent_problems: Vec::new(),
            board: agent::Board::default(),
            me: crate::app::ENTRY_AGENT.to_string(),
            running: Vec::new(),
            calling: Vec::new(),
            booted,
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
