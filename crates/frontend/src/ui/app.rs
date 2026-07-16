//! Root layout (kiln `renderApp`): the persistent shell — header, rails,
//! avatar bar — wraps a `<main class="stage">` where the picked stage
//! renders. UI = fold(signals); every command goes through the host facade
//! (ADR-003/013); browser glue (hash, theme attribute, clock) lives in
//! `host::dom`.

use std::rc::Rc;

use dioxus::prelude::*;

use askk_core::{RunId, RunProjection};
use serde_json::{json, Value};

use crate::ui::components::fonts::{font_css, FAVICON};
use crate::ui::components::manifest::Stage;
use crate::ui::components::runcard::{phase_label, DashRun};
use crate::ui::components::shell::{AvatarBar, Header, LeftRail, RightRail};
use crate::ui::features::agents::AgentsStage;
use crate::ui::features::artifacts::ArtifactsStage;
use crate::ui::features::chat::ChatStage;
use crate::ui::features::dashboard::DashboardStage;
use crate::ui::features::fleet::FleetStage;
use crate::ui::features::lab::FeaturesStage;
use crate::ui::features::settings::SettingsStage;
use askk_browser::artifacts::ArtifactDoc;
use askk_browser::boot::{self, HarnessHandle, McpServerStatus, NamedProfile, ProfileSet};
use askk_browser::dom;
use askk_browser::speech::{self, SpeechConfig};

const CSS: &str = include_str!("main.css");

fn elapsed_label(start_ms: u64) -> String {
    let ms = dom::now_ms().saturating_sub(start_ms);
    format!("{:.1}s", ms as f64 / 1000.0)
}

