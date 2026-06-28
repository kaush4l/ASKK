//! Unit tests for [`super`] (the `AppSnapshot` state module). Split out to keep
//! snapshot.rs focused on the state logic. Attached via `#[path]` from snapshot.rs.

// Tests build a default snapshot and then assign the one field under test; that
// reads more clearly than a full struct-update literal here.
#![allow(clippy::field_reassign_with_default)]
use crate::responses::ResponseFormat;
use crate::state::*;
use serde_json::json;

#[test]
fn old_snapshot_without_auth_mode_deserializes() {
    let snapshot = serde_json::from_value::<AppSnapshot>(json!({
        "provider": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        },
        "agents": [],
        "memories": [],
        "tasks": [],
        "runs": [],
        "current_run": null,
        "status": "Ready"
    }))
    .unwrap();

    assert_eq!(snapshot.provider.auth_mode, ProviderAuthMode::Bearer);
    assert_eq!(
        snapshot.tool_config.web_search.bridge_tools_url,
        default_bridge_tools_url()
    );
}

#[test]
fn old_snapshot_seeds_provider_profile_on_normalize() {
    let snapshot = serde_json::from_value::<AppSnapshot>(json!({
        "provider": {
            "base_url": "http://127.0.0.1:8874/v1",
            "model": "local-model",
            "api_key": "",
            "auth_mode": "none",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        },
        "agents": [],
        "memories": [],
        "tasks": [],
        "runs": [],
        "current_run": null,
        "status": "Ready"
    }))
    .unwrap()
    .with_profile_defaults();

    assert_eq!(snapshot.provider_profiles.len(), 1);
    assert_eq!(snapshot.provider_profiles[0].config.model, "local-model");
    assert_eq!(
        snapshot.active_provider_profile_id.as_deref(),
        Some(snapshot.provider_profiles[0].id.as_str())
    );
}

#[test]
fn old_snapshot_strips_agent_branding_on_normalize() {
    let snapshot = serde_json::from_value::<AppSnapshot>(json!({
        "provider": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        },
        "agents": [
            {
                "id": "planner",
                "name": "ASKK Planner",
                "role": "Plan.",
                "enabled": true,
                "enabled_tools": []
            }
        ],
        "memories": [],
        "tasks": [],
        "runs": [
            {
                "id": "run-1",
                "goal": "Test",
                "status": "complete",
                "messages": [
                    {
                        "role": "assistant",
                        "content": "ASKK Planner: done"
                    }
                ],
                "events": [
                    {
                        "id": "event-1",
                        "run_id": "run-1",
                        "agent_id": "planner",
                        "kind": "LlmResponse",
                        "title": "ASKK Planner responded",
                        "body": "ASKK Planner finished",
                        "created_at": "now"
                    }
                ],
                "tool_calls": [],
                "tool_results": [],
                "final_answer": "ASKK Synthesizer: final",
                "created_at": "now"
            }
        ],
        "current_run": null,
        "status": "Ready"
    }))
    .unwrap()
    .with_profile_defaults();

    assert_eq!(snapshot.agents[0].name, "Planner");
    assert_eq!(snapshot.agents[0].response_format, ResponseFormat::Toon);
    assert_eq!(snapshot.runs[0].messages[0].content, "Planner: done");
    assert_eq!(snapshot.runs[0].events[0].title, "Planner responded");
    assert_eq!(snapshot.runs[0].events[0].body, "Planner finished");
    assert_eq!(snapshot.runs[0].final_answer, "Synthesizer: final");
    assert_eq!(snapshot.agents[0].enabled_tools, default_tool_names());
}

