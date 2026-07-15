//! VM stage — a real x86_64 Linux guest in the browser, presented as a raw
//! serial console.
//!
//! **container2wasm** (`assets/vm/c2w.js`, from `scripts/vm-c2w/`): 64-bit
//! Alpine — the whole container + Bochs x86_64 emulator is ONE WASI module
//! (`alpine64.wasm`) run in a worker, wired to the console via xterm-pty.
//! Wizer pre-boot makes it prompt-ready in ~3 s. Exposes `window.AskkC2W`.
//!
//! Needs cross-origin isolation (SharedArrayBuffer): the console explains and
//! stays "boot failed" on browsers without it (e.g. Safari, which lacks
//! `COEP: credentialless`). The old 32-bit v86/Buildroot engine that used to
//! back a second "image" here was removed once Alpine was solid — git history
//! has it if a fast-JIT fallback is ever needed again.

use dioxus::prelude::*;

const C2W_BUNDLE: Asset = asset!("/assets/vm/c2w.js");
const C2W_WASM: Asset = asset!("/assets/vm/alpine64.wasm");
const C2W_WORKER: Asset = asset!("/assets/vm/c2w/worker.js");
const C2W_WORKER_TOOLS: Asset = asset!("/assets/vm/c2w/workerTools.js");
const C2W_WASI_INDEX: Asset = asset!("/assets/vm/c2w/wasi_shim_index.js");
const C2W_WASI_DEFS: Asset = asset!("/assets/vm/c2w/wasi_shim_wasi_defs.js");
const C2W_WORKER_UTIL: Asset = asset!("/assets/vm/c2w/worker-util.js");
const C2W_WASI_UTIL: Asset = asset!("/assets/vm/c2w/wasi-util.js");

// Lifecycle messages arrive as `{ state }` JSON via `dioxus.send`; parsed
// as a plain Value (no serde derive dependency in the web crate).

/// Glue executed via `document::eval`: waits for the c2w bundle global + host
/// element, boots Alpine, tears down on `{cmd:"close"}`. Token-guarded
/// teardown against remount races (bundle-owned). `SERIAL_HOST` keeps its
/// legacy `askk-v86-serial` id — shared verbatim with `browser::vm` and the
/// c2w bundle, so it is not worth churning across the eval boundary.
const VM_GLUE: &str = r#"
const SERIAL_HOST = "askk-v86-serial";
while (!(window.AskkC2W && document.getElementById(SERIAL_HOST))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const engine = window.AskkC2W;
const token = engine.boot(SERIAL_HOST, {
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
for (;;) {
    const msg = await dioxus.recv();
    if (!msg || msg.cmd === "close") break;
}
engine.destroy(SERIAL_HOST, token);
"#;

fn glue() -> String {
    VM_GLUE
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
        document::Script { src: C2W_BUNDLE }
        div { class: "{wrap}",
            header { class: "vm-bar",
                span { class: "vm-title", "Linux VM" }
                span { class: "vm-sub", "Alpine x86_64 · serial console · in-browser (container2wasm)" }
                span { class: "vm-status vm-status-{vm_state}", "{state_label(&vm_state())}" }
                span { class: "vm-hint", "click the console and type — it's a live shell" }
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
    fn glue_boots_c2w() {
        assert!(VM_GLUE.contains("window.AskkC2W"), "c2w engine not wired");
        assert!(!VM_GLUE.contains("AskkV86"), "stale v86 reference in glue");
    }
}
