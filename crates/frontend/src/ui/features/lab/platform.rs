//! Platform / Safari panel: the OS-reach surfaces WebKit/iOS actually exposes,
//! pulled from the one capability probe and filtered to a Safari-relevant
//! allowlist (standalone PWA, Web Share, notifications, clipboard, permissions,
//! battery, WebGPU, storage), plus two live OS-reach tests — Web Share (the
//! marquee iOS capability) and Vibration. Backed by
//! `askk_browser::capabilities::{probe, system}`; nothing here touches the
//! engine (ADR-041).

use askk_browser::capabilities::{self, system, CapabilityEntry, CapabilityStatus};
use dioxus::prelude::*;

/// Safari/WebKit/iOS-relevant probe ids, in display order. Anything not present
/// in the report (older browsers, host build) is silently skipped.
const ALLOWLIST: &[&str] = &[
    "pwa",
    "share",
    "notifications",
    "clipboard",
    "vibration",
    "wake_lock",
    "battery",
    "webgpu",
    "permissions",
    "opfs",
    "storage_quota",
    "hardware",
];

/// `(status dot class, word)` for a probed capability — the dot is coloured by
/// the `.s-*` class, the word labels it in text.
fn status_class(status: CapabilityStatus) -> (&'static str, &'static str) {
    match status {
        CapabilityStatus::Yes => ("s-yes", "yes"),
        CapabilityStatus::Partial => ("s-partial", "partial"),
        CapabilityStatus::No => ("s-no", "no"),
    }
}

/// One probed capability as a `.feat-card`: label + status dot/word, and the
/// probe's detail line when it carries one.
fn cap_card(entry: &CapabilityEntry) -> Element {
    let (dot, word) = status_class(entry.status);
    rsx! {
        div { class: "feat-card", key: "{entry.id}",
            div { class: "feat-card-title", "{entry.label}",
                span { class: "feat-status {dot}", "{word}" }
            }
            if !entry.detail.is_empty() {
                div { class: "feat-detail", "{entry.detail}" }
            }
        }
    }
}

#[component]
pub fn PlatformPanel() -> Element {
    let probe = use_resource(|| async move { capabilities::probe().await });

    // Web Share inputs + result.
    let mut share_title = use_signal(|| "ASKK".to_string());
    let mut share_text = use_signal(|| "Testing Web Share from the Features lab".to_string());
    let mut share_url = use_signal(|| "https://".to_string());
    let mut share_out = use_signal(String::new);

    // Vibration duration (kept as a String so the number field round-trips) + result.
    let mut vibrate_ms = use_signal(|| "200".to_string());
    let mut vibrate_out = use_signal(String::new);

    // Held only long enough to build owned nodes; the guard drops with this stmt.
    let cards = match &*probe.read_unchecked() {
        None => rsx! {
            div { class: "feat-sub", "Probing browser capabilities…" }
        },
        Some(Err(err)) => rsx! {
            div { class: "feat-err", "Capability probe failed: {err}" }
        },
        Some(Ok(report)) => rsx! {
            div { class: "feat-grid",
                for id in ALLOWLIST.iter().copied() {
                    if let Some(entry) = report.entries.iter().find(|e| e.id == id) {
                        {cap_card(entry)}
                    }
                }
            }
        },
    };

    rsx! {
        div { class: "feat-detail",
            "WebKit/iOS exposes fewer sensor APIs than Chromium, but standalone-PWA (add to home screen), Web Share, and notifications are its OS reach. Share/clipboard need a secure context + a user gesture."
        }

        div { class: "feat-group-title", "OS reach & Safari surfaces" }
        {cards}

        div { class: "feat-group-title", "Interactive tests" }
        div { class: "feat-grid",
            // ── Web Share ─────────────────────────────────────────────
            div { class: "feat-card",
                div { class: "feat-card-title", "Web Share" }
                div { class: "feat-detail",
                    "Opens the OS share sheet (navigator.share). Needs a secure context; this button is the required user gesture."
                }
                input {
                    class: "field",
                    placeholder: "Title",
                    value: "{share_title}",
                    oninput: move |e| share_title.set(e.value()),
                }
                input {
                    class: "field",
                    placeholder: "Text",
                    value: "{share_text}",
                    oninput: move |e| share_text.set(e.value()),
                }
                input {
                    class: "field",
                    placeholder: "URL",
                    value: "{share_url}",
                    oninput: move |e| share_url.set(e.value()),
                }
                div { class: "feat-row",
                    button {
                        class: "preset",
                        onclick: move |_| {
                            let (title, text, url) = (share_title(), share_text(), share_url());
                            spawn(async move {
                                match system::web_share(&title, &text, &url).await {
                                    Ok(()) => share_out.set("shared ✓".to_string()),
                                    Err(err) => share_out.set(err),
                                }
                            });
                        },
                        "Share"
                    }
                }
                if !share_out().is_empty() {
                    div { class: "feat-out", "{share_out}" }
                }
            }

            // ── Vibration ─────────────────────────────────────────────
            div { class: "feat-card",
                div { class: "feat-card-title", "Vibration" }
                div { class: "feat-detail",
                    "navigator.vibrate — Android Chrome buzzes; iOS Safari silently ignores it."
                }
                div { class: "feat-row",
                    span { class: "feat-label", "ms" }
                    input {
                        class: "feat-num",
                        r#type: "number",
                        value: "{vibrate_ms}",
                        oninput: move |e| vibrate_ms.set(e.value()),
                    }
                    button {
                        class: "preset",
                        onclick: move |_| {
                            let ms = vibrate_ms().trim().parse::<u32>().unwrap_or(200);
                            match system::vibrate(ms) {
                                Ok(()) => vibrate_out.set(format!("vibrated {ms} ms ✓")),
                                Err(err) => vibrate_out.set(err),
                            }
                        },
                        "Vibrate"
                    }
                }
                if !vibrate_out().is_empty() {
                    div { class: "feat-out", "{vibrate_out}" }
                }
            }
        }
    }
}