#[test]
fn sanitize_api_keys_clears_active_provider_and_profiles() {
    let mut snapshot = AppSnapshot::default();
    snapshot.provider.api_key = "active-secret".to_string();
    snapshot.provider.persist_api_key = false;
    snapshot.provider_profiles = vec![
        ProviderProfile::new(
            "Persisted",
            ProviderConfig {
                api_key: "kept".to_string(),
                persist_api_key: true,
                ..ProviderConfig::default()
            },
        ),
        ProviderProfile::new(
            "Ephemeral",
            ProviderConfig {
                api_key: "cleared".to_string(),
                persist_api_key: false,
                ..ProviderConfig::default()
            },
        ),
    ];
    snapshot.tool_config.web_search.brave_api_key = "brave-secret".to_string();
    snapshot.tool_config.web_search.tavily_api_key = "tavily-secret".to_string();
    snapshot.tool_config.web_search.persist_api_keys = false;

    snapshot.sanitize_api_keys();

    assert!(snapshot.provider.api_key.is_empty());
    assert_eq!(snapshot.provider_profiles[0].config.api_key, "kept");
    assert!(snapshot.provider_profiles[1].config.api_key.is_empty());
    assert!(snapshot.tool_config.web_search.brave_api_key.is_empty());
    assert!(snapshot.tool_config.web_search.tavily_api_key.is_empty());
}

#[test]
fn sanitize_api_keys_keeps_web_search_keys_when_enabled() {
    let mut snapshot = AppSnapshot::default();
    snapshot.tool_config.web_search.brave_api_key = "brave-secret".to_string();
    snapshot.tool_config.web_search.tavily_api_key = "tavily-secret".to_string();
    snapshot.tool_config.web_search.persist_api_keys = true;

    snapshot.sanitize_api_keys();

    assert_eq!(
        snapshot.tool_config.web_search.brave_api_key,
        "brave-secret"
    );
    assert_eq!(
        snapshot.tool_config.web_search.tavily_api_key,
        "tavily-secret"
    );
}

#[test]
fn normalize_agent_tools_preserves_manifest_allowlist() {
    let mut snapshot = AppSnapshot::default();
    snapshot.agents = vec![Agent::new(
        "Restricted",
        "Use only the allowed tools.",
        vec!["web_search".to_string(), "web_search".to_string()],
    )];

    snapshot.normalize_agent_tools();

    assert_eq!(snapshot.agents[0].enabled_tools, vec!["web_search"]);
}

#[test]
fn normalize_agent_tools_defaults_only_empty_allowlists() {
    let mut snapshot = AppSnapshot::default();
    snapshot.agents = vec![Agent::new("Legacy", "Use defaults.", Vec::new())];

    snapshot.normalize_agent_tools();

    assert_eq!(snapshot.agents[0].enabled_tools, default_tool_names());
}

#[test]
fn connection_helpers_save_sync_rename_select_and_delete() {
    let mut snapshot = AppSnapshot::default();

    // New connection captured from the current effective config.
    snapshot.provider.model = "first-model".to_string();
    let save_status = snapshot.save_current_provider_profile("First");
    let first_id = snapshot.active_provider_profile_id.clone().unwrap();
    assert_eq!(save_status, "Saved connection: First");

    // Live edits mirror into the active connection (no explicit "update" step).
    snapshot.provider.model = "second-model".to_string();
    snapshot.sync_active_connection();
    assert_eq!(
        snapshot
            .provider_profiles
            .iter()
            .find(|profile| profile.id == first_id)
            .unwrap()
            .config
            .model,
        "second-model"
    );

    // Rename in place.
    assert_eq!(
        snapshot.rename_active_connection("Second"),
        "Renamed connection: Second"
    );

    // Selecting another connection copies ONLY connection fields; the active
    // generation preset's tuning (temperature) must be left untouched.
    snapshot.provider.temperature = 0.9;
    let default_id = snapshot
        .provider_profiles
        .iter()
        .find(|profile| profile.id != first_id)
        .unwrap()
        .id
        .clone();
    snapshot.select_connection(&default_id).unwrap();
    assert_eq!(snapshot.provider.model, "gpt-4.1-mini");
    assert_eq!(snapshot.provider.temperature, 0.9);

    let delete_status = snapshot.delete_provider_profile(&first_id);
    assert_eq!(delete_status, "Deleted connection: Second");
    assert!(
        !snapshot
            .provider_profiles
            .iter()
            .any(|profile| profile.id == first_id)
    );
}

