//! VM stage — a real x86 Linux guest in the browser, presented as a raw
//! serial console. Two engines behind one picker:
//!
//! - **v86** (`assets/vm/v86.js`, from `scripts/vm/`): 32-bit x86 with a
//!   JIT — fast CPU, boots the Buildroot serial-console CD in seconds.
//!   Exposes `window.AskkV86`.
//! - **container2wasm** (`assets/vm/c2w.js`, from `scripts/vm-c2w/`):
//!   64-bit Alpine — the whole container + Bochs x86_64 emulator is ONE
//!   WASI module (`alpine64.wasm`) run in a worker, wired to the console
//!   via xterm-pty. Wizer pre-boot makes it prompt-ready in ~3 s, but the
//!   interpreter CPU is ~5x slower than v86's JIT (measured). Exposes
//!   `window.AskkC2W`. Needs cross-origin isolation (SharedArrayBuffer);
//!   without it the console explains and stays on v86 images.
//!
//! ponytail: image list is baked (two images) — a manifest-driven picker
//! returns when a third image exists.

use dioxus::prelude::*;

const V86_BUNDLE: Asset = asset!("/assets/vm/v86.js");
const V86_WASM: Asset = asset!("/assets/vm/v86.wasm");
const V86_BIOS: Asset = asset!("/assets/vm/seabios.bin");
const V86_VGABIOS: Asset = asset!("/assets/vm/vgabios.bin");
const BUILDROOT_ISO: Asset = asset!("/assets/vm/buildroot.iso");
const C2W_BUNDLE: Asset = asset!("/assets/vm/c2w.js");
const C2W_WASM: Asset = asset!("/assets/vm/alpine64.wasm");
const C2W_WORKER: Asset = asset!("/assets/vm/c2w/worker.js");
const C2W_WORKER_TOOLS: Asset = asset!("/assets/vm/c2w/workerTools.js");
const C2W_WASI_INDEX: Asset = asset!("/assets/vm/c2w/wasi_shim_index.js");
const C2W_WASI_DEFS: Asset = asset!("/assets/vm/c2w/wasi_shim_wasi_defs.js");
const C2W_WORKER_UTIL: Asset = asset!("/assets/vm/c2w/worker-util.js");
const C2W_WASI_UTIL: Asset = asset!("/assets/vm/c2w/wasi-util.js");

/// Boot-selectable images; ids are shared with the eval glue.
pub const IMAGE_IDS: &[(&str, &str)] = &[
    (
        "buildroot",
        "Buildroot — busybox (v86 JIT), boots in seconds",
    ),
    ("alpine64", "Alpine x86_64 — container2wasm (Bochs)"),
];

// Lifecycle messages arrive as `{ state }` JSON via `dioxus.send`; parsed
// as a plain Value (no serde derive dependency in the web crate).

/// Glue executed via `document::eval`: waits for the bundle global + host
/// element, boots the default image, re-boots on `{cmd:"boot", id}`.
/// Token-guarded teardown against remount races (bundle-owned).
const V86_GLUE: &str = r#"
const SERIAL_HOST = "askk-v86-serial";
while (!(window.AskkV86 && window.AskkC2W && document.getElementById(SERIAL_HOST))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const COMMON = "tsc=reliable mitigations=off random.trust_cpu=on";
const IMAGES = [
    {
        id: "buildroot",
        engine: "v86",
        imageUrl: "__BUILDROOT_ISO__",
        imageType: "cdrom",
        memMB: 128,
        cmdline: COMMON,
    },
    {
        id: "alpine64",
        engine: "c2w",
    },
];
let token = 0;
let engine = null;
const bootImage = (img) => {
    // Tear down whichever engine currently owns the console.
    if (engine) engine.destroy(SERIAL_HOST, token);
    if (img.engine === "c2w") {
        engine = window.AskkC2W;
        token = engine.boot(SERIAL_HOST, {
            serialHostId: SERIAL_HOST,
            wasmUrl: "__C2W_WASM__",
            workerUrl: "__C2W_WORKER__",
            supportUrls: {
                workerTools: "__C2W_WORKER_TOOLS__",
                wasiShimIndex: "__C2W_WASI_INDEX__",
                wasiDefs: "__C2W_WASI_DEFS__",
                workerUtil: "__C2W_WORKER_UTIL__",
                wasiUtil: "__C2W_WASI_UTIL__",
            },
            onState: (state) => dioxus.send({ state }),
        });
        return;
    }
    engine = window.AskkV86;
    token = engine.boot(SERIAL_HOST, {
        serialHostId: SERIAL_HOST,
        imageUrl: img.imageUrl,
        imageType: img.imageType,
        initrdUrl: img.initrdUrl,
        cdromUrl: img.cdromUrl,
        memMB: img.memMB,
        wasmUrl: "__V86_WASM__",
        biosUrl: "__V86_BIOS__",
        vgaBiosUrl: "__V86_VGABIOS__",
        cmdline: img.cmdline,
        onState: (state) => dioxus.send({ state }),
    });
};
bootImage(IMAGES[0]);
for (;;) {
    const msg = await dioxus.recv();
    if (!msg || msg.cmd === "close") break;
    if (msg.cmd === "boot") {
        const img = IMAGES.find((i) => i.id === msg.id);
        if (img) bootImage(img);
    }
}
if (engine) engine.destroy(SERIAL_HOST, token);
"#;

fn glue() -> String {
    V86_GLUE
        .replace("__BUILDROOT_ISO__", &BUILDROOT_ISO.to_string())
        .replace("__V86_WASM__", &V86_WASM.to_string())
        .replace("__V86_BIOS__", &V86_BIOS.to_string())
        .replace("__V86_VGABIOS__", &V86_VGABIOS.to_string())
        .replace("__C2W_WASM__", &C2W_WASM.to_string())
        .replace("__C2W_WORKER_TOOLS__", &C2W_WORKER_TOOLS.to_string())
        .replace("__C2W_WORKER_UTIL__", &C2W_WORKER_UTIL.to_string())
        .replace("__C2W_WORKER__", &C2W_WORKER.to_string())
        .replace("__C2W_WASI_INDEX__", &C2W_WASI_INDEX.to_string())
        .replace("__C2W_WASI_DEFS__", &C2W_WASI_DEFS.to_string())
        .replace("__C2W_WASI_UTIL__", &C2W_WASI_UTIL.to_string())
}

fn state_label(state: &str) -> &'static str {
    match state {
        "downloading" => "downloading image…",
        "booting" => "booting guest…",
        "ready" => "shell ready",
        "error" => "boot failed",
        _ => "starting…",
    }
}

