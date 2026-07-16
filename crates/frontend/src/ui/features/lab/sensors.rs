//! Sensors & media panel: webcam/screen frame capture, mic record + playback,
//! geolocation, clipboard, notification, and browser TTS — each an interactive
//! card with a tunable parameter, an action, and an output/error area. Backed by
//! the free functions in `askk_browser::capabilities::{media, system}` (the
//! frontend owns no web-sys). Pure test surface — nothing here touches the
//! engine (ADR-041).

use dioxus::prelude::*;

use askk_browser::capabilities::{media, system};

/// Which still-frame source a [`FrameCard`] captures (the two cards differ only
/// by this and their defaults).
#[derive(Clone, Copy, PartialEq)]
enum FrameKind {
    Camera,
    Screen,
}

#[component]
pub fn SensorsPanel() -> Element {
    rsx! {
        div { class: "feat-grid",
            FrameCard { title: "Webcam", kind: FrameKind::Camera, default_width: 640 }
            FrameCard { title: "Screen", kind: FrameKind::Screen, default_width: 800 }
            MicCard {}
            GeoCard {}
            ClipboardCard {}
            NotificationCard {}
            TtsCard {}
        }
    }
}

/// Capture one still frame (camera or screen), downscaled to a tunable max width.
#[component]
fn FrameCard(title: String, kind: FrameKind, default_width: u32) -> Element {
    let mut width = use_signal(|| default_width.to_string());
    let mut frame = use_signal(|| None::<media::CapturedImage>);
    let mut err = use_signal(|| None::<String>);
    let mut busy = use_signal(|| false);

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "{title}" }
            div { class: "feat-row",
                span { class: "feat-label", "max width" }
                input {
                    class: "feat-num",
                    r#type: "number",
                    value: "{width}",
                    oninput: move |e| width.set(e.value()),
                }
                button {
                    class: "preset",
                    disabled: busy(),
                    onclick: move |_| {
                        let w = width().parse().unwrap_or(default_width);
                        busy.set(true);
                        spawn(async move {
                            let result = match kind {
                                FrameKind::Camera => media::capture_camera_frame(w).await,
                                FrameKind::Screen => media::capture_screen_frame(w).await,
                            };
                            match result {
                                Ok(img) => { frame.set(Some(img)); err.set(None); }
                                Err(e) => err.set(Some(e)),
                            }
                            busy.set(false);
                        });
                    },
                    if busy() { "Capturing…" } else { "Capture frame" }
                }
            }
            if let Some(img) = frame() {
                img { class: "feat-media", src: "{img.data_url}" }
                div { class: "feat-detail", "{img.width}×{img.height}" }
            }
            if let Some(e) = err() {
                div { class: "feat-err", "{e}" }
            }
        }
    }
}

/// Record N seconds of microphone audio and play it back inline.
#[component]
fn MicCard() -> Element {
    let mut secs = use_signal(|| "3".to_string());
    let mut clip = use_signal(|| None::<(String, String)>); // (data URL, detail)
    let mut err = use_signal(|| None::<String>);
    let mut busy = use_signal(|| false);

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "Microphone" }
            div { class: "feat-row",
                span { class: "feat-label", "seconds" }
                input {
                    class: "feat-num",
                    r#type: "number",
                    value: "{secs}",
                    oninput: move |e| secs.set(e.value()),
                }
                button {
                    class: "preset",
                    disabled: busy(),
                    onclick: move |_| {
                        let s = secs().parse().unwrap_or(3.0);
                        busy.set(true);
                        spawn(async move {
                            match media::record_microphone(s).await {
                                Ok(rec) => match media::bytes_to_data_url(&rec.bytes, &rec.mime) {
                                    Ok(url) => {
                                        let detail = format!("{}s · {} bytes", rec.seconds, rec.bytes.len());
                                        clip.set(Some((url, detail)));
                                        err.set(None);
                                    }
                                    Err(e) => err.set(Some(e)),
                                },
                                Err(e) => err.set(Some(e)),
                            }
                            busy.set(false);
                        });
                    },
                    if busy() { "Recording…" } else { "Record" }
                }
            }
            if let Some((url, detail)) = clip() {
                audio { class: "feat-media", controls: true, src: "{url}" }
                div { class: "feat-detail", "{detail}" }
            }
            if let Some(e) = err() {
                div { class: "feat-err", "{e}" }
            }
        }
    }
}