#[test]
fn generation_preset_helpers_sync_duplicate_and_rename() {
    let mut snapshot = AppSnapshot::default();
    let active_id = snapshot.active_model_profile_id.clone().unwrap();

    // Live tuning edit mirrors into the active preset.
    snapshot.provider.temperature = 0.42;
    snapshot.provider.max_tokens = 1234;
    snapshot.sync_active_model_profile();
    let active = snapshot
        .model_profiles
        .iter()
        .find(|profile| profile.id == active_id)
        .unwrap();
    assert_eq!(active.temperature, 0.42);
    assert_eq!(active.max_tokens, 1234);

    // Duplicate creates a new, distinct active preset.
    let before = snapshot.model_profiles.len();
    snapshot.duplicate_active_model_profile();
    assert_eq!(snapshot.model_profiles.len(), before + 1);
    let new_id = snapshot.active_model_profile_id.clone().unwrap();
    assert_ne!(new_id, active_id);

    // Rename in place.
    assert_eq!(
        snapshot.rename_active_model_profile("My preset"),
        "Renamed generation preset: My preset"
    );
    assert_eq!(
        snapshot
            .model_profiles
            .iter()
            .find(|profile| profile.id == new_id)
            .unwrap()
            .name,
        "My preset"
    );
}

#[test]
fn with_profile_defaults_applies_active_generation_preset_to_provider() {
    let mut snapshot = AppSnapshot::default();
    let active_id = snapshot.active_model_profile_id.clone().unwrap();
    if let Some(profile) = snapshot
        .model_profiles
        .iter_mut()
        .find(|profile| profile.id == active_id)
    {
        profile.temperature = 0.33;
        profile.max_tokens = 999;
    }
    // Effective config out of sync until normalization re-applies the preset.
    snapshot.provider.temperature = 0.0;
    snapshot.provider.max_tokens = 1;

    let snapshot = snapshot.with_profile_defaults();

    assert_eq!(snapshot.provider.temperature, 0.33);
    assert_eq!(snapshot.provider.max_tokens, 999);
}

#[test]
fn checkpoint_current_run_persists_resumable_job_record() {
    let mut snapshot = AppSnapshot::default();
    let run = AgentRun {
        id: "run-checkpoint".to_string(),
        goal: "Persist this run".to_string(),
        lane: RunLane::BoundedTask,
        status: RunStatus::Running,
        scratchpad: RunScratchpad {
            budgets: RunBudgets {
                steps_used: 2,
                max_steps: 5,
                ..RunBudgets::default()
            },
            ..RunScratchpad::default()
        },
        messages: Vec::new(),
        events: vec![event(
            "run-checkpoint",
            Some("assistant".to_string()),
            AgentEventKind::LlmRequest,
            "LLM request 2/5",
            "Checkpointable progress",
        )],
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: String::new(),
        created_at: "now".to_string(),
    };
    snapshot.set_current_run(Some(run));

    snapshot.checkpoint_current_run();

    assert_eq!(snapshot.jobs.len(), 1);
    assert_eq!(snapshot.jobs[0].id, "run-checkpoint");
    assert_eq!(snapshot.jobs[0].status, RunStatus::Running);
    assert_eq!(snapshot.jobs[0].progress, "LLM request 2/5");
    assert_eq!(
        snapshot.jobs[0]
            .checkpoint
            .as_ref()
            .unwrap()
            .budgets
            .steps_used,
        2
    );
}

#[test]
fn stale_running_checkpoint_does_not_overwrite_completed_run() {
    let mut completed = AppSnapshot::default();
    completed.set_current_run(Some(AgentRun {
        id: "run-race".to_string(),
        goal: "Final result".to_string(),
        lane: RunLane::Batch,
        status: RunStatus::Complete,
        scratchpad: RunScratchpad::default(),
        messages: Vec::new(),
        events: Vec::new(),
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: "done".to_string(),
        created_at: "now".to_string(),
    }));

    let mut stale = completed.clone();
    stale.status = "Running batch lane...".to_string();
    stale.current_run_mut().unwrap().status = RunStatus::Running;
    stale.current_run_mut().unwrap().final_answer.clear();

    assert!(stale.is_stale_checkpoint_for(&completed));

    stale.current_run_mut().unwrap().status = RunStatus::Complete;
    stale.current_run_mut().unwrap().final_answer = "done".to_string();
    assert!(stale.is_stale_checkpoint_for(&completed));
    assert!(!completed.is_stale_checkpoint_for(&stale));

    let mut interrupted = completed.clone();
    interrupted.status = "Run interrupted.".to_string();
    interrupted.current_run_mut().unwrap().status = RunStatus::Interrupted;
    let mut stale_after_interrupt = interrupted.clone();
    stale_after_interrupt.status = "Running bounded task lane...".to_string();
    stale_after_interrupt.current_run_mut().unwrap().status = RunStatus::Running;
    assert!(stale_after_interrupt.is_stale_checkpoint_for(&interrupted));
}

