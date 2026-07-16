//! Persistent shell chrome (kiln `view.js` header/left/right/avatar): the
//! header bar, the Components rail, the Inspector rail, and the bottom
//! activity bar. Child stages render only inside `<main class="stage">`
//! (owner directive) — these regions never remount on navigation.

use dioxus::prelude::*;

use askk_browser::boot::LogHealth;
use askk_core::{Message, Signal};

use crate::ui::components::manifest::{Stage, COMPONENTS};

/// Inspector row for one raw signal: the serde `kind` tag + a short summary
/// of the payload fields (truncated ~120 chars).
fn signal_row(s: &Signal) -> (String, String) {
    let value = serde_json::to_value(&s.kind).unwrap_or_default();
    let kind = value
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let mut payload = match &value {
        serde_json::Value::Object(map) => map
            .iter()
            .filter(|(k, _)| k.as_str() != "kind")
            .map(|(k, v)| format!("{k}: {v}"))
            .collect::<Vec<_>>()
            .join("  "),
        _ => String::new(),
    };
    if payload.chars().count() > 120 {
        payload = payload.chars().take(120).collect::<String>() + "…";
    }
    (kind, payload)
}

#[component]
pub fn Header(
    stage: Stage,
    busy: bool,
    left_open: bool,
    right_open: bool,
    on_toggle_left: EventHandler<()>,
    on_toggle_right: EventHandler<()>,
) -> Element {
    rsx! {
        header { class: "header",
            div { class: "cluster",
                button {
                    class: if left_open { "icon-btn on" } else { "icon-btn" },
                    title: "Toggle components",
                    aria_label: "Toggle components drawer",
                    aria_expanded: left_open,
                    onclick: move |_| on_toggle_left.call(()),
                    "◧"
                }
                div { class: "brand",
                    span { class: "logo", "ASKK" }
                    span { class: "logo-sub", "harness" }
                }
                span { class: "crumb", "／ {stage.key()}" }
            }
            div { class: "cluster",
                span { class: "ready-pill",
                    span { class: if busy { "dot-busy" } else { "dot-green" } }
                    if busy { "working" } else { "ready" }
                }
                button {
                    class: if right_open { "icon-btn on" } else { "icon-btn" },
                    title: "Toggle inspector",
                    aria_label: "Toggle inspector drawer",
                    aria_expanded: right_open,
                    onclick: move |_| on_toggle_right.call(()),
                    "◨"
                }
            }
        }
    }
}

#[component]
pub fn LeftRail(stage: Stage, open: bool, on_pick: EventHandler<Stage>) -> Element {
    rsx! {
        aside { class: if open { "panel panel-left" } else { "panel panel-left closed" },
            div { class: "panel-inner",
                div { class: "section-label", "Components" }
                div { class: "module-list",
                    for c in COMPONENTS {
                        button {
                            key: "{c.stage.key()}",
                            class: if stage == c.stage { "module-row active" } else { "module-row" },
                            aria_label: "Open {c.stage.key()}",
                            aria_current: if stage == c.stage { "page" } else { "false" },
                            onclick: move |_| on_pick.call(c.stage),
                            span { class: "dot", style: "background:{c.dot}" }
                            span { class: "module-name", "{c.stage.key()}" }
                            span { class: "meta-tag", "{c.meta}" }
                        }
                    }
                }
            }
        }
    }
}