#[component]
pub fn App() -> Element {
    // Bumped by the host on every stamped signal — reading it below
    // subscribes the view, so each signal triggers a refold (cheap here).
    let refold = use_signal(|| 0u64);
    let mut handle = use_signal(|| Option::<Rc<HarnessHandle>>::None);
    let mut boot_error = use_signal(|| Option::<String>::None);
    let mut ui_error = use_signal(|| Option::<String>::None);
    let mut current = use_signal(|| Option::<RunId>::None);
    let mut agent_id = use_signal(String::new);
    let mut profiles = use_signal(ProfileSet::default);
    let mut busy = use_signal(|| false);
    let mut recording = use_signal(|| false);
    let mut speech_busy = use_signal(|| false);
    let mut speech_cfg = use_signal(SpeechConfig::default);
    let mut searxng_url = use_signal(String::new);
    let mut mcp_servers = use_signal(String::new);
    let mut mcp_status = use_signal(Vec::<McpServerStatus>::new);
    let mut run_start = use_signal(|| 0u64);
    // Persisted UI prefs (kiln appstate): stage, theme, rails, inspector tab.
    let mut stage = use_signal(|| Stage::Chat);
    let mut theme = use_signal(|| "paper".to_string());
    // Overlay mode (≤900px) starts with both drawers closed; docked mode
    // starts open (persisted prefs may override, see the boot block).
    let mut left_open = use_signal(|| dom::viewport_width() > 900);
    let mut right_open = use_signal(|| dom::viewport_width() > 900);
    let mut tab = use_signal(|| "Skills".to_string());

    let persist = move || {
        let Some(h) = handle() else { return };
        let value = json!({
            "stage": stage().key(),
            "theme": theme(),
            "left_open": left_open(),
            "right_open": right_open(),
            "tab": tab(),
        });
        spawn(async move { h.set_pref("ui", value).await });
    };

    use_future(move || async move {
        let notify: Box<dyn Fn()> = Box::new(move || {
            let mut counter = refold;
            counter += 1;
        });
        match boot::session(notify).await {
            Ok(h) => {
                if let Some(w) = h.storage_warning() {
                    ui_error.set(Some(w));
                }
                profiles.set(h.get_profiles());
                // Default agent = FIRST ENABLED agent in manifest order
                // (ADR-045): build_handle assembles cards in manifest order
                // filtered by enabled, so reordering assets/agents/
                // manifest.json IS how the default is changed — no
                // hardcoded id in the UI.
                if let Some(a) = h.agents().first() {
                    agent_id.set(a.id.clone());
                }
                if let Some(v) = h.get_pref("speech").await {
                    speech_cfg.set(SpeechConfig::from_json(&v));
                }
                searxng_url.set(h.searxng_url());
                mcp_servers.set(h.mcp_servers());
                mcp_status.set(h.mcp_status());
                if let Some(prefs) = h.get_pref("ui").await {
                    if let Some(t) = prefs.get("theme").and_then(Value::as_str) {
                        theme.set(t.to_string());
                    }
                    if let Some(s) = prefs.get("stage").and_then(Value::as_str) {
                        if let Some(s) = Stage::from_key(s) {
                            stage.set(s);
                        }
                    }
                    // Narrow viewports render drawers as overlays that cover
                    // the stage — never boot with them open there, whatever a
                    // wider session persisted.
                    if dom::viewport_width() > 900 {
                        if let Some(b) = prefs.get("left_open").and_then(Value::as_bool) {
                            left_open.set(b);
                        }
                        if let Some(b) = prefs.get("right_open").and_then(Value::as_bool) {
                            right_open.set(b);
                        }
                    }
                    if let Some(t) = prefs.get("tab").and_then(Value::as_str) {
                        tab.set(t.to_string());
                    }
                }
                // Deep link wins over the persisted stage.
                if let Some(s) = dom::read_hash().and_then(|k| Stage::from_key(&k)) {
                    stage.set(s);
                }
                dom::apply_theme(&theme());
                dom::write_hash(stage().key());
                handle.set(Some(Rc::new(h)));
            }
            Err(e) => boot_error.set(Some(e)),
        }
    });

    // Artifact docs: published through a tool, whose signals bump `refold`.
    let mut artifact_docs = use_signal(Vec::<ArtifactDoc>::new);
    use_effect(move || {
        let _ = refold();
        if stage() != Stage::Artifacts {
            return;
        }
        let Some(h) = handle() else { return };
        spawn(async move { artifact_docs.set(h.artifacts().await) });
    });

    // The elapsed clock: ticks while a run drives (host stub never ticks).
    let tick = use_signal(|| 0u64);
    use_future(move || async move {
        loop {
            dom::sleep_ms(400).await;
            if busy() {
                let mut t = tick;
                t += 1;
            }
        }
    });

    let _subscribe = (refold(), tick());
    let runs_newest = handle().map(|h| h.runs()).unwrap_or_default();
    let runs_oldest: Vec<RunProjection> = runs_newest
        .iter()
        .rev()
        .map(|(_, proj)| proj.clone())
        .collect();
    let projection: Option<RunProjection> = match (handle(), current()) {
        (Some(h), Some(run_id)) => Some(h.projection(&run_id)),
        _ => None,
    };
    let (phase, warm) = phase_label(match (handle(), current()) {
        (Some(h), Some(run_id)) => h.latest_activity(&run_id),
        _ => None,
    });
    let draft = match (handle(), current()) {
        (Some(h), Some(run_id)) => h.draft(&run_id),
        _ => String::new(),
    };
    let elapsed = elapsed_label(run_start());
    // Wall tiles: the fold plus each run's live streaming tail — assembled
    // only while the dashboard is the picked stage (draft scans the buffer).
    let dash_runs: Vec<DashRun> = match (handle(), stage()) {
        (Some(h), Stage::Dashboard | Stage::Fleet) => runs_newest
            .iter()
            .map(|(id, proj)| DashRun {
                id: id.clone(),
                proj: proj.clone(),
                draft: h.draft(id),
            })
            .collect(),
        _ => Vec::new(),
    };
    // Inspector rail data, only while the rail is open (signals clone the
    // live buffer slice — skip that on every refold when the rail is closed).
    let (rail_signals, rail_health) = match (handle(), current(), right_open()) {
        (Some(h), Some(id), true) => (h.signals(&id), Some(h.log_health())),
        (Some(h), None, true) => (Vec::new(), Some(h.log_health())),
        _ => (Vec::new(), None),
    };
    let agent_cards = handle().map(|h| h.agents()).unwrap_or_default();
    let agent_name = agent_cards
        .iter()
        .find(|a| a.id == agent_id())
        .map(|a| a.name.clone())
        .unwrap_or_else(|| "agent".into());

    let on_pick = move |s: Stage| {
        stage.set(s);
        dom::write_hash(s.key());
        // Overlay mode: picking a stage is a destination — close the drawer
        // so the stage is immediately visible and clickable.
        if dom::viewport_width() <= 900 {
            left_open.set(false);
        }
        persist();
    };
    let on_theme = move |id: String| {
        dom::apply_theme(&id);
        theme.set(id);
        persist();
    };
    let on_send = move |goal: String| {
        let Some(h) = handle() else { return };
        // No busy gate: every send is its own run; runs drive in parallel
        // (switch agent and send again while one is still working).
        let agent = agent_id();
        busy.set(true);
        ui_error.set(None);
        run_start.set(dom::now_ms());
        spawn(async move {
            match h.submit(&agent, &goal).await {
                Ok(run_id) => {
                    current.set(Some(run_id.clone()));
                    h.drive_run(&run_id).await;
                    // Only the run still in chat focus clears the busy pulse.
                    if current() == Some(run_id) {
                        busy.set(false);
                    }
                }
                Err(e) => {
                    ui_error.set(Some(e));
                    busy.set(false);
                }
            }
            let mut counter = refold;
            counter += 1;
        });
    };
    let on_stop = move |_| {
        let Some(h) = handle() else { return };
        spawn(async move { h.cancel().await });
    };
    // Clear the chat: terminal runs go, live ones stay (ADR-046) — read the
    // focus back from the facade, which drops it only if it was cleared.
    let on_clear = move |_| {
        let Some(h) = handle() else { return };
        spawn(async move {
            if let Err(e) = h.clear_history().await {
                ui_error.set(Some(e));
            }
            current.set(h.current_run());
            let mut counter = refold;
            counter += 1;
        });
    };
    // Fleet (ADR-042): launch a chosen agent as its own parallel loop by
    // reusing the chat submit path — set the agent, then send. Cancel targets
    // one run by id.
    let on_launch = move |(agent, goal): (String, String)| {
        agent_id.set(agent);
        let mut send = on_send;
        send(goal);
    };
    let on_cancel_run = move |run_id: RunId| {
        if let Some(h) = handle() {
            spawn(async move { h.cancel_run(&run_id).await });
        }
    };
    let on_resolve = move |(action_id, approve): (String, bool)| {
        let Some(h) = handle() else { return };
        spawn(async move {
            h.resolve(&action_id, approve).await;
            let mut counter = refold;
            counter += 1;
        });
    };
    let on_save_profile = move |p: NamedProfile| {
        let Some(h) = handle() else { return };
        spawn(async move {
            if let Err(e) = h.save_profile(&p.name, p.form).await {
                ui_error.set(Some(e));
            }
            profiles.set(h.get_profiles());
        });
    };
    let on_select_profile = move |name: String| {
        let Some(h) = handle() else { return };
        spawn(async move {
            if let Err(e) = h.activate_profile(&name).await {
                ui_error.set(Some(e));
            }
            profiles.set(h.get_profiles());
        });
    };
    let on_delete_profile = move |name: String| {
        let Some(h) = handle() else { return };
        spawn(async move {
            if let Err(e) = h.delete_profile(&name).await {
                ui_error.set(Some(e));
            }
            profiles.set(h.get_profiles());
        });
    };
    let on_speech_cfg = move |cfg: SpeechConfig| {
        let Some(h) = handle() else { return };
        speech_cfg.set(cfg.clone());
        spawn(async move { h.set_pref("speech", cfg.to_json()).await });
    };
    // Features lab "add as provider": the in-browser model is an ADDITION, not a
    // substitute — upsert a dedicated "in-browser" profile ALONGSIDE the external
    // ones without switching to it (the user activates it in Settings if wanted).
    let on_use_default = move |model: String| {
        let Some(h) = handle() else { return };
        spawn(async move {
            let form = askk_browser::profile::local_profile_form(&model);
            let _ = h.save_profile("in-browser", form).await;
            profiles.set(h.get_profiles());
        });
    };
    // Live cell: the next web_search call uses the new instance, no rebuild.
    let on_searxng = move |url: String| {
        let Some(h) = handle() else { return };
        searxng_url.set(url.clone());
        spawn(async move { h.set_searxng_url(&url).await });
    };
    // Persist only: MCP tools register at boot, so edits apply on reload.
    let on_mcp_servers = move |text: String| {
        let Some(h) = handle() else { return };
        mcp_servers.set(text.clone());
        spawn(async move { h.set_mcp_servers(&text).await });
    };
    // Mic = push-to-talk: first click records, second click transcribes and
    // sends the transcript to the active agent (RealtimeSTT's text() shape).
    let on_mic = move |_| {
        if recording() {
            recording.set(false);
            speech_busy.set(true);
            spawn(async move {
                let mut send = on_send;
                match speech::record_stop_transcribe(&speech_cfg().stt_model).await {
                    Ok(text) if !text.is_empty() => send(text),
                    Ok(_) => ui_error.set(Some("mic heard nothing transcribable".into())),
                    Err(e) => ui_error.set(Some(e)),
                }
                speech_busy.set(false);
            });
        } else {
            spawn(async move {
                match speech::record_start().await {
                    Ok(()) => recording.set(true),
                    Err(e) => ui_error.set(Some(e)),
                }
            });
        }
    };
    // Speaker = read the newest answer aloud (kokoro by default).
    let on_speak = move |_| {
        let Some(h) = handle() else { return };
        speech_busy.set(true);
        spawn(async move {
            let answer = h.runs().into_iter().find_map(|(_, proj)| {
                proj.messages
                    .iter()
                    .rev()
                    .find(|m| m.role == askk_core::Role::Assistant)
                    .map(|m| m.content.clone())
            });
            match answer {
                Some(text) => {
                    let cfg = speech_cfg();
                    if let Err(e) = speech::speak(&text, &cfg.tts_model, &cfg.voice).await {
                        ui_error.set(Some(e));
                    }
                }
                None => ui_error.set(Some("nothing to read yet".into())),
            }
            speech_busy.set(false);
        });
    };

    // Hoisted so the Style element's props stay stable across renders.
    let font_face = use_hook(font_css);
    let cols = format!(
        "grid-template-columns: {} 1fr {}",
        if left_open() { "var(--left-w)" } else { "0px" },
        if right_open() {
            "var(--right-w)"
        } else {
            "0px"
        },
    );
    let notice = boot_error().or(ui_error());

    rsx! {
        document::Title { "ASKK" }
        document::Link { rel: "icon", r#type: "image/svg+xml", href: FAVICON.to_string() }
        document::Style { {CSS} }
        document::Style { {font_face} }
        div { class: "app",
            Header {
                stage: stage(),
                busy: busy(),
                left_open: left_open(),
                right_open: right_open(),
                on_toggle_left: move |_| { left_open.toggle(); persist(); },
                on_toggle_right: move |_| { right_open.toggle(); persist(); },
            }
            div { class: "body", style: "{cols}",
                // Overlay-mode scrim: sits under the fixed drawers (≤900px
                // only, display:none otherwise); a tap closes whatever is
                // open instead of the drawer swallowing stage clicks.
                if left_open() || right_open() {
                    div {
                        class: "scrim",
                        onclick: move |_| {
                            left_open.set(false);
                            right_open.set(false);
                            persist();
                        },
                    }
                }
                LeftRail { stage: stage(), open: left_open(), on_pick }
                main { class: "stage",
                    // Persistent VM console: mounted once, booted at load,
                    // visible only on the VM stage (so `shell` works anywhere).
                    crate::ui::features::vm::VmConsole { visible: stage() == Stage::Vm }
                    match stage() {
                        Stage::Vm => rsx! {},
                        Stage::Chat => rsx! {
                            ChatStage {
                                runs: runs_oldest,
                                busy: busy(),
                                draft,
                                phase: phase.clone(),
                                warm,
                                agent: agent_name,
                                // Multi-agent (ADR-042): the picker shows every
                                // enabled agent — Orchestrator, specialists, or
                                // launch a whole fleet from the Fleet stage.
                                agents: agent_cards.clone(),
                                active_agent: agent_id(),
                                elapsed: elapsed.clone(),
                                notice,
                                pending: projection.as_ref().map(|p| p.pending_actions.clone()).unwrap_or_default(),
                                on_send,
                                on_agent: move |id: String| agent_id.set(id),
                                on_stop,
                                on_clear,
                                on_resolve,
                            }
                        },
                        Stage::Fleet => rsx! {
                            FleetStage {
                                agents: agent_cards.clone(),
                                runs: dash_runs,
                                on_launch,
                                on_cancel: on_cancel_run,
                            }
                        },
                        Stage::Agents => rsx! { AgentsStage { runs: runs_newest.clone() } },
                        Stage::Features => rsx! { FeaturesStage { on_use_default } },
                        Stage::Dashboard => rsx! { DashboardStage { runs: dash_runs } },
                        Stage::Artifacts => rsx! {
                            ArtifactsStage { docs: artifact_docs(), now_ms: dom::now_ms() }
                        },
                        Stage::Settings => rsx! {
                            SettingsStage {
                                key: "{profiles().active}",
                                profiles: profiles(),
                                theme: theme(),
                                speech: speech_cfg(),
                                searxng: searxng_url(),
                                mcp_servers: mcp_servers(),
                                mcp_status: mcp_status(),
                                on_save: on_save_profile,
                                on_select: on_select_profile,
                                on_delete: on_delete_profile,
                                on_theme,
                                on_speech: on_speech_cfg,
                                on_searxng,
                                on_mcp_servers,
                            }
                        },
                    }
                }
                RightRail {
                    open: right_open(),
                    tab: tab(),
                    agent: current().map(|_| agent_id()),
                    messages: projection.map(|p| p.messages).unwrap_or_default(),
                    signals: rail_signals,
                    health: rail_health,
                    on_tab: move |t: String| { tab.set(t); persist(); },
                }
            }
            AvatarBar {
                busy: busy(),
                label: phase,
                warm,
                elapsed: busy().then_some(elapsed),
                recording: recording(),
                speech_busy: speech_busy(),
                on_mic,
                on_speak,
            }
        }
    }
}