#[test]
fn normalize_pauses_running_run_after_reload_and_keeps_resume_checkpoint() {
    let mut snapshot = AppSnapshot::default();
    snapshot.set_current_run(Some(AgentRun {
        id: "run-reload".to_string(),
        goal: "Resume after reload".to_string(),
        lane: RunLane::BoundedTask,
        status: RunStatus::Running,
        scratchpad: RunScratchpad::default(),
        messages: Vec::new(),
        events: Vec::new(),
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: String::new(),
        created_at: "now".to_string(),
    }));

    let snapshot = snapshot.with_profile_defaults();

    let run = snapshot.current_run().unwrap();
    assert_eq!(run.status, RunStatus::Paused);
    assert!(run.scratchpad.interrupted);
    assert_eq!(snapshot.jobs.len(), 1);
    assert_eq!(snapshot.jobs[0].id, "run-reload");
    assert_eq!(snapshot.jobs[0].status, RunStatus::Paused);
    assert!(snapshot.jobs[0].checkpoint.is_some());
    assert!(
        run.events
            .iter()
            .any(|event| event.kind == AgentEventKind::Interrupted)
    );
}

#[test]
fn obsolete_shared_agent_soul_is_migrated_to_current_default() {
    let mut snapshot = AppSnapshot::default();
    snapshot.soul = "# Shared Agent Soul\n\nYou are a careful, autonomous agent.".to_string();

    snapshot.ensure_prompt_defaults();

    assert_eq!(snapshot.soul, default_soul_prompt());
    assert!(!snapshot.soul.contains("# Shared Agent Soul"));
}

#[test]
fn user_authored_soul_is_preserved() {
    let mut snapshot = AppSnapshot::default();
    snapshot.soul = "You are Atlas, my bespoke research companion.".to_string();

    snapshot.ensure_prompt_defaults();

    assert_eq!(
        snapshot.soul,
        "You are Atlas, my bespoke research companion."
    );
}

#[test]
fn default_snapshot_seeds_the_builtin_workspace_mcp_server() {
    let snapshot = AppSnapshot::default();
    let workspace: Vec<_> = snapshot
        .mcp_servers
        .iter()
        .filter(|server| server.kind == McpServerKind::Workspace)
        .collect();
    assert_eq!(workspace.len(), 1);
    assert_eq!(workspace[0].id, WORKSPACE_MCP_SERVER_ID);
    assert!(workspace[0].enabled);
}

#[test]
fn ensure_workspace_mcp_server_is_idempotent_and_respects_disabled() {
    // A snapshot persisted before the workspace server shipped: no entry at all.
    let mut snapshot = AppSnapshot::default();
    snapshot.mcp_servers.clear();
    assert!(snapshot.ensure_workspace_mcp_server(), "first call seeds");
    assert!(!snapshot.ensure_workspace_mcp_server(), "second is a no-op");
    assert_eq!(snapshot.mcp_servers.len(), 1);
    assert_eq!(snapshot.mcp_servers[0].kind, McpServerKind::Workspace);

    // A user who disabled the built-in keeps it disabled — ensure must not
    // duplicate it or flip the flag back on.
    snapshot.mcp_servers[0].enabled = false;
    assert!(!snapshot.ensure_workspace_mcp_server());
    assert_eq!(snapshot.mcp_servers.len(), 1);
    assert!(!snapshot.mcp_servers[0].enabled);
}

#[test]
fn with_profile_defaults_seeds_the_workspace_server_on_any_load_path() {
    // `with_profile_defaults` is the canonical post-load normalizer (applied by
    // storage::load_snapshot), so every load path — app start AND the Provider
    // page's Load button — must seed the built-in server.
    let mut snapshot = AppSnapshot::default();
    snapshot.mcp_servers.clear();
    let normalized = snapshot.with_profile_defaults();
    assert!(
        normalized
            .mcp_servers
            .iter()
            .any(|server| server.kind == McpServerKind::Workspace)
    );
}