/// Resolve the device's current position (prompts on first use).
#[component]
fn GeoCard() -> Element {
    let mut timeout = use_signal(|| "8000".to_string());
    let mut out = use_signal(|| None::<String>);
    let mut err = use_signal(|| None::<String>);
    let mut busy = use_signal(|| false);

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "Geolocation" }
            div { class: "feat-row",
                span { class: "feat-label", "timeout ms" }
                input {
                    class: "feat-num",
                    r#type: "number",
                    value: "{timeout}",
                    oninput: move |e| timeout.set(e.value()),
                }
                button {
                    class: "preset",
                    disabled: busy(),
                    onclick: move |_| {
                        let t = timeout().parse().unwrap_or(8000);
                        busy.set(true);
                        spawn(async move {
                            match system::current_position(t).await {
                                Ok(fix) => {
                                    out.set(Some(format!(
                                        "lat {}, lon {} (±{} m)",
                                        fix.latitude, fix.longitude, fix.accuracy_m
                                    )));
                                    err.set(None);
                                }
                                Err(e) => err.set(Some(e)),
                            }
                            busy.set(false);
                        });
                    },
                    if busy() { "Locating…" } else { "Locate" }
                }
            }
            if let Some(v) = out() {
                div { class: "feat-out", "{v}" }
            }
            if let Some(e) = err() {
                div { class: "feat-err", "{e}" }
            }
        }
    }
}

/// Read and write the system clipboard (each prompts per use).
#[component]
fn ClipboardCard() -> Element {
    let mut text = use_signal(|| "copied from ASKK".to_string());
    let mut out = use_signal(|| None::<String>);
    let mut err = use_signal(|| None::<String>);

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "Clipboard" }
            input {
                class: "field",
                value: "{text}",
                oninput: move |e| text.set(e.value()),
            }
            div { class: "feat-row",
                button {
                    class: "preset",
                    onclick: move |_| {
                        let payload = text();
                        spawn(async move {
                            match system::clipboard_write_text(&payload).await {
                                Ok(()) => { out.set(Some("copied ✓".to_string())); err.set(None); }
                                Err(e) => err.set(Some(e)),
                            }
                        });
                    },
                    "Write"
                }
                button {
                    class: "preset",
                    onclick: move |_| {
                        spawn(async move {
                            match system::clipboard_read_text().await {
                                Ok(v) => { out.set(Some(v)); err.set(None); }
                                Err(e) => err.set(Some(e)),
                            }
                        });
                    },
                    "Read"
                }
            }
            if let Some(v) = out() {
                div { class: "feat-out", "{v}" }
            }
            if let Some(e) = err() {
                div { class: "feat-err", "{e}" }
            }
        }
    }
}

/// Fire a system notification (requests permission on first use).
#[component]
fn NotificationCard() -> Element {
    let mut title = use_signal(|| "ASKK".to_string());
    let mut body = use_signal(|| "Hello from the Features lab".to_string());
    let mut out = use_signal(|| None::<String>);
    let mut err = use_signal(|| None::<String>);

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "Notification" }
            input {
                class: "field",
                value: "{title}",
                oninput: move |e| title.set(e.value()),
            }
            input {
                class: "field",
                value: "{body}",
                oninput: move |e| body.set(e.value()),
            }
            button {
                class: "preset",
                onclick: move |_| {
                    let (t, b) = (title(), body());
                    spawn(async move {
                        match system::show_notification(&t, &b).await {
                            Ok(()) => { out.set(Some("shown ✓".to_string())); err.set(None); }
                            Err(e) => err.set(Some(e)),
                        }
                    });
                },
                "Notify"
            }
            if let Some(v) = out() {
                div { class: "feat-out", "{v}" }
            }
            if let Some(e) = err() {
                div { class: "feat-err", "{e}" }
            }
        }
    }
}

/// Speak text aloud with the browser's own speech synthesis (synchronous —
/// returns once the utterance is queued).
#[component]
fn TtsCard() -> Element {
    let mut text = use_signal(|| "Hello from the Features lab".to_string());
    let mut out = use_signal(|| None::<String>);
    let mut err = use_signal(|| None::<String>);

    rsx! {
        div { class: "feat-card",
            div { class: "feat-card-title", "Browser TTS" }
            input {
                class: "field",
                value: "{text}",
                oninput: move |e| text.set(e.value()),
            }
            button {
                class: "preset",
                onclick: move |_| {
                    match system::speak_text(&text()) {
                        Ok(()) => { out.set(Some("speaking ✓".to_string())); err.set(None); }
                        Err(e) => err.set(Some(e)),
                    }
                },
                "Speak"
            }
            if let Some(v) = out() {
                div { class: "feat-out", "{v}" }
            }
            if let Some(e) = err() {
                div { class: "feat-err", "{e}" }
            }
        }
    }
}
