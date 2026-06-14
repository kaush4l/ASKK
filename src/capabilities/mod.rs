//! Browser capability probing and capture helpers (one of the assistant's
//! "senses" pillars): what this tab can see, hear, and reach.
//!
//! One async [`probe`] sweeps every browser surface the assistant could use
//! (camera, microphone, screen, geolocation, WebGPU/WebNN, WASM features,
//! storage, connectivity, system UX) into a serializable [`CapabilityReport`].
//! The Capabilities dashboard page renders it; the `device_info` tool returns it
//! to the model verbatim. Capture helpers live in [`media`] (camera / mic /
//! screen) and [`system`] (geolocation / clipboard / notify / speak) and are
//! shared by the page's live tests and the capability tools.
//!
//! Everything here is wasm-only at runtime; host builds get inert stubs so the
//! crate stays unit-testable with `cargo test`.

// Browser-only surface: on the host build the wasm call paths are compiled out,
// so several public items look dead there. Allow that off-wasm only — the wasm
// target stays honest and still flags genuine rot (same convention as
// `worker::transport`).
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

pub mod local_ai;
pub mod media;
pub mod page_ops;
pub mod system;

use serde::{Deserialize, Serialize};

/// Whether a capability is usable from this tab right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityStatus {
    /// API present (permission may still be prompted on first use).
    Yes,
    /// Present with caveats (e.g. needs cross-origin isolation, or insecure use).
    Partial,
    /// Not exposed by this browser/context.
    No,
}

/// One probed browser surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityEntry {
    /// Stable identifier, e.g. `webgpu`.
    pub id: String,
    /// Human-readable name, e.g. `WebGPU compute`.
    pub label: String,
    /// Display group, e.g. `AI & Compute`.
    pub group: String,
    pub status: CapabilityStatus,
    /// Extra context: device counts, quota, permission state, adapter info.
    #[serde(default)]
    pub detail: String,
    /// Name of the agent tool that exposes this surface, when one exists.
    #[serde(default)]
    pub tool: String,
}

/// Full capability sweep of the current browser context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityReport {
    pub user_agent: String,
    pub entries: Vec<CapabilityEntry>,
}

impl CapabilityReport {
    /// Entries bucketed by `group`, preserving probe order of first appearance.
    pub fn grouped(&self) -> Vec<(String, Vec<CapabilityEntry>)> {
        let mut groups: Vec<(String, Vec<CapabilityEntry>)> = Vec::new();
        for entry in &self.entries {
            match groups.iter_mut().find(|(name, _)| *name == entry.group) {
                Some((_, bucket)) => bucket.push(entry.clone()),
                None => groups.push((entry.group.clone(), vec![entry.clone()])),
            }
        }
        groups
    }
}