/// Inspector rail: Messages = the active run's raw prompt messages,
/// Signals = the run's raw stamped signals, plus a log-health chip.
#[component]
pub fn RightRail(
    open: bool,
    tab: String,
    agent: Option<String>,
    messages: Vec<Message>,
    signals: Vec<Signal>,
    health: Option<LogHealth>,
    on_tab: EventHandler<String>,
) -> Element {
    let sub = agent.unwrap_or_else(|| "—".into());
    // Stale persisted tab prefs ("Skills"/"Supplies") normalize to Messages.
    let tab = if tab == "Signals" {
        tab
    } else {
        "Messages".to_string()
    };
    // At most the last ~200 signals — the rail is a peek, not the archive.
    let rows: Vec<(String, String)> = signals
        .iter()
        .skip(signals.len().saturating_sub(200))
        .map(signal_row)
        .collect();
    rsx! {
        aside { class: if open { "panel panel-right" } else { "panel panel-right closed" },
            div { class: "panel-inner",
                div { class: "inspector-head",
                    span { class: "inspector-title", "Inspector" }
                    if let Some(h) = health {
                        if h.degraded || h.quarantined > 0 {
                            span { class: "ready-pill",
                                title: "degraded: {h.degraded}, quarantined: {h.quarantined}",
                                span { class: "dot-busy" }
                                "epoch {h.epoch}"
                            }
                        } else {
                            span { class: "meta-tag", title: "signal log healthy",
                                "epoch {h.epoch}"
                            }
                        }
                    }
                    span { class: "inspector-sub", "{sub}" }
                }
                div { class: "tabs",
                    for name in ["Messages", "Signals"] {
                        button {
                            key: "{name}",
                            class: if tab == name { "tab on" } else { "tab" },
                            onclick: move |_| on_tab.call(name.to_string()),
                            "{name}"
                        }
                    }
                }
                if tab == "Signals" {
                    if rows.is_empty() {
                        div { class: "inspector-empty", "no signals yet" }
                    } else {
                        div { class: "prompt",
                            for (i, (kind, payload)) in rows.iter().enumerate() {
                                div { key: "{i}", class: "prompt-msg",
                                    div { class: "prompt-role", "{kind}" }
                                    pre { class: "prompt-content", "{payload}" }
                                }
                            }
                        }
                    }
                } else if messages.is_empty() {
                    div { class: "inspector-empty", "nothing to inspect yet" }
                } else {
                    div { class: "prompt",
                        for (i, m) in messages.iter().enumerate() {
                            div { key: "{i}", class: "prompt-msg",
                                div { class: "prompt-role", "{m.role:?}" }
                                pre { class: "prompt-content", "{m.content}" }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// The bottom bar is the persistent activity centre: idle shows the orb;
/// while a run works it becomes a CSS pulse dot + the current phase label,
/// with the elapsed clock on the right. Reduced motion → the dot goes
/// static via CSS; the label still carries the meaning.
#[component]
#[allow(clippy::too_many_arguments)] // ponytail: the bar's full control surface
pub fn AvatarBar(
    busy: bool,
    label: String,
    warm: bool,
    elapsed: Option<String>,
    recording: bool,
    speech_busy: bool,
    on_mic: EventHandler<()>,
    on_speak: EventHandler<()>,
) -> Element {
    rsx! {
        div { class: "avatar-bar",
            div { class: "avatar-controls",
                button {
                    class: if recording { "icon-btn rec" } else { "icon-btn" },
                    title: if recording { "Stop and transcribe" } else { "Speak to the agent" },
                    disabled: speech_busy && !recording,
                    onclick: move |_| on_mic.call(()),
                    "🎙"
                }
                button {
                    class: "icon-btn",
                    title: "Read the last answer aloud",
                    disabled: speech_busy,
                    onclick: move |_| on_speak.call(()),
                    "🔊"
                }
            }
            div { class: "activity-center",
                if busy {
                    span { class: if warm { "pulse-dot lg warm" } else { "pulse-dot lg" } }
                } else {
                    div { class: "avatar-orb" }
                }
                div { class: "orb-label", if busy { "{label}" } else { "idle" } }
            }
            div { class: "avatar-controls right",
                if busy {
                    if let Some(t) = elapsed {
                        span { class: "activity-elapsed", "{t}" }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::{RunId, SignalKind};

    fn sig(kind: SignalKind) -> Signal {
        Signal {
            seq: 1,
            run_id: RunId::new("r1"),
            ts_ms: 0,
            kind,
        }
    }

    #[test]
    fn signal_row_tags_kind_and_summarizes_payload() {
        let (kind, payload) = signal_row(&sig(SignalKind::PhaseEntered {
            name: "plan".into(),
        }));
        assert_eq!(kind, "phase_entered");
        assert!(payload.contains("name") && payload.contains("plan"));
        // Field-less kinds row cleanly with an empty payload.
        let (kind, payload) = signal_row(&sig(SignalKind::LlmRequest));
        assert_eq!(kind, "llm_request");
        assert!(payload.is_empty());
    }

    #[test]
    fn signal_row_truncates_long_payloads() {
        let (_, payload) = signal_row(&sig(SignalKind::LlmResponse {
            text: "x".repeat(500),
        }));
        assert!(payload.chars().count() <= 121, "len: {}", payload.len());
        assert!(payload.ends_with('…'));
    }
}
