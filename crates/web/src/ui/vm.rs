//! VM stage — a real x86 Linux guest in the browser (v86), presented as a
//! raw serial console. The vendored bundle (`assets/vm/v86.js`, built from
//! `scripts/vm/`) exposes `window.AskkV86`; this component mounts a host div
//! and drives it through one persistent `document::eval` channel.
//!
//! Two committed images: Buildroot (v86's stock serial-console CD, boots in
//! seconds) and Alpine 3.24 (full distro; its stock isolinux only talks to
//! VGA, so the kernel+initramfs boot directly via bzimage with
//! `console=ttyS0` and the ISO attached as the apk/modloop cdrom).
//!
//! ponytail: main-thread v86, no guest networking; image list is baked (two
//! images) — a manifest-driven picker returns when a third image exists.

use dioxus::prelude::*;

const V86_BUNDLE: Asset = asset!("/assets/vm/v86.js");
const V86_WASM: Asset = asset!("/assets/vm/v86.wasm");
const V86_BIOS: Asset = asset!("/assets/vm/seabios.bin");
const V86_VGABIOS: Asset = asset!("/assets/vm/vgabios.bin");
const BUILDROOT_ISO: Asset = asset!("/assets/vm/buildroot.iso");
const ALPINE_ISO: Asset = asset!("/assets/vm/alpine.iso");
const ALPINE_KERNEL: Asset = asset!("/assets/vm/vmlinuz-virt");
const ALPINE_INITRD: Asset = asset!("/assets/vm/initramfs-virt");

/// Boot-selectable images; ids are shared with the eval glue.
pub const IMAGE_IDS: &[(&str, &str)] = &[
    ("buildroot", "Buildroot — busybox, boots in seconds"),
    ("alpine", "Alpine 3.24 — full distro, ~1 min boot"),
];

// Lifecycle messages arrive as `{ state }` JSON via `dioxus.send`; parsed
// as a plain Value (no serde derive dependency in the web crate).

/// Glue executed via `document::eval`: waits for the bundle global + host
/// element, boots the default image, re-boots on `{cmd:"boot", id}`.
/// Token-guarded teardown against remount races (bundle-owned).
const V86_GLUE: &str = r#"
const SERIAL_HOST = "askk-v86-serial";
while (!(window.AskkV86 && document.getElementById(SERIAL_HOST))) {
    await new Promise((resolve) => setTimeout(resolve, 50));
}
const COMMON = "tsc=reliable mitigations=off random.trust_cpu=on";
const IMAGES = [
    {
        id: "buildroot",
        imageUrl: "__BUILDROOT_ISO__",
        imageType: "cdrom",
        memMB: 128,
        cmdline: COMMON,
    },
    {
        id: "alpine",
        imageUrl: "__ALPINE_KERNEL__",
        imageType: "bzimage",
        initrdUrl: "__ALPINE_INITRD__",
        cdromUrl: "__ALPINE_ISO__",
        memMB: 512,
        cmdline: "console=ttyS0,115200 modules=loop,squashfs,sd-mod,sr-mod " + COMMON,
    },
];
let token = 0;
const bootImage = (img) => {
    token = window.AskkV86.boot(SERIAL_HOST, {
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
window.AskkV86.destroy(SERIAL_HOST, token);
"#;

fn glue() -> String {
    V86_GLUE
        .replace("__BUILDROOT_ISO__", &BUILDROOT_ISO.to_string())
        .replace("__ALPINE_KERNEL__", &ALPINE_KERNEL.to_string())
        .replace("__ALPINE_INITRD__", &ALPINE_INITRD.to_string())
        .replace("__ALPINE_ISO__", &ALPINE_ISO.to_string())
        .replace("__V86_WASM__", &V86_WASM.to_string())
        .replace("__V86_BIOS__", &V86_BIOS.to_string())
        .replace("__V86_VGABIOS__", &V86_VGABIOS.to_string())
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

#[component]
pub fn VmStage() -> Element {
    let mut controller = use_signal(|| Option::<document::Eval>::None);
    let mut vm_state = use_signal(|| "starting".to_string());
    let mut selected = use_signal(|| "buildroot".to_string());

    use_drop(move || {
        if let Some(eval) = controller.peek().as_ref() {
            let _ = eval.send(serde_json::json!({ "cmd": "close" }));
        }
        controller.set(None);
    });

    rsx! {
        document::Script { src: V86_BUNDLE }
        div { class: "vm-stage",
            header { class: "vm-bar",
                span { class: "vm-title", "Linux VM" }
                span { class: "vm-sub", "x86 · serial console · in-browser (v86)" }
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