/// Async JS sweep returning the report as a JSON string. Kept as one script so
/// the page and the `device_info` tool can never disagree about what was probed.
/// Each check is wrapped so a throwing API reads as `no`, never a failed probe.
#[cfg(target_arch = "wasm32")]
const PROBE_JS: &str = r#"
(async () => {
    const entries = [];
    const add = (id, label, group, status, detail = "", tool = "") =>
        entries.push({ id, label, group, status, detail, tool });
    const has = (obj, prop) => { try { return obj != null && prop in obj; } catch { return false; } };
    const mark = (ok) => (ok ? "yes" : "no");
    const nav = navigator;

    // ── Media & Sensors ────────────────────────────────────────────────
    const gum = has(nav, "mediaDevices") && has(nav.mediaDevices, "getUserMedia");
    let devDetail = "";
    if (gum) {
        try {
            const devs = await nav.mediaDevices.enumerateDevices();
            const n = (kind) => devs.filter((d) => d.kind === kind).length;
            devDetail = `${n("videoinput")} camera(s), ${n("audioinput")} mic(s), ${n("audiooutput")} speaker(s)`;
        } catch { devDetail = "device enumeration blocked"; }
    }
    add("camera", "Webcam (getUserMedia video)", "Media & Sensors", mark(gum), devDetail, "camera_capture");
    add("microphone", "Microphone (getUserMedia audio)", "Media & Sensors", mark(gum), devDetail, "mic_record");
    add("screen_capture", "Screen capture (getDisplayMedia)", "Media & Sensors",
        mark(has(nav, "mediaDevices") && has(nav.mediaDevices, "getDisplayMedia")),
        "needs a user gesture per capture", "screen_capture");
    add("media_recorder", "MediaRecorder (audio/video encoding)", "Media & Sensors",
        mark(typeof MediaRecorder !== "undefined"), "", "mic_record");
    add("geolocation", "Geolocation", "Media & Sensors", mark(has(nav, "geolocation")), "", "geolocate");
    add("orientation", "Device orientation / motion sensors", "Media & Sensors",
        mark(typeof DeviceOrientationEvent !== "undefined" || typeof DeviceMotionEvent !== "undefined"));
    add("gamepad", "Gamepads", "Media & Sensors", mark(has(nav, "getGamepads")));
    add("midi", "Web MIDI", "Media & Sensors", mark(has(nav, "requestMIDIAccess")));
    let voiceDetail = "";
    try { voiceDetail = `${speechSynthesis.getVoices().length} voice(s) loaded`; } catch {}
    add("tts", "Speech synthesis (TTS)", "Media & Sensors",
        mark(has(window, "speechSynthesis")), voiceDetail, "speak_text");
    add("asr_webspeech", "Speech recognition (Web Speech)", "Media & Sensors",
        mark(typeof SpeechRecognition !== "undefined" || typeof webkitSpeechRecognition !== "undefined"),
        "may proxy audio to the browser vendor; prefer the local Whisper tool");

    // ── AI & Compute ───────────────────────────────────────────────────
    let gpuDetail = "";
    const hasGpu = has(nav, "gpu");
    if (hasGpu) {
        try {
            const adapter = await nav.gpu.requestAdapter();
            if (adapter) {
                const info = adapter.info || {};
                const gb = adapter.limits ? (adapter.limits.maxBufferSize / 1073741824).toFixed(1) : "?";
                gpuDetail = `${info.vendor || "adapter"} ${info.architecture || ""} · max buffer ${gb} GiB`.trim();
            } else { gpuDetail = "no adapter (blocked or software-only)"; }
        } catch (e) { gpuDetail = `adapter request failed: ${e.name || e}`; }
    }
    add("webgpu", "WebGPU (local model inference)", "AI & Compute",
        hasGpu ? (gpuDetail.startsWith("no adapter") ? "partial" : "yes") : "no", gpuDetail);
    let webgl2 = false;
    try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch {}
    add("webgl2", "WebGL2", "AI & Compute", mark(webgl2));
    add("webnn", "WebNN (navigator.ml)", "AI & Compute", mark(has(nav, "ml")));
    const validate = (bytes) => { try { return WebAssembly.validate(new Uint8Array(bytes)); } catch { return false; } };
    add("wasm_simd", "WASM SIMD", "AI & Compute",
        mark(validate([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])));
    const sharedMem = validate([0,97,115,109,1,0,0,0,5,4,1,3,1,1]);
    const isolated = !!globalThis.crossOriginIsolated;
    add("wasm_threads", "WASM threads (SharedArrayBuffer)", "AI & Compute",
        sharedMem && isolated ? "yes" : (sharedMem ? "partial" : "no"),
        isolated ? "cross-origin isolated" : "not cross-origin isolated: SAB unavailable, single-threaded WASM only");
    add("wasi_shim", "WASI sandbox (vendored shim)", "AI & Compute", "yes",
        "app-provided @bjorn3/browser_wasi_shim · CPython 3.14 + .wasm runner, no COOP/COEP needed", "run_python");
    add("workers", "Web Workers", "AI & Compute", mark(typeof Worker !== "undefined"));
    add("offscreen_canvas", "OffscreenCanvas", "AI & Compute", mark(typeof OffscreenCanvas !== "undefined"));
    add("webcodecs", "WebCodecs", "AI & Compute", mark(typeof VideoEncoder !== "undefined"));
    add("builtin_ai", "Chrome built-in AI (Prompt API)", "AI & Compute",
        mark(has(window, "LanguageModel") || has(window, "ai")), "Gemini Nano, Chrome-only");

    // ── Storage & Files ────────────────────────────────────────────────
    const opfs = has(nav, "storage") && has(nav.storage, "getDirectory");
    add("opfs", "Origin-private filesystem (OPFS)", "Storage & Files", mark(opfs),
        "the agent workspace lives here", "workspace_*");
    let quotaDetail = "";
    try {
        const est = await nav.storage.estimate();
        const gb = (n) => (n / 1073741824).toFixed(2) + " GiB";
        quotaDetail = `${gb(est.usage || 0)} used of ${gb(est.quota || 0)}`;
    } catch {}
    add("storage_quota", "Storage quota", "Storage & Files", mark(!!quotaDetail), quotaDetail);
    add("indexeddb", "IndexedDB", "Storage & Files", mark(has(window, "indexedDB")),
        "session snapshots persist here");
    add("cache_api", "Cache API", "Storage & Files", mark(has(window, "caches")),
        "local model weights cache here after first download");
    add("file_pickers", "Real-disk file pickers", "Storage & Files",
        mark(has(window, "showOpenFilePicker")), "user-mediated access outside the sandbox");

    // ── Connectivity ───────────────────────────────────────────────────
    add("online", "Network reachability", "Connectivity", mark(nav.onLine),
        nav.onLine ? "online" : "offline");
    add("fetch_cors", "fetch (CORS-bound)", "Connectivity", "yes",
        "all provider/tool traffic; gated by approval settings", "web_fetch");
    add("websocket", "WebSocket", "Connectivity", mark(typeof WebSocket !== "undefined"));
    add("webtransport", "WebTransport", "Connectivity", mark(typeof WebTransport !== "undefined"));
    add("webrtc", "WebRTC", "Connectivity", mark(typeof RTCPeerConnection !== "undefined"));
    add("push", "Push messaging", "Connectivity", mark(has(window, "PushManager")),
        "needs a push service + service worker");
    add("bluetooth", "Web Bluetooth", "Connectivity", mark(has(nav, "bluetooth")));
    add("usb", "WebUSB", "Connectivity", mark(has(nav, "usb")));
    add("serial", "Web Serial", "Connectivity", mark(has(nav, "serial")));
    add("hid", "WebHID", "Connectivity", mark(has(nav, "hid")));
    add("nfc", "Web NFC", "Connectivity", mark(typeof NDEFReader !== "undefined"));

    // ── System & UX ────────────────────────────────────────────────────
    add("notifications", "Notifications", "System & UX", mark(has(window, "Notification")),
        has(window, "Notification") ? `permission: ${Notification.permission}` : "", "notify_user");
    const clip = has(nav, "clipboard");
    add("clipboard", "Clipboard read/write", "System & UX",
        clip ? (has(nav.clipboard, "readText") ? "yes" : "partial") : "no",
        "read prompts per use", "clipboard_read / clipboard_write");
    add("share", "Web Share", "System & UX", mark(has(nav, "share")));
    add("vibration", "Vibration", "System & UX", mark(has(nav, "vibrate")));
    add("wake_lock", "Screen wake lock", "System & UX", mark(has(nav, "wakeLock")));
    let batteryDetail = "";
    if (has(nav, "getBattery")) {
        try {
            const b = await nav.getBattery();
            batteryDetail = `${Math.round(b.level * 100)}%${b.charging ? " charging" : ""}`;
        } catch {}
    }
    add("battery", "Battery status", "System & UX", mark(has(nav, "getBattery")), batteryDetail);
    add("eyedropper", "EyeDropper (screen color)", "System & UX", mark(has(window, "EyeDropper")));
    add("barcode", "BarcodeDetector", "System & UX", mark(has(window, "BarcodeDetector")));
    add("web_locks", "Web Locks", "System & UX", mark(has(nav, "locks")));
    add("broadcast", "BroadcastChannel (cross-tab)", "System & UX",
        mark(typeof BroadcastChannel !== "undefined"));
    let pwa = "browser tab";
    try { if (matchMedia("(display-mode: standalone)").matches) pwa = "installed (standalone)"; } catch {}
    add("pwa", "PWA install", "System & UX", mark(has(window, "onbeforeinstallprompt") || pwa !== "browser tab"), pwa);
    const mem = nav.deviceMemory ? `${nav.deviceMemory} GB RAM (capped)` : "RAM unknown";
    add("hardware", "Host hardware", "System & UX", "yes",
        `${nav.hardwareConcurrency || "?"} logical cores · ${mem} · ${screen.width}x${screen.height}@${devicePixelRatio}x`,
        "device_info");
    if (has(nav, "permissions")) {
        const states = [];
        for (const name of ["camera", "microphone", "geolocation", "notifications", "clipboard-read"]) {
            try { states.push(`${name}: ${(await nav.permissions.query({ name })).state}`); } catch {}
        }
        add("permissions", "Permissions API", "System & UX", "yes", states.join(" · "));
    } else {
        add("permissions", "Permissions API", "System & UX", "no");
    }

    return JSON.stringify({ user_agent: nav.userAgent, entries });
})()
"#;

