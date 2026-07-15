//! Root layout (kiln `renderApp`): the persistent shell — header, rails,
//! avatar bar — wraps a `<main class="stage">` where the picked stage
//! renders. UI = fold(signals); every command goes through the host facade
//! (ADR-003/013); browser glue (hash, theme attribute, clock) lives in
//! `host::dom`.

use std::rc::Rc;

use dioxus::prelude::*;

use askk_core::{RunId, RunProjection, SignalKind};
use serde_json::{json, Value};

use crate::ui::agents::AgentsStage;
use crate::ui::artifacts::ArtifactsStage;
use crate::ui::chat::ChatStage;
use crate::ui::dashboard::{DashRun, DashboardStage};
use crate::ui::features::FeaturesStage;
use crate::ui::manifest::Stage;
use crate::ui::settings::SettingsStage;
use crate::ui::shell::{AvatarBar, Header, LeftRail, RightRail};
use askk_browser::artifacts::ArtifactDoc;
use askk_browser::boot::{
    self, HarnessHandle, McpServerStatus, NamedProfile, ProfileSet, ProviderProfileForm,
};
use askk_browser::dom;
use askk_browser::speech::{self, SpeechConfig};

const CSS: &str = include_str!("main.css");
const FAVICON: Asset = asset!("/assets/favicon.svg");
const AMARANTE_LATIN: Asset = asset!("/assets/amarante-latin.woff2");
const AMARANTE_LATIN_EXT: Asset = asset!("/assets/amarante-latin-ext.woff2");

/// Self-hosted Amarante (`--font-sans`/`--font-display` in main.css); the
/// unicode-range split matches the kiln next/font export.
fn font_css() -> String {
    format!(
        "@font-face{{font-family:Amarante;font-style:normal;font-weight:400;font-display:swap;\
         src:url('{AMARANTE_LATIN}') format('woff2');\
         unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,\
         U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}}\
         @font-face{{font-family:Amarante;font-style:normal;font-weight:400;font-display:swap;\
         src:url('{AMARANTE_LATIN_EXT}') format('woff2');\
         unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,\
         U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,\
         U+2C60-2C7F,U+A720-A7FF;}}"
    )
}

/// Latest loop signal → the plain-language phase label; the bool marks
/// external (tool) work — the warm accent, kiln-style.
fn phase_label(kind: Option<SignalKind>) -> (String, bool) {
    match kind {
        Some(SignalKind::LlmRequest) => ("thinking".into(), false),
        Some(SignalKind::ParseOutcome { .. }) => ("parsing".into(), false),
        Some(SignalKind::ToolRequested { name, .. }) => (format!("acting: {name}"), true),
        Some(SignalKind::ToolCompleted { .. }) => ("observing".into(), true),
        _ => ("working".into(), false),
    }
}

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
                // Single-agent chat: the Assistant answers directly and uses
                // its own tools (web_search etc.) — no director, no delegation.
                // Fall back to the first card if it isn't configured.
                let cards = h.agents();
                if let Some(a) = cards
                    .iter()
                    .find(|a| a.id == "assistant")
                    .or_else(|| cards.first())
                {
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
        (Some(h), Stage::Dashboard) => runs_newest
            .iter()
            .map(|(id, proj)| DashRun {
                id: id.clone(),
                proj: proj.clone(),
                draft: h.draft(id),
            })
            .collect(),
        _ => Vec::new(),
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
            let form = ProviderProfileForm {
                base_url: "local".into(),
                model: format!("local/{model}"),
                ..ProviderProfileForm::default()
            };
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
                    crate::ui::vm::VmConsole { visible: stage() == Stage::Vm }
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
                                // Single-agent chat: only the Assistant (picker
                                // hidden); full list if no assistant configured.
                                agents: {
                                    let one: Vec<_> = agent_cards
                                        .iter()
                                        .filter(|c| c.id == "assistant")
                                        .cloned()
                                        .collect();
                                    if one.is_empty() { agent_cards.clone() } else { one }
                                },
                                active_agent: agent_id(),
                                elapsed: elapsed.clone(),
                                notice,
                                pending: projection.as_ref().map(|p| p.pending_actions.clone()).unwrap_or_default(),
                                on_send,
                                on_agent: move |id: String| agent_id.set(id),
                                on_stop,
                                on_resolve,
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