#[test]
fn ensure_workspace_mcp_server_inserts_ahead_of_user_servers() {
    let mut snapshot = AppSnapshot::default();
    snapshot.mcp_servers.clear();
    snapshot.add_mcp_server();
    assert!(snapshot.ensure_workspace_mcp_server());
    assert_eq!(snapshot.mcp_servers[0].kind, McpServerKind::Workspace);
    assert_eq!(snapshot.mcp_servers.len(), 2);
}

#[test]
fn agent_memories_survive_serde_round_trip_and_default_for_old_snapshots() {
    let mut snapshot = AppSnapshot::default();
    upsert_rolling_summary(&mut snapshot.agent_memories, "researcher", "knows X".into());
    let json = serde_json::to_string(&snapshot).expect("serializes");
    let restored: AppSnapshot = serde_json::from_str(&json).expect("deserializes");
    assert_eq!(
        rolling_summary_for(&restored.agent_memories, "researcher"),
        "knows X"
    );

    // An old snapshot without the field still loads.
    let mut value: serde_json::Value = serde_json::from_str(&json).expect("value");
    value
        .as_object_mut()
        .expect("object")
        .remove("agent_memories");
    let old: AppSnapshot = serde_json::from_value(value).expect("old loads");
    assert!(old.agent_memories.is_empty());
}

#[test]
fn snapshot_without_schedules_field_deserializes_cleanly() {
    let snap: AppSnapshot = serde_json::from_value(serde_json::json!({
        "provider": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        },
        "agents": [],
        "memories": [],
        "tasks": [],
        "runs": [],
        "current_run": null,
        "status": "Ready"
    }))
    .unwrap();
    assert!(snap.schedules.is_empty());
    assert!(snap.tool_config.google.client_id.is_empty());
    assert!(snap.tool_config.telegram.bot_token.is_empty());
}

#[test]
fn sanitize_clears_google_and_telegram_tokens_when_not_persisted() {
    let mut snap = AppSnapshot::default();
    snap.tool_config.google.access_token = "ya29.live_token".into();
    snap.tool_config.google.persist_tokens = false;
    snap.tool_config.telegram.bot_token = "123456:secret".into();
    snap.tool_config.telegram.persist_token = false;
    snap.sanitize_api_keys();
    assert!(snap.tool_config.google.access_token.is_empty());
    assert!(snap.tool_config.telegram.bot_token.is_empty());
}

// The single live run must still round-trip through the legacy `current_run` wire
// field: a snapshot with an active run serializes that run under `current_run`, and
// loading it back (via `with_profile_defaults`, the canonical post-load normalizer)
// hydrates the instance collection so `current_run()` returns it. This is the
// linchpin back-compat guarantee — older IndexedDB snapshots keep loading and a live
// run keeps surviving a save/load cycle even though `current_run` is no longer a
// directly-set field.
#[test]
fn single_live_run_round_trips_through_the_legacy_current_run_wire() {
    let mut snapshot = AppSnapshot::default();
    snapshot.set_current_run(Some(AgentRun {
        id: "run-roundtrip".to_string(),
        goal: "Survive a save/load".to_string(),
        lane: RunLane::BoundedTask,
        status: RunStatus::Running,
        scratchpad: RunScratchpad::default(),
        messages: Vec::new(),
        events: Vec::new(),
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: "in progress".to_string(),
        created_at: "now".to_string(),
    }));

    // The wire still carries a `current_run` object with the run's id.
    let json = serde_json::to_value(&snapshot).expect("serializes");
    assert_eq!(json["current_run"]["id"], "run-roundtrip");

    // Loading it back and normalizing hydrates the instance collection so the
    // active-run accessor returns the same run.
    let restored: AppSnapshot = serde_json::from_value(json).expect("deserializes");
    let restored = restored.with_profile_defaults();
    let run = restored
        .current_run()
        .expect("active run hydrated from wire");
    assert_eq!(run.id, "run-roundtrip");
    assert_eq!(run.final_answer, "in progress");
    // Reload paused the running run (recover-after-reload), but the identity and
    // payload survived — that is the round-trip guarantee.
    assert_eq!(run.status, RunStatus::Paused);
}