/// Sweep the current browser context. Resolves quickly (every sub-probe is
/// individually guarded), but is async because the richest checks (GPU adapter,
/// storage estimate, permission states) are promise-based.
#[cfg(target_arch = "wasm32")]
pub async fn probe() -> Result<CapabilityReport, String> {
    use wasm_bindgen_futures::JsFuture;

    let value = js_sys::eval(PROBE_JS)
        .map_err(|err| format!("capability probe failed to start: {err:?}"))?;
    let json = JsFuture::from(js_sys::Promise::from(value))
        .await
        .map_err(|err| format!("capability probe rejected: {err:?}"))?
        .as_string()
        .ok_or_else(|| "capability probe returned a non-string".to_string())?;
    serde_json::from_str(&json).map_err(|err| format!("capability probe JSON invalid: {err}"))
}

/// Host stub: capabilities are a browser-context concept.
#[cfg(not(target_arch = "wasm32"))]
pub async fn probe() -> Result<CapabilityReport, String> {
    Err("browser capabilities are only probeable in the wasm build".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_groups_preserve_order_and_membership() {
        let report = CapabilityReport {
            user_agent: "test".into(),
            entries: vec![
                CapabilityEntry {
                    id: "a".into(),
                    label: "A".into(),
                    group: "G1".into(),
                    status: CapabilityStatus::Yes,
                    detail: String::new(),
                    tool: String::new(),
                },
                CapabilityEntry {
                    id: "b".into(),
                    label: "B".into(),
                    group: "G2".into(),
                    status: CapabilityStatus::No,
                    detail: String::new(),
                    tool: String::new(),
                },
                CapabilityEntry {
                    id: "c".into(),
                    label: "C".into(),
                    group: "G1".into(),
                    status: CapabilityStatus::Partial,
                    detail: String::new(),
                    tool: String::new(),
                },
            ],
        };
        let grouped = report.grouped();
        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped[0].0, "G1");
        assert_eq!(grouped[0].1.len(), 2);
        assert_eq!(grouped[1].0, "G2");
    }

    #[test]
    fn status_serializes_lowercase() {
        let json = serde_json::to_string(&CapabilityStatus::Partial).unwrap();
        assert_eq!(json, "\"partial\"");
        let back: CapabilityStatus = serde_json::from_str("\"yes\"").unwrap();
        assert_eq!(back, CapabilityStatus::Yes);
    }
}
