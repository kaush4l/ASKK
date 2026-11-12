//! From rust-ui.com (MIT, see LICENSE-rust-ui beside this file). The code is ours now: changed in five ways. The parent says whether it is open (`open`), so a key press can open it; the original could only be opened by its own button, through a script it wrote into the page. It says what it is (`role="dialog"`, `aria-modal`, a label), which the original left out. The focus goes into it when it opens, Tab stays inside it, Escape closes it, and the focus goes back to where it was. It arrives and leaves on the app's motion tokens, the same way out as in, and is not drawn at all while closed. And it has no look written on the element itself.
use dioxus::prelude::*;
use tw_merge::tw_merge;

/// Something over the whole page that must be answered or closed before the page is used
/// again. `open`: whether it is shown. `on_close`: the person asked to close it (Escape, a
/// press beside it); the parent then sets `open` to false.
///
/// Inside it, the element marked `data-autofocus` gets the focus when it opens; else the
/// first thing that can have it.
#[component]
pub fn Dialog(
    open: bool,
    #[props(into)] aria_label: String,
    #[props(into, optional)] class: Option<String>,
    #[props(optional)] on_close: Option<EventHandler<()>>,
    children: Element,
) -> Element {
    let id = use_hook(|| dioxus::core::current_scope_id().0);
    let state = if open { "open" } else { "closed" };
    // Kept drawn while it leaves, so it leaves the way it came; then it is not drawn at all.
    let mut drawn = use_signal(|| open);
    use_effect(use_reactive!(|open| {
        if open {
            drawn.set(true);
            // Remember where the focus was, then move it inside.
            document::eval(&format!(
                "window.kitDialogBack = document.activeElement; requestAnimationFrame(() => {{ const d = document.getElementById('dialog-{id}'); if (!d) return; (d.querySelector('[data-autofocus]') || d.querySelector('button, input, a[href]') || d).focus(); }});"
            ));
        } else if *drawn.peek() {
            document::eval("const b = window.kitDialogBack; window.kitDialogBack = null; if (b && b.isConnected && b.focus) b.focus();");
        }
    }));
    let close = move || {
        if let Some(h) = &on_close {
            h.call(());
        }
    };
    let backdrop = "fixed inset-0 z-[70] transition-opacity duration-[var(--motion-base)] ease-[var(--ease-out)] data-[state=closed]:opacity-0 data-[state=closed]:pointer-events-none data-[state=open]:opacity-100";
    let panel = tw_merge!(
        "fixed left-1/2 top-[12dvh] z-[71] -translate-x-1/2 flex flex-col overflow-hidden w-[min(40rem,calc(100vw-2rem))] max-h-[76dvh] rounded-2xl border bg-popover text-popover-foreground outline-none transition-[opacity,translate,scale] duration-[var(--motion-spring)] ease-[var(--ease-spring)] data-[state=closed]:opacity-0 data-[state=closed]:translate-y-[var(--enter-y)] data-[state=closed]:scale-[var(--enter-scale)] data-[state=closed]:pointer-events-none data-[state=closed]:duration-[var(--motion-base)] data-[state=closed]:ease-[var(--ease-exit)] data-[state=open]:opacity-100",
        class.as_deref().unwrap_or("")
    );
    if !open && !drawn() {
        return rsx! {};
    }
    rsx! {
        div {
            "data-name": "DialogBackdrop",
            "data-state": "{state}",
            "aria-hidden": "true",
            class: "{backdrop}",
            onclick: move |_| close(),
        }
        div {
            "data-name": "Dialog",
            "data-state": "{state}",
            id: "dialog-{id}",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "{aria_label}",
            tabindex: "-1",
            "inert": (!open).then_some("true"),
            class: "{panel}",
            ontransitionend: move |_| {
                if !open {
                    drawn.set(false);
                }
            },
            onkeydown: move |e: KeyboardEvent| match e.key() {
                Key::Escape => {
                    e.prevent_default();
                    e.stop_propagation();
                    close();
                }
                // Tab goes round inside: the page behind cannot be reached while this is open.
                Key::Tab => {
                    e.prevent_default();
                    let back = e.modifiers().shift();
                    document::eval(&format!(
                        "const d = document.getElementById('dialog-{id}'); if (d) {{ const f = [...d.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])')].filter(e => e.offsetParent !== null); const i = f.indexOf(document.activeElement); const n = f[(i + ({back} ? f.length - 1 : 1)) % Math.max(f.length, 1)]; if (n) n.focus(); }}"
                    ));
                }
                _ => {}
            },
            {children}
        }
    }
}

/// The dialog's heading.
#[component]
pub fn DialogTitle(#[props(into, optional)] class: Option<String>, children: Element) -> Element {
    let merged = tw_merge!("text-lg leading-none", class.as_deref().unwrap_or(""));
    rsx! { h2 { "data-name": "DialogTitle", class: "{merged}", {children} } }
}