// An older snapshot that stored `current_run` as a plain object (the legacy schema)
// loads through the renamed wire field and hydrates the active run on normalize.
#[test]
fn legacy_current_run_object_still_loads_and_hydrates() {
    let snapshot = serde_json::from_value::<AppSnapshot>(json!({
        "provider": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        },
        "agents": [],
        "memories": [],
        "tasks": [],
        "runs": [],
        "current_run": {
            "id": "legacy-run",
            "goal": "Loaded from an old snapshot",
            "status": "complete",
            "messages": [],
            "events": [],
            "tool_calls": [],
            "tool_results": [],
            "final_answer": "answered",
            "created_at": "then"
        },
        "status": "Ready"
    }))
    .unwrap()
    .with_profile_defaults();

    let run = snapshot
        .current_run()
        .expect("legacy current_run hydrates into the active instance");
    assert_eq!(run.id, "legacy-run");
    assert_eq!(run.final_answer, "answered");
    assert_eq!(run.status, RunStatus::Complete);
}

// Helper: a minimal run with the given id and status.
fn run_fixture(id: &str, status: RunStatus) -> AgentRun {
    AgentRun {
        id: id.to_string(),
        goal: format!("goal for {id}"),
        lane: RunLane::BoundedTask,
        status,
        scratchpad: RunScratchpad::default(),
        messages: Vec::new(),
        events: Vec::new(),
        tool_calls: Vec::new(),
        tool_results: Vec::new(),
        final_answer: String::new(),
        created_at: "now".to_string(),
    }
}

// The whole instance fleet must round-trip through the multi-instance `instances`
// wire schema. Several runs are upserted, the snapshot is checkpointed (the save
// path that flattens the collection onto the wire), serialized, and loaded back:
// every instance returns in chronological order with its payload intact.
#[test]
fn multi_instance_fleet_round_trips_through_serde() {
    let mut snapshot = AppSnapshot::default();
    snapshot.set_current_run(Some(run_fixture("run-a", RunStatus::Complete)));
    snapshot.set_current_run(Some(run_fixture("run-b", RunStatus::Complete)));
    let mut live = run_fixture("run-c", RunStatus::Paused);
    live.final_answer = "halfway".to_string();
    snapshot.set_current_run(Some(live));

    // The save path flattens the whole collection onto `instances_wire`.
    snapshot.checkpoint_current_run();

    let json = serde_json::to_value(&snapshot).expect("serializes");
    // The multi-instance schema rides under `instances`, the active run still under
    // the legacy `current_run`.
    let wire_instances = json["instances"].as_array().expect("instances array");
    assert_eq!(wire_instances.len(), 3, "every instance persists");
    assert_eq!(json["instances"][0]["id"], "run-a");
    assert_eq!(json["instances"][2]["id"], "run-c");
    assert_eq!(json["current_run"]["id"], "run-c");

    let restored: AppSnapshot = serde_json::from_value(json).expect("deserializes");
    let restored = restored.with_profile_defaults();
    let ids: Vec<&str> = restored
        .instances()
        .iter()
        .map(|instance| instance.projection.id.as_str())
        .collect();
    assert_eq!(ids, ["run-a", "run-b", "run-c"], "fleet order preserved");
    assert_eq!(restored.instances().len(), 3);
    // The active instance (most-recent live) is the paused run, payload intact.
    let active = restored.current_run().expect("active run");
    assert_eq!(active.id, "run-c");
    assert_eq!(active.final_answer, "halfway");
}

// A legacy snapshot that only has the single `current_run` object (no `instances`
// array at all) must load into a one-element collection — the migration the
// foundation's `hydrate_instances` did for the single run, now generalized.
#[test]
fn legacy_single_current_run_migrates_into_one_instance() {
    let snapshot = serde_json::from_value::<AppSnapshot>(json!({
        "provider": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        },
        "agents": [],
        "memories": [],
        "tasks": [],
        "runs": [],
        "current_run": {
            "id": "legacy-run",
            "goal": "Loaded from an old snapshot",
            "status": "complete",
            "messages": [],
            "events": [],
            "tool_calls": [],
            "tool_results": [],
            "final_answer": "answered",
            "created_at": "then"
        },
        "status": "Ready"
    }))
    .unwrap()
    .with_profile_defaults();

    assert_eq!(
        snapshot.instances().len(),
        1,
        "a legacy single current_run loads into exactly one instance"
    );
    let run = snapshot.current_run().expect("active instance");
    assert_eq!(run.id, "legacy-run");
    assert_eq!(run.final_answer, "answered");
}

