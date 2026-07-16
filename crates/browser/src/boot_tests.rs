//! Host-target tests for the boot facade — split from `boot.rs` to stay
//! under the ADR-012 file-size cap; a `#[path]` child module keeps the same
//! privacy access as an inline `mod tests`.

use super::*;
use askk_core::{RunStatus, SignalKind};

#[test]
fn baked_agents_surface_as_cards() {
    block_on(async {
        let handle = host_session().await.unwrap();
        let cards = handle.agents();
        let ids: Vec<&str> = cards.iter().map(|c| c.id.as_str()).collect();
        // The roster is whatever the served agents/ folder holds (top-level +
        // nested team members); assert the known anchors are present, not an
        // exact list, so adding an agent file is a no-code change.
        for anchor in ["assistant", "researcher", "dev-lead", "programmer"] {
            assert!(
                ids.contains(&anchor),
                "missing agent card '{anchor}' in {ids:?}"
            );
        }
        assert!(cards.iter().all(|c| !c.description.is_empty()));
    });
}

#[test]
fn scripted_happy_path_answers_through_the_facade() {
    block_on(async {
        let handle = host_session().await.unwrap();
        let run = handle.submit("assistant", "say hello").await.unwrap();
        assert_eq!(handle.current_run(), Some(run.clone()));
        handle.drive().await;
        let proj = handle.projection(&run);
        assert_eq!(proj.status, RunStatus::Answered);
        assert_eq!(proj.turns_used, 2);
        assert!(proj
            .messages
            .iter()
            .any(|m| m.content.contains("hello from the harness")));
    });
}

#[test]
fn unknown_agent_is_a_string_error_not_a_panic() {
    block_on(async {
        let handle = host_session().await.unwrap();
        let err = handle.submit("ghost", "hi").await.unwrap_err();
        assert!(err.contains("ghost"));
    });
}

#[test]
fn mid_drive_projection_folds_the_live_buffer() {
    block_on(async {
        let handle = host_session().await.unwrap();
        // A run id the session does not know simulates mid-drive (the
        // run is out of the session map while driving).
        let run_id = RunId::new("live-run");
        handle.buffer.borrow_mut().push(Signal {
            seq: 1,
            run_id: run_id.clone(),
            ts_ms: 0,
            kind: SignalKind::PhaseEntered {
                name: "main".into(),
            },
        });
        let proj = handle.projection(&run_id);
        assert_eq!(proj.status, RunStatus::Running);
        assert!(proj.timeline.iter().any(|t| t.contains("phase: main")));
        // Other runs' signals do not leak into the fold.
        let other = handle.projection(&RunId::new("someone-else"));
        assert!(other.timeline.is_empty());
    });
}

#[test]
fn profiles_save_activate_delete_and_persist() {
    let local = ProviderProfileForm {
        base_url: "http://127.0.0.1:8873/v1".into(),
        model: "gemma-4-12B-it-qat-mxfp8".into(),
        api_key: "local".into(),
        temperature: Some(0.5),
        max_tokens: Some(2048),
    };
    block_on(async {
        let handle = host_session().await.unwrap();
        assert!(handle.get_profiles().profiles.is_empty());
        handle.save_profile("omlx", local.clone()).await.unwrap();
        handle
            .save_profile("cloud", ProviderProfileForm::default())
            .await
            .unwrap();
        // Last save becomes active; activation switches routing.
        assert_eq!(handle.get_profiles().active, "cloud");
        handle.activate_profile("omlx").await.unwrap();
        assert_eq!(handle.get_profiles().active_form(), local);
        assert!(handle.activate_profile("ghost").await.is_err());
        assert!(handle.save_profile("  ", local.clone()).await.is_err());
        // Persisted under its own key, not just cached.
        let stored = handle
            .settings
            .provider_profile("omlx")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(profile_from_json(&stored), local);
        // Deleting the active profile falls back to the one left.
        handle.delete_profile("omlx").await.unwrap();
        assert_eq!(handle.get_profiles().active, "cloud");
        assert_eq!(
            handle.settings.provider_profile("omlx").await.unwrap(),
            None
        );
    });
}

#[test]
fn cancel_lands_the_interrupted_terminal_on_a_parked_run() {
    block_on(async {
        let handle = host_session().await.unwrap();
        let run = handle.submit("assistant", "say hello").await.unwrap();
        handle.cancel().await;
        assert_eq!(handle.projection(&run).status, RunStatus::Interrupted);
    });
}

#[test]
fn runs_lists_submitted_and_buffer_observed_runs_newest_first() {
    block_on(async {
        let handle = host_session().await.unwrap();
        let first = handle.submit("assistant", "one").await.unwrap();
        handle.drive().await;
        // A delegate run seen only through the live buffer.
        let ghost = RunId::new("delegate-run");
        handle.buffer.borrow_mut().push(Signal {
            seq: 1,
            run_id: ghost.clone(),
            ts_ms: 0,
            kind: SignalKind::PhaseEntered {
                name: "main".into(),
            },
        });
        let runs = handle.runs();
        let ids: Vec<&RunId> = runs.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec![&ghost, &first]);
        assert_eq!(runs[1].1.status, RunStatus::Answered);
    });
}

