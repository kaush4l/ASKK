//! v86 x86 VM page — a no-GUI serial console onto a real Linux guest.
//!
//! Boots a committed Buildroot CD-ROM under [v86](https://github.com/copy/v86)
//! entirely in the browser and exposes its serial0 TTY as a raw xterm
//! terminal. Mirrors the [`super::terminal`] vendoring pattern: the bundle
//! (`assets/v86_vm.js`, built from `scripts/v86-vm/`) exposes a small
//! `window.AskkV86` API; this component mounts a host `div` and drives it
//! through one persistent `document::eval` channel. JS pushes lifecycle-state
//! changes up via `dioxus.send`; the bundle owns serial rendering and input.
//!
//! Unlike the IDE terminal, this is NOT a line-buffered shell — the bundle
//! creates its own xterm and pipes per-byte serial I/O straight to the guest.
//!
//! ponytail: main-thread v86, no runtime networking (mirrors lack CORS; a relay
//! is a future toggle). The committed Buildroot ISO is the always-available
//! default; a staged `assets/runtimes/v86/manifest.json` adds selectable
//! hosted images (built with `scripts/v86/build-image.sh`, deployed by
//! `scripts/v86/stage.sh`). The picker resolves manifest URLs against the
//! asset base — NOT `document.baseURI` — so they land where staging puts them
//! regardless of the deploy base-path.

use crate::components::ui::{Card, SegmentedControl, StatusDot};
use dioxus::prelude::*;
use serde::Deserialize;

const VM_CSS: Asset = asset!("/assets/pages/vm.css");
const V86_BUNDLE: Asset = asset!("/assets/v86_vm.js");
const V86_WASM: Asset = asset!("/assets/v86_vm.wasm");
const V86_BIOS: Asset = asset!("/assets/v86_bios.bin");
const V86_VGABIOS: Asset = asset!("/assets/v86_vgabios.bin");
const V86_IMAGE: Asset = asset!("/assets/runtimes/v86/buildroot.iso");

/// v86's stock Buildroot kernel cmdline (from the upstream demo profile).
const BUILDROOT_CMDLINE: &str = "tsc=reliable mitigations=off random.trust_cpu=on";

/// A message from the mounted VM bundle: either a lifecycle-state change or the
/// discovered image list (default + staged manifest). Fields are optional so
/// one `dioxus.recv` channel carries both shapes.
#[derive(Clone, PartialEq, Deserialize)]
struct VmMsg {
    /// One of `downloading` | `booting` | `ready` | `error`.
    #[serde(default)]
    state: Option<String>,
    /// Selectable images, sent once after the manifest fetch settles.
    #[serde(default)]
    images: Option<Vec<ImageOpt>>,
}

/// A selectable image as surfaced to the picker (the bundle holds the full
/// boot config keyed by `id`; the UI only needs id + label).
#[derive(Clone, PartialEq, Deserialize)]
struct ImageOpt {
    id: String,
    label: String,
}

/// Glue executed via `document::eval`. Waits for the bundle global + serial
/// host, derives the asset base from the hashed wasm URL, discovers staged
/// images from the manifest (absent in dev → default only), boots the default,
/// then re-boots on `{cmd:"boot", id}` from the picker. Token-guarded teardown
/// matches the terminal/CM glue against remount races.
const V86_GLUE: &str = r#"
const SERIAL_HOST = "askk-v86-serial";
while (!(window.AskkV86 && document.getElementById(SERIAL_HOST))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const WASM = "__ASKK_V86_WASM__";
const BIOS = "__ASKK_V86_BIOS__";
const VGA = "__ASKK_V86_VGABIOS__";
// Asset base e.g. "/ASKK/assets/" — staged images live under it (not baseURI).
const ai = WASM.indexOf("/assets/");
const assetsBase = ai >= 0 ? WASM.slice(0, ai + 8) : "";
const resolveUrl = (u) =>
    /^https?:\/\//.test(u) ? u : assetsBase + String(u).replace(/^assets\//, "");

const DEFAULT = {
    id: "buildroot",
    label: "Buildroot (default)",
    url: "__ASKK_V86_IMAGE__",
    type: "cdrom",
    cmdline: "__ASKK_V86_CMDLINE__",
};
// Discover hosted images; the manifest is staged-only, so it 404s in dev.
const images = [DEFAULT];
try {
    const resp = await fetch(assetsBase + "runtimes/v86/manifest.json", { cache: "no-store" });
    if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.images)) {
            for (const im of data.images) {
                if (!im || !im.url) continue;
                images.push({
                    id: String(im.id || im.url),
                    label: String(im.label || im.id || im.url),
                    url: resolveUrl(im.url),
                    type: String(im.type || "cdrom"),
                    cmdline: typeof im.cmdline === "string" ? im.cmdline : "",
                });
            }
        }
    }
} catch (_) {
    // No manifest in dev / fetch blocked: the default image still boots.
}
dioxus.send({ images: images.map((i) => ({ id: i.id, label: i.label })) });

let token = 0;
const bootImage = (img) => {
    token = window.AskkV86.boot(SERIAL_HOST, {
        serialHostId: SERIAL_HOST,
        imageUrl: img.url,
        imageType: img.type,
        memMB: 128,
        wasmUrl: WASM,
        biosUrl: BIOS,
        vgaBiosUrl: VGA,
        cmdline: img.cmdline || "",
        onState: (state) => dioxus.send({ state }),
    });
};
bootImage(DEFAULT);
for (;;) {
    const msg = await dioxus.recv();
    if (!msg || msg.cmd === "close") break;
    if (msg.cmd === "boot") {
        const img = images.find((i) => i.id === msg.id);
        if (img) bootImage(img);
    }
}
window.AskkV86.destroy(SERIAL_HOST, token);
"#;