// When both schemas are present (a transitional save wrote both), the multi-instance
// `instances` array is authoritative and the legacy `current_run` is NOT double-counted.
#[test]
fn instances_wire_takes_precedence_over_legacy_current_run() {
    let snapshot = serde_json::from_value::<AppSnapshot>(json!({
        "provider": {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4.1-mini",
            "api_key": "",
            "persist_api_key": false,
            "temperature": 0.2,
            "max_tokens": 900
        },
        "agents": [],
        "memories": [],
        "tasks": [],
        "runs": [],
        "current_run": {
            "id": "run-z",
            "goal": "active",
            "status": "complete",
            "messages": [],
            "events": [],
            "tool_calls": [],
            "tool_results": [],
            "final_answer": "",
            "created_at": "now"
        },
        "instances": [
            {
                "id": "run-x",
                "goal": "first",
                "status": "complete",
                "messages": [],
                "events": [],
                "tool_calls": [],
                "tool_results": [],
                "final_answer": "",
                "created_at": "now"
            },
            {
                "id": "run-z",
                "goal": "active",
                "status": "complete",
                "messages": [],
                "events": [],
                "tool_calls": [],
                "tool_results": [],
                "final_answer": "",
                "created_at": "now"
            }
        ],
        "status": "Ready"
    }))
    .unwrap()
    .with_profile_defaults();

    let ids: Vec<&str> = snapshot
        .instances()
        .iter()
        .map(|instance| instance.projection.id.as_str())
        .collect();
    assert_eq!(
        ids,
        ["run-x", "run-z"],
        "the instances array drives hydration; the legacy current_run is not re-added"
    );
}

// Reload recovery must flip EVERY `Running` instance to `Paused` (resumable), not
// just the active one, and leave terminal/paused instances untouched.
#[test]
fn reload_pauses_every_running_instance() {
    let mut snapshot = AppSnapshot::default();
    snapshot.set_current_run(Some(run_fixture("done", RunStatus::Complete)));
    snapshot.set_current_run(Some(run_fixture("running-1", RunStatus::Running)));
    snapshot.set_current_run(Some(run_fixture("running-2", RunStatus::Running)));
    snapshot.set_current_run(Some(run_fixture("already-paused", RunStatus::Paused)));
    // Persist the fleet onto the wire, serialize, and reload through the normalizer.
    snapshot.checkpoint_current_run();
    let json = serde_json::to_value(&snapshot).expect("serializes");
    let restored = serde_json::from_value::<AppSnapshot>(json)
        .expect("deserializes")
        .with_profile_defaults();

    let status_of = |id: &str| {
        restored
            .instances()
            .iter()
            .find(|instance| instance.projection.id == id)
            .map(|instance| instance.projection.status)
    };
    assert_eq!(
        status_of("done"),
        Some(RunStatus::Complete),
        "terminal kept"
    );
    assert_eq!(
        status_of("running-1"),
        Some(RunStatus::Paused),
        "running flipped to paused"
    );
    assert_eq!(
        status_of("running-2"),
        Some(RunStatus::Paused),
        "every running instance flipped, not just the active one"
    );
    assert_eq!(
        status_of("already-paused"),
        Some(RunStatus::Paused),
        "already-paused untouched"
    );
    // Each paused run is marked interrupted with a resumable job and an event.
    for id in ["running-1", "running-2"] {
        let instance = restored
            .instances()
            .iter()
            .find(|instance| instance.projection.id == id)
            .unwrap();
        assert!(
            instance.projection.scratchpad.interrupted,
            "{id} interrupted"
        );
        assert!(
            instance
                .projection
                .events
                .iter()
                .any(|event| event.kind == AgentEventKind::Interrupted),
            "{id} has an interrupt event"
        );
        assert!(
            restored.jobs.iter().any(|job| job.id == id
                && job.status == RunStatus::Paused
                && job.checkpoint.is_some()),
            "{id} has a resumable job"
        );
    }
    assert!(
        restored.status.contains("2 paused runs"),
        "status summarizes the fleet recovery, got: {}",
        restored.status
    );
}