/// The persistent VM console. Mounted once at app root (boots the guest at
/// load); `visible` docks it into the stage or parks it off-screen.
#[component]
pub fn VmConsole(visible: bool) -> Element {
    let mut controller = use_signal(|| Option::<document::Eval>::None);
    let mut vm_state = use_signal(|| "starting".to_string());
    let mut selected = use_signal(|| "buildroot".to_string());

    // The console is ALWAYS mounted (boots at app load so the `shell` tool
    // works from any stage); `visible` only toggles whether it is on-screen.
    // Hidden = parked off-screen but still sized + running (not display:none,
    // which would zero the xterm and break the fit + keep the VM alive).
    let wrap = if visible {
        "vm-stage"
    } else {
        "vm-stage vm-parked"
    };

    use_drop(move || {
        if let Some(eval) = controller.peek().as_ref() {
            let _ = eval.send(serde_json::json!({ "cmd": "close" }));
        }
        controller.set(None);
    });

    rsx! {
        document::Script { src: V86_BUNDLE }
        document::Script { src: C2W_BUNDLE }
        div { class: "{wrap}",
            header { class: "vm-bar",
                span { class: "vm-title", "Linux VM" }
                span { class: "vm-sub", "x86 · serial console · in-browser (v86 / c2w)" }
                select {
                    class: "vm-picker",
                    value: "{selected}",
                    onchange: move |e| {
                        let id = e.value();
                        selected.set(id.clone());
                        vm_state.set("booting".to_string());
                        if let Some(eval) = controller.peek().as_ref() {
                            let _ = eval.send(serde_json::json!({ "cmd": "boot", "id": id }));
                        }
                    },
                    for (id, label) in IMAGE_IDS {
                        option { value: *id, selected: selected() == *id, "{label}" }
                    }
                }
                span { class: "vm-status vm-status-{vm_state}", "{state_label(&vm_state())}" }
            }
            div {
                id: "askk-v86-serial",
                class: "vm-console",
                onmounted: move |_| {
                    let eval = document::eval(&glue());
                    controller.set(Some(eval));
                    spawn(async move {
                        let mut eval = eval;
                        while let Ok(msg) = eval.recv::<serde_json::Value>().await {
                            if let Some(state) = msg.get("state").and_then(|v| v.as_str()) {
                                vm_state.set(state.to_string());
                            }
                        }
                    });
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_label_covers_the_lifecycle() {
        assert_eq!(state_label("downloading"), "downloading image…");
        assert_eq!(state_label("booting"), "booting guest…");
        assert_eq!(state_label("ready"), "shell ready");
        assert_eq!(state_label("error"), "boot failed");
        assert_eq!(state_label("x"), "starting…");
    }

    #[test]
    fn glue_placeholders_all_replaced() {
        assert!(!glue().contains("__"), "unreplaced placeholder remains");
    }

    #[test]
    fn glue_covers_every_image_id() {
        for (id, _) in IMAGE_IDS {
            assert!(V86_GLUE.contains(&format!("id: \"{id}\"")), "{id} missing");
        }
    }
}