/// Human-readable label for a lifecycle state.
fn state_label(state: &str) -> &'static str {
    match state {
        "downloading" => "Downloading image…",
        "booting" => "Booting guest…",
        "ready" => "Shell ready",
        "error" => "Boot failed",
        _ => "Starting…",
    }
}

/// StatusDot tone for a lifecycle state: green when the shell is up, red on
/// failure, cyan (info) while still bringing the guest online.
fn state_tone(state: &str) -> &'static str {
    match state {
        "ready" => "success",
        "error" => "error",
        _ => "info",
    }
}

/// The VM page: a status line, an image picker, and the raw serial terminal.
#[component]
pub fn V86Page() -> Element {
    let mut controller = use_signal(|| Option::<document::Eval>::None);
    let mut status = use_signal(|| "Starting…".to_string());
    // Raw lifecycle state (drives the StatusDot tone); `status` holds its label.
    let mut vm_state = use_signal(|| "starting".to_string());
    let mut images = use_signal(|| {
        vec![ImageOpt {
            id: "buildroot".to_string(),
            label: "Buildroot (default)".to_string(),
        }]
    });
    let mut selected = use_signal(|| "buildroot".to_string());

    // Tear the VM down when this page unmounts (tab switch / navigation).
    use_drop(move || {
        if let Some(eval) = controller.peek().as_ref() {
            let _ = eval.send(serde_json::json!({ "cmd": "close" }));
        }
        controller.set(None);
    });

    // The picker speaks labels; map the chosen label back to its image id for
    // the boot command, and the current id forward to a label for display.
    let image_list = images();
    let options: Vec<String> = image_list.iter().map(|i| i.label.clone()).collect();
    let selected_id = selected();
    let selected_label = image_list
        .iter()
        .find(|i| i.id == selected_id)
        .map(|i| i.label.clone())
        .unwrap_or_else(|| selected_id.clone());

    rsx! {
        document::Stylesheet { href: VM_CSS }
        document::Script { src: V86_BUNDLE }
        div { class: "vm-page",
            header { class: "vm-bar",
                div { class: "vm-bar-id",
                    span { class: "vm-title", "Linux VM" }
                    span { class: "vm-sub", "x86 · serial console (v86)" }
                }
                // Only worth showing once there's more than the default image.
                if options.len() > 1 {
                    div { class: "vm-picker",
                        SegmentedControl {
                            options,
                            selected: selected_label,
                            onselect: move |label: String| {
                                // Resolve the picked label to its image id.
                                let Some(id) = images()
                                    .iter()
                                    .find(|i| i.label == label)
                                    .map(|i| i.id.clone())
                                else {
                                    return;
                                };
                                selected.set(id.clone());
                                vm_state.set("booting".to_string());
                                status.set("Booting guest…".to_string());
                                if let Some(eval) = controller.peek().as_ref() {
                                    let _ = eval.send(serde_json::json!({ "cmd": "boot", "id": id }));
                                }
                            },
                        }
                    }
                }
                div { class: "vm-status",
                    StatusDot { tone: state_tone(&vm_state()).to_string(), label: status() }
                }
            }
            Card { class: "vm-console-card",
                div {
                    // Shared with V86_GLUE and the AskkV86 VM registry.
                    id: "askk-v86-serial",
                    class: "ide-term-host vm-console",
                    onmounted: move |_| {
                        let glue = V86_GLUE
                            .replace("__ASKK_V86_IMAGE__", &V86_IMAGE.to_string())
                            .replace("__ASKK_V86_WASM__", &V86_WASM.to_string())
                            .replace("__ASKK_V86_BIOS__", &V86_BIOS.to_string())
                            .replace("__ASKK_V86_VGABIOS__", &V86_VGABIOS.to_string())
                            .replace("__ASKK_V86_CMDLINE__", BUILDROOT_CMDLINE);
                        let eval = document::eval(&glue);
                        controller.set(Some(eval));
                        spawn(async move {
                            let mut eval = eval;
                            while let Ok(msg) = eval.recv::<VmMsg>().await {
                                if let Some(state) = msg.state {
                                    vm_state.set(state.clone());
                                    status.set(state_label(&state).to_string());
                                }
                                if let Some(list) = msg.images
                                    && !list.is_empty()
                                {
                                    images.set(list);
                                }
                            }
                        });
                    },
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_label_covers_the_lifecycle() {
        assert_eq!(state_label("downloading"), "Downloading image…");
        assert_eq!(state_label("booting"), "Booting guest…");
        assert_eq!(state_label("ready"), "Shell ready");
        assert_eq!(state_label("error"), "Boot failed");
        assert_eq!(state_label("anything-else"), "Starting…");
    }

    #[test]
    fn state_tone_maps_to_status_dot_tones() {
        assert_eq!(state_tone("ready"), "success");
        assert_eq!(state_tone("error"), "error");
        assert_eq!(state_tone("downloading"), "info");
        assert_eq!(state_tone("booting"), "info");
        assert_eq!(state_tone("anything-else"), "info");
    }

    #[test]
    fn glue_placeholders_are_all_replaced() {
        // Guards against a renamed placeholder silently leaving a literal
        // "__ASKK_…__" token in the booted glue (which would 404 the fetch).
        let glue = V86_GLUE
            .replace("__ASKK_V86_IMAGE__", "/img")
            .replace("__ASKK_V86_WASM__", "/wasm")
            .replace("__ASKK_V86_BIOS__", "/bios")
            .replace("__ASKK_V86_VGABIOS__", "/vga")
            .replace("__ASKK_V86_CMDLINE__", BUILDROOT_CMDLINE);
        assert!(!glue.contains("__ASKK_"), "unreplaced placeholder remains");
    }
}
