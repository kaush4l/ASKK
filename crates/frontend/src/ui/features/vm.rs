//! VM stage — the Dioxus lifecycle around the persistent serial console.
//! All container2wasm host wiring (asset consts, boot glue, teardown) lives
//! in `askk_browser::vm` (ADR-045); this component only mounts the host
//! element, boots via the facade, and folds `{state}` messages into the
//! status chip.

use dioxus::prelude::*;

use askk_browser::vm::{console_boot, console_bundle, console_destroy, state_label};

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
            console_destroy(eval);
        }
        controller.set(None);
    });

    rsx! {
        document::Script { src: console_bundle() }
        div { class: "{wrap}",
            header { class: "vm-bar",
                span { class: "vm-title", "Linux VM" }
                span { class: "vm-sub", "Alpine x86_64 · serial console · in-browser (container2wasm)" }
                span { class: "vm-status vm-status-{vm_state}", "{state_label(&vm_state())}" }
                span { class: "vm-hint", "click the console and type — it's a live shell" }
            }
            div {
                // Lifecycle messages arrive as `{ state }` JSON via
                // `dioxus.send`; parsed as a plain Value. The id is shared
                // verbatim with `askk_browser::vm` (SERIAL_HOST) and the
                // c2w bundle.
                id: "askk-v86-serial",
                class: "vm-console",
                onmounted: move |_| {
                    let eval = console_boot();
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