// The migration is idempotent: re-running `with_profile_defaults` on an already
// migrated snapshot neither duplicates instances nor re-pauses already-paused runs.
#[test]
fn fleet_migration_is_idempotent() {
    let mut snapshot = AppSnapshot::default();
    snapshot.set_current_run(Some(run_fixture("run-a", RunStatus::Complete)));
    snapshot.set_current_run(Some(run_fixture("run-b", RunStatus::Running)));
    snapshot.checkpoint_current_run();
    let json = serde_json::to_value(&snapshot).expect("serializes");

    let once = serde_json::from_value::<AppSnapshot>(json.clone())
        .expect("deserializes")
        .with_profile_defaults();
    assert_eq!(once.instances().len(), 2);

    // Re-normalize the already-migrated snapshot (a second load pass).
    let twice = once.clone().with_profile_defaults();
    assert_eq!(
        twice.instances().len(),
        2,
        "re-hydrate upserts by id, never duplicates"
    );
    let ids_once: Vec<String> = once
        .instances()
        .iter()
        .map(|instance| instance.projection.id.clone())
        .collect();
    let ids_twice: Vec<String> = twice
        .instances()
        .iter()
        .map(|instance| instance.projection.id.clone())
        .collect();
    assert_eq!(ids_once, ids_twice, "instance set is stable across passes");
    // The run paused on the first load stays paused (not re-flagged) on the second.
    let paused = twice
        .instances()
        .iter()
        .find(|instance| instance.projection.id == "run-b")
        .unwrap();
    assert_eq!(paused.projection.status, RunStatus::Paused);
}

#[test]
fn default_snapshot_has_no_agent_ref_problems() {
    // The bundled defaults must validate cleanly: every agent's tools/strategy/
    // workflow references resolve against the default snapshot.
    let snap = AppSnapshot::default();
    assert!(
        snap.agent_ref_problems().is_empty(),
        "default agents should have no ref problems, got: {:?}",
        snap.agent_ref_problems()
    );
}

#[test]
fn agent_ref_problems_are_reported_into_status() {
    // A bad reference is surfaced loudly in `status`, not silently dropped.
    let mut snap = AppSnapshot::default();
    let mut bad = Agent::new("Bad Agent", "Do work.", vec!["ghost_tool".to_string()]);
    bad.strategy_id = Some("ghost-strategy".to_string());
    snap.agents.push(bad);

    let problems = snap.agent_ref_problems();
    assert_eq!(problems.len(), 2, "got: {problems:?}");

    snap.report_agent_ref_problems();
    assert!(
        snap.status.contains("2 agent reference problem"),
        "status should report the problem count, got: {}",
        snap.status
    );
    assert!(snap.status.contains("ghost_tool"));
    assert!(snap.status.contains("ghost-strategy"));
}

#[test]
fn report_is_noop_when_all_refs_resolve() {
    let mut snap = AppSnapshot::default();
    snap.status = "Ready".to_string();
    snap.report_agent_ref_problems();
    assert_eq!(snap.status, "Ready");
}

#[test]
fn report_preserves_a_meaningful_status_and_appends() {
    // A non-default status (e.g. a run-recovery message) is preserved; the ref-problem
    // summary is appended so neither signal hides the other.
    let mut snap = AppSnapshot::default();
    snap.status = "Recovered a paused run from IndexedDB.".to_string();
    let bad = Agent::new("Bogus", "Do work.", vec!["not_a_tool".to_string()]);
    snap.agents.push(bad);
    snap.report_agent_ref_problems();
    assert!(
        snap.status
            .starts_with("Recovered a paused run from IndexedDB.")
    );
    assert!(snap.status.contains("agent reference problem"));
    assert!(snap.status.contains("not_a_tool"));
}

#[test]
fn with_profile_defaults_surfaces_agent_ref_problems() {
    // The load/normalization path (`with_profile_defaults`) runs the validator, so a
    // malformed reference is caught at load rather than mid-fleet.
    let mut snap = AppSnapshot::default();
    let bad = Agent::new("Bogus", "Do work.", vec!["not_a_tool".to_string()]);
    snap.agents.push(bad);
    let snap = snap.with_profile_defaults();
    assert!(
        snap.status.contains("agent reference problem"),
        "status should flag the bad ref after load, got: {}",
        snap.status
    );
}
