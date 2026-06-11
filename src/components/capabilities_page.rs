//! Capabilities page: a live inventory of every browser surface this tab can
//! reach (the assistant's "senses"), with one-click tests for the interactive
//! ones. The detection matrix is the same [`crate::capabilities::probe`] sweep
//! the `device_info` tool hands to the model, so what you see here is exactly
//! what the agent can discover about its host.

use crate::capabilities::{self, CapabilityStatus, media, system};
use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn CapabilitiesPage() -> Element {
    let mut report = use_resource(|| async { capabilities::probe().await });

    rsx! {
        section { class: "panel page-panel capabilities-page",
            div { class: "page-heading",
                h2 { "Capabilities" }
                button {
                    class: "ghost-button",
                    onclick: move |_| report.restart(),
                    "Re-probe"
                }
            }
            p { class: "muted",
                "Everything this tab can sense or do, probed live from the browser. \
                 Each entry that maps to an agent tool is labeled with the tool name — \
                 this page and the `device_info` tool run the identical sweep."
            }

            LiveTests {}

            match &*report.read() {
                None => rsx! { p { class: "muted", "Probing browser surfaces…" } },
                Some(Err(err)) => rsx! { p { class: "cap-error", "Probe failed: {err}" } },
                Some(Ok(report)) => {
                    let groups = report.grouped();
                    let user_agent = report.user_agent.clone();
                    rsx! {
                        for (group, entries) in groups {
                            section { class: "cap-group", key: "{group}",
                                h3 { "{group}" }
                                div { class: "cap-grid",
                                    for entry in entries {
                                        div { class: "cap-card", key: "{entry.id}",
                                            span { class: cap_dot_class(entry.status) }
                                            div { class: "cap-body",
                                                span { class: "cap-label", "{entry.label}" }
                                                if !entry.detail.is_empty() {
                                                    span { class: "cap-detail", "{entry.detail}" }
                                                }
                                                if !entry.tool.is_empty() {
                                                    span { class: "cap-tool", "tool: {entry.tool}" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        p { class: "muted cap-ua", "{user_agent}" }
                    }
                }
            }
        }
    }
}

fn cap_dot_class(status: CapabilityStatus) -> &'static str {
    match status {
        CapabilityStatus::Yes => "cap-dot yes",
        CapabilityStatus::Partial => "cap-dot partial",
        CapabilityStatus::No => "cap-dot no",
    }
}

/// One-click exercises for the permission-gated surfaces. Buttons trigger real
/// permission prompts — that is the point: prove access end to end.
#[component]
fn LiveTests() -> Element {
    let mut camera_shot = use_signal(|| Option::<String>::None);
    let mut camera_note = use_signal(String::new);
    let mut screen_shot = use_signal(|| Option::<String>::None);
    let mut screen_note = use_signal(String::new);
    let mut mic_clip = use_signal(|| Option::<String>::None);
    let mut mic_note = use_signal(String::new);
    let mut geo_note = use_signal(String::new);
    let mut clipboard_note = use_signal(String::new);
    let mut notify_note = use_signal(String::new);
    let mut speech_note = use_signal(String::new);

    rsx! {
        section { class: "cap-group",
            h3 { "Live tests" }
            div { class: "cap-grid cap-tests",
                div { class: "cap-card cap-test",
                    div { class: "cap-body",
                        span { class: "cap-label", "Webcam" }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                camera_note.set("Opening camera…".to_string());
                                spawn_local(async move {
                                    match media::capture_camera_frame(640).await {
                                        Ok(image) => {
                                            camera_note
                                                .set(format!("{}x{} frame captured", image.width, image.height));
                                            camera_shot.set(Some(image.data_url));
                                        }
                                        Err(err) => camera_note.set(err),
                                    }
                                });
                            },
                            "Capture frame"
                        }
                        if let Some(src) = camera_shot() {
                            img { class: "cap-shot", src: "{src}", alt: "webcam capture" }
                        }
                        span { class: "cap-detail", "{camera_note}" }
                    }
                }
                div { class: "cap-card cap-test",
                    div { class: "cap-body",
                        span { class: "cap-label", "Microphone" }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                mic_note.set("Recording 3 s…".to_string());
                                spawn_local(async move {
                                    match media::record_microphone(3.0).await {
                                        Ok(clip) => {
                                            match media::bytes_to_data_url(&clip.bytes, &clip.mime) {
                                                Ok(url) => {
                                                    mic_note.set(format!(
                                                        "{} captured ({} KiB)",
                                                        clip.mime,
                                                        clip.bytes.len() / 1024
                                                    ));
                                                    mic_clip.set(Some(url));
                                                }
                                                Err(err) => mic_note.set(err),
                                            }
                                        }
                                        Err(err) => mic_note.set(err),
                                    }
                                });
                            },
                            "Record 3 s"
                        }
                        if let Some(src) = mic_clip() {
                            audio { class: "cap-clip", controls: true, src: "{src}" }
                        }
                        span { class: "cap-detail", "{mic_note}" }
                    }
                }
                div { class: "cap-card cap-test",
                    div { class: "cap-body",
                        span { class: "cap-label", "Screen capture" }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                screen_note.set("Pick a screen/window…".to_string());
                                spawn_local(async move {
                                    match media::capture_screen_frame(800).await {
                                        Ok(image) => {
                                            screen_note
                                                .set(format!("{}x{} frame captured", image.width, image.height));
                                            screen_shot.set(Some(image.data_url));
                                        }
                                        Err(err) => screen_note.set(err),
                                    }
                                });
                            },
                            "Capture screen"
                        }
                        if let Some(src) = screen_shot() {
                            img { class: "cap-shot", src: "{src}", alt: "screen capture" }
                        }
                        span { class: "cap-detail", "{screen_note}" }
                    }
                }
                div { class: "cap-card cap-test",
                    div { class: "cap-body",
                        span { class: "cap-label", "Geolocation" }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                geo_note.set("Resolving position…".to_string());
                                spawn_local(async move {
                                    match system::current_position(10_000).await {
                                        Ok(fix) => geo_note.set(format!(
                                            "{:.5}, {:.5} (±{:.0} m)",
                                            fix.latitude, fix.longitude, fix.accuracy_m
                                        )),
                                        Err(err) => geo_note.set(err),
                                    }
                                });
                            },
                            "Get position"
                        }
                        span { class: "cap-detail", "{geo_note}" }
                    }
                }
                div { class: "cap-card cap-test",
                    div { class: "cap-body",
                        span { class: "cap-label", "Clipboard" }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                clipboard_note.set("Writing then reading…".to_string());
                                spawn_local(async move {
                                    let stamp = "ASKK clipboard test";
                                    let outcome = async {
                                        system::clipboard_write_text(stamp).await?;
                                        system::clipboard_read_text().await
                                    }
                                    .await;
                                    match outcome {
                                        Ok(text) if text == stamp => {
                                            clipboard_note.set("Round trip OK".to_string());
                                        }
                                        Ok(text) => clipboard_note
                                            .set(format!("Read back something else: {text:.40}")),
                                        Err(err) => clipboard_note.set(err),
                                    }
                                });
                            },
                            "Write & read back"
                        }
                        span { class: "cap-detail", "{clipboard_note}" }
                    }
                }
                div { class: "cap-card cap-test",
                    div { class: "cap-body",
                        span { class: "cap-label", "Notification" }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                notify_note.set("Requesting…".to_string());
                                spawn_local(async move {
                                    match system::show_notification(
                                        "ASKK",
                                        "Browser notifications are working.",
                                    )
                                    .await
                                    {
                                        Ok(()) => notify_note.set("Notification shown".to_string()),
                                        Err(err) => notify_note.set(err),
                                    }
                                });
                            },
                            "Send test notification"
                        }
                        span { class: "cap-detail", "{notify_note}" }
                    }
                }
                div { class: "cap-card cap-test",
                    div { class: "cap-body",
                        span { class: "cap-label", "Speech (TTS)" }
                        button {
                            class: "ghost-button",
                            onclick: move |_| {
                                match system::speak_text(
                                    "Hello! I am your browser-resident assistant.",
                                ) {
                                    Ok(()) => speech_note.set("Speaking…".to_string()),
                                    Err(err) => speech_note.set(err),
                                }
                            },
                            "Speak"
                        }
                        span { class: "cap-detail", "{speech_note}" }
                    }
                }
            }
        }
    }
}