#[test]
fn draft_accumulates_deltas_and_clears_on_response() {
    block_on(async {
        let handle = host_session().await.unwrap();
        let run_id = RunId::new("r-draft");
        let push = |kind: SignalKind| {
            handle.buffer.borrow_mut().push(Signal {
                seq: 0,
                run_id: run_id.clone(),
                ts_ms: 0,
                kind,
            });
        };
        push(SignalKind::LlmRequest);
        push(SignalKind::LlmDelta { text: "hel".into() });
        push(SignalKind::LlmDelta { text: "lo".into() });
        assert_eq!(handle.draft(&run_id), "hello");
        assert_eq!(
            handle.latest_activity(&run_id),
            Some(SignalKind::LlmRequest)
        );
        push(SignalKind::LlmResponse {
            text: "hello".into(),
        });
        assert_eq!(handle.draft(&run_id), "");
    });
}

#[test]
fn resume_seeds_prior_epoch_runs_and_surfaces_log_health() {
    use askk_engine::state::{BlobStore, MemBlob};

    block_on(async {
        let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
        // Epoch 1: one terminal run and one zombie (RunStarted only), then
        // the session dies without cleanup.
        {
            let (mut log, _) = SignalLog::open(blobs.clone(), Box::new(|| 0))
                .await
                .unwrap();
            let done = RunId::new("old-done");
            log.append(
                SignalKind::RunStarted {
                    agent_id: "assistant".into(),
                    goal: "old goal".into(),
                },
                done.clone(),
            )
            .await
            .unwrap();
            log.append(
                SignalKind::StatusSet {
                    status: RunStatus::Answered,
                },
                done,
            )
            .await
            .unwrap();
            log.append(
                SignalKind::RunStarted {
                    agent_id: "assistant".into(),
                    goal: "hang forever".into(),
                },
                RunId::new("old-zombie"),
            )
            .await
            .unwrap();
        }

        // Epoch 2 boots over the same store: replay + fence + seed.
        let handle = host_session_with(blobs).await.unwrap();
        let statuses: Vec<(RunId, RunStatus)> = handle
            .runs()
            .into_iter()
            .map(|(id, proj)| (id, proj.status))
            .collect();
        assert_eq!(
            statuses,
            vec![
                (RunId::new("old-zombie"), RunStatus::Interrupted), // fenced
                (RunId::new("old-done"), RunStatus::Answered),
            ]
        );
        // Raw signals are observable per run and filtered by id.
        assert!(!handle.signals(&RunId::new("old-done")).is_empty());
        assert!(handle.signals(&RunId::new("someone-else")).is_empty());
        let health = handle.log_health();
        assert!(health.epoch >= 2, "epoch: {}", health.epoch);
        assert!(!health.degraded);
        assert_eq!(health.quarantined, 0);

        // A fresh submit sorts ABOVE the prior-epoch exhibits.
        let fresh = handle.submit("assistant", "new work").await.unwrap();
        let ids: Vec<RunId> = handle.runs().into_iter().map(|(id, _)| id).collect();
        assert_eq!(
            ids,
            vec![fresh, RunId::new("old-zombie"), RunId::new("old-done")]
        );
    });
}

#[test]
fn clear_history_forgets_terminal_runs_and_the_archive_but_spares_live_ones() {
    use askk_engine::state::{BlobStore, MemBlob};

    block_on(async {
        let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
        let handle = host_session_with(blobs.clone()).await.unwrap();
        let done = handle.submit("assistant", "say hello").await.unwrap();
        handle.drive().await;
        assert_eq!(handle.projection(&done).status, RunStatus::Answered);
        assert!(!blobs.list("seg-").await.unwrap().is_empty());
        // A REAL non-terminal run: submitted, in the session map, never driven.
        let parked = handle.submit("assistant", "wait for me").await.unwrap();
        // A run still driving (out of the session map, live in the buffer).
        let live = RunId::new("still-driving");
        handle.buffer.borrow_mut().push(Signal {
            seq: 99,
            run_id: live.clone(),
            ts_ms: 0,
            kind: SignalKind::PhaseEntered {
                name: "main".into(),
            },
        });

        handle.clear_history().await.unwrap();

        // The answered run is gone from the list, the fold, and the archive;
        // both live runs — the real parked one and the driving one — stay.
        let ids: Vec<RunId> = handle.runs().into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec![live.clone(), parked.clone()]);
        assert!(handle.projection(&done).messages.is_empty());
        assert!(blobs.list("seg-").await.unwrap().is_empty());
        // Focus survives on a run that survived.
        assert_eq!(handle.current_run(), Some(parked.clone()));
        // A clear mid-run is not a wipe: the parked run keeps its whole fold,
        // and the driving run keeps its live signals.
        let proj = handle.projection(&parked);
        assert_eq!(proj.status, RunStatus::Running);
        assert!(proj.timeline.iter().any(|t| t.contains("wait for me")));
        assert_eq!(handle.projection(&live).status, RunStatus::Running);
        assert!(!handle.signals(&live).is_empty());
    });
}

#[test]
fn prefs_round_trip_through_the_session_store() {
    block_on(async {
        let handle = host_session().await.unwrap();
        assert_eq!(handle.get_pref("ui").await, None);
        handle
            .set_pref("ui", serde_json::json!({"theme": "amber"}))
            .await;
        let stored = handle.get_pref("ui").await.unwrap();
        assert_eq!(stored["theme"], "amber");
    });
}

#[test]
fn mcp_servers_cell_and_pref_round_trip() {
    block_on(async {
        let handle = host_session().await.unwrap();
        assert_eq!(handle.mcp_servers(), "");
        handle.set_mcp_servers("https://a.example/mcp").await;
        assert_eq!(handle.mcp_servers(), "https://a.example/mcp");
        let stored = handle.get_pref("mcp_servers").await.unwrap();
        assert_eq!(stored, serde_json::Value::from("https://a.example/mcp"));
    });
}
