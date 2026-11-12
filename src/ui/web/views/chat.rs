//! Chat: the conversation with an engine.
//!
//! One page, several **modes**: every engine that names a mode in its `engine.json`
//! (`translator`, `guru`, …) is offered in the switch at the top; choosing one talks to that
//! engine. Which engine it opens with: the page's `path` param, else the view's argument (the
//! `label` of its `view` node), else `askk`.
//!
//! The conversation is drawn as beats: what was asked (with what was attached), a tiny card for
//! the run that answered it (opens step by step), what it drew, what it said. Beside it: the
//! board (every figure, newest first) or the prompt the engine would send now.
use crate::api::{media_begin, media_done, media_picture, media_piece, post_message, talk, Chip, Mode};
use crate::core::media::{b64, token};
use crate::ui::web::components::{Icon, Pane};
use crate::ui::web::figure::FigureView;
use dioxus::prelude::*;

/// Bytes of a file sent in one piece.
const PIECE: usize = 256 * 1024;

/// A file being attached to the next message.
#[derive(Clone, Debug, PartialEq)]
struct Pending {
    key: u64,
    name: String,
    /// What is happening to it: `sending 40%`, `sensing…`, `ready`, or the error.
    status: String,
    chip: Option<Chip>,
}

#[component]
pub fn ChatView(#[props(default)] arg: String) -> Element {
    let start = try_use_context::<crate::core::routes::Params>().and_then(|p| p.0.get("path").cloned()).filter(|p| !p.is_empty()).or((!arg.is_empty()).then_some(arg)).unwrap_or_else(|| "askk".into());
    let mut path = use_signal(|| start);
    let modes = use_resource(crate::api::modes);
    let list: Vec<Mode> = modes.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    rsx! {
        div { class: "chat fill",
            if list.len() > 1 {
                div { class: "segmented glass chat-modes", role: "group", "aria-label": "Conversation mode",
                    for m in list {
                        button { class: "seg", r#type: "button", "aria-pressed": "{m.path == path()}", title: "{m.about}",
                            onclick: { let p = m.path.clone(); move |_| path.set(p.clone()) },
                            if !m.icon.is_empty() { span { class: "emoji", "aria-hidden": "true", "{m.icon}" } }
                            "{m.name}"
                        }
                    }
                }
            }
            // Keyed by engine: another mode starts with its own conversation and composer.
            for p in [path()] {
                Conversation { key: "{p}", path: p.clone() }
            }
        }
    }
}

#[component]
fn Conversation(path: String) -> Element {
    let mut input = use_signal(String::new);
    // The message just sent, shown until the conversation holds it: (text, beats when sent).
    let mut pending = use_signal(|| (String::new(), 0usize));
    let mut error = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut confirm = use_signal(|| false);
    let mut attached = use_signal(Vec::<Pending>::new);
    let mut next_key = use_signal(|| 0u64);
    let mut side = use_signal(|| "board");
    let (p1, p2, p3) = (path.clone(), path.clone(), path.clone());
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engine(&p1));
    let me = use_resource(move || {
        let _ = live();
        crate::api::engine_object(p2.clone(), crate::core::node::Size::Small)
    });
    let mut conv = use_resource(move || {
        let _ = live();
        talk(p3.clone())
    });
    // Keep the last answer while the next is fetched, so the page never blinks.
    let mut shown = use_signal(|| None::<crate::api::Talk>);
    use_effect(move || {
        if let Some(Ok(t)) = &*conv.read() {
            shown.set(Some(t.clone()));
        }
    });
    let t = shown().unwrap_or_default();
    let fetch_error = conv.read().as_ref().and_then(|r| r.as_ref().err().map(|e| e.to_string())).unwrap_or_default();
    // Keep the newest message in sight.
    use_effect(move || {
        let _ = (shown.read().as_ref().map(|t| (t.beats.len(), t.beats.last().map(|b| b.replies.len() + b.figures.len()))), pending.read().0.len());
        document::eval("requestAnimationFrame(() => { const b = document.querySelector('.bubbles'); if (b) b.scrollTop = b.scrollHeight; })");
    });
    let attach = move |e: FormEvent| {
        let files = e.files();
        spawn(async move {
            for f in files {
                let key = next_key();
                next_key += 1;
                let name = f.name();
                attached.write().push(Pending { key, name: name.clone(), status: "reading".into(), chip: None });
                let mut set = move |status: String, chip: Option<Chip>| {
                    if let Some(p) = attached.write().iter_mut().find(|p| p.key == key) {
                        p.status = status;
                        p.chip = chip;
                    }
                };
                let sent: Result<Chip, String> = async {
                    let bytes = f.read_bytes().await.map_err(|e| e.to_string())?;
                    let id = media_begin(name, f.content_type().unwrap_or_default()).await.map_err(|e| e.to_string())?;
                    let total = bytes.len().max(1);
                    for (i, piece) in bytes.chunks(PIECE).enumerate() {
                        media_piece(id.clone(), b64(piece)).await.map_err(|e| e.to_string())?;
                        set(format!("sending {}%", ((i + 1) * PIECE).min(total) * 100 / total), None);
                    }
                    set("sensing…".into(), None);
                    media_done(id).await.map_err(|e| e.to_string())
                }
                .await;
                match sent {
                    Ok(c) => set(c.status.clone(), Some(c)),
                    Err(e) => set(format!("error: {e}"), None),
                }
            }
        });
    };
    let sending = attached.read().iter().any(|p| p.chip.is_none() && !p.status.starts_with("error"));
    let beats_now = t.beats.len();
    let send = {
        let path = path.clone();
        move |e: FormEvent| {
            e.prevent_default();
            let path = path.clone();
            async move {
                let tokens: Vec<String> = attached.read().iter().filter_map(|p| p.chip.as_ref().map(|c| token(&c.id))).collect();
                let words = input().trim().to_string();
                if (words.is_empty() && tokens.is_empty()) || busy() || sending {
                    return;
                }
                let text = [words.clone(), tokens.join(" ")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
                busy.set(true);
                error.set(String::new());
                pending.set((if words.is_empty() { "(attachment)".into() } else { words }, beats_now));
                input.set(String::new());
                attached.write().clear();
                // Posted to the engine's box: it runs on its own; live updates bring the reply.
                if let Err(e) = post_message(path, text).await {
                    error.set(e.to_string());
                    pending.set((String::new(), 0));
                }
                busy.set(false);
                conv.restart();
            }
        }
    };
    let waiting = !pending.read().0.is_empty() && pending.read().1 >= t.beats.len();
    let running = t.activity != "idle" && !t.activity.is_empty() && t.activity != "error" && t.activity != "stopped";
    rsx! {
        Pane { class: "chat-log",
            div { class: "row chat-head",
                match &*me.read() {
                    Some(Ok(n)) => rsx! { crate::ui::web::render::Render { node: n.clone() } },
                    _ => rsx! { h2 { "{path}" } },
                }
                span { class: "grow" }
                if running {
                    button { class: "btn", r#type: "button", onclick: { let path = path.clone(); move |_| { let path = path.clone(); async move { let _ = crate::api::stop_engine(path).await; } } }, "Stop" }
                }
            }
            div { class: "bubbles",
                if t.beats.is_empty() && !waiting { p { class: "dim", "Say something to begin." } }
                for (i, b) in t.beats.iter().enumerate() {
                    div { class: "beat", key: "{i}",
                        if b.from == "summary" {
                            div { class: "bubble summary", span { class: "dim", "earlier, in short" } pre { "{b.text}" } }
                        } else if !b.text.is_empty() || !b.media.is_empty() {
                            div { class: "bubble user",
                                span { class: "dim", "{b.from}" }
                                if !b.media.is_empty() { div { class: "media-row", for c in b.media.iter() { MediaChip { key: "{c.id}", chip: c.clone() } } } }
                                if !b.text.is_empty() { pre { "{b.text}" } }
                            }
                        }
                        if let Some(r) = &b.run { super::loops::RunCard { key: "{r.id}", path: path.clone(), run: r.clone() } }
                        for f in b.figures.iter() { FigureView { node: f.clone() } }
                        for r in b.replies.iter() { div { class: "bubble model", pre { "{r}" } } }
                    }
                }
                if waiting { div { class: "bubble user pending", pre { "{pending.read().0}" } } }
                if !error.read().is_empty() { p { class: "chat-error", role: "alert", "{error}" } }
                if !fetch_error.is_empty() { p { class: "chat-error", role: "alert", "{fetch_error}" } }
            }
            // The composer floats over the bottom of the conversation; the list pads under it.
            form { class: "composer glass", onsubmit: send,
                if !attached.read().is_empty() {
                    div { class: "media-row composer-media",
                        for p in attached.read().iter().cloned() {
                            div { class: "media-chip pending", key: "{p.key}",
                                match p.chip.clone() {
                                    Some(c) => rsx! { MediaChip { chip: c } },
                                    None => rsx! { span { class: "media-name", "{p.name}" } span { class: if p.status.starts_with("error") { "media-state bad" } else { "media-state" }, "{p.status}" } },
                                }
                                button { class: "icon-btn", r#type: "button", title: "Remove", "aria-label": "Remove {p.name}", onclick: move |_| attached.write().retain(|x| x.key != p.key), Icon { name: "close", size: 14 } }
                            }
                        }
                    }
                }
                textarea { class: "grow", rows: "2", placeholder: "message {path} (Enter sends, Shift+Enter for a new line)", value: "{input}",
                    oninput: move |e| input.set(e.value()),
                    onkeydown: move |e| {
                        if e.key() == Key::Enter && !e.modifiers().shift() {
                            e.prevent_default();
                            document::eval("document.querySelector('.composer')?.requestSubmit()");
                        }
                    },
                }
                label { class: "btn attach", title: "Attach an image, a recording or a video",
                    Icon { name: "file", size: 16 }
                    "Attach"
                    input { class: "visually-hidden", r#type: "file", multiple: true, accept: "image/*,audio/*,video/*,.txt,.md,.csv,.json", onchange: attach }
                }
                button { class: "btn primary", r#type: "submit", disabled: busy() || sending, if sending { "Wait…" } else { "Send" } }
                if confirm() {
                    button { class: "btn danger", r#type: "button", onclick: { let path = path.clone(); move |_| { let path = path.clone(); async move {
                        if let Err(e) = crate::api::clear_history(path).await { error.set(e.to_string()); }
                        confirm.set(false);
                        conv.restart();
                    } } }, "Clear all turns" }
                    button { class: "btn", r#type: "button", onclick: move |_| confirm.set(false), "Cancel" }
                } else {
                    button { class: "btn", r#type: "button", disabled: busy(), title: "Clear the conversation and the board (notes and learning stay)", onclick: move |_| confirm.set(true), "Clear" }
                }
            }
        }
        div { class: "chat-side",
            div { class: "segmented glass", role: "group", "aria-label": "Beside the conversation",
                button { class: "seg", r#type: "button", "aria-pressed": if side() == "board" { "true" } else { "false" }, onclick: move |_| side.set("board"), Icon { name: "chart", size: 16 } "Board" if !t.board.is_empty() { span { class: "count", "{t.board.len()}" } } }
                button { class: "seg", r#type: "button", "aria-pressed": if side() == "runs" { "true" } else { "false" }, onclick: move |_| side.set("runs"), Icon { name: "refresh", size: 16 } "Loop" }
                button { class: "seg", r#type: "button", "aria-pressed": if side() == "prompt" { "true" } else { "false" }, onclick: move |_| side.set("prompt"), Icon { name: "layers", size: 16 } "Prompt" }
            }
            match side() {
                "prompt" => rsx! { super::prompt::PromptView { path: path.clone(), input } },
                "runs" => rsx! {
                    Pane { class: "stack wb",
                        h2 { "Loop" }
                        p { class: "dim", "Every run of this engine, newest first. Open one to read it step by step." }
                        div { class: "run-list",
                            if t.runs.is_empty() { p { class: "dim", "No runs yet." } }
                            for r in t.runs.iter().rev() {
                                div { class: "run-row", key: "{r.id}",
                                    super::loops::RunCard { path: path.clone(), run: r.clone() }
                                    span { class: "dim run-input", {asked(&r.input)} }
                                }
                            }
                        }
                    }
                },
                _ => rsx! {
                    Pane { class: "stack wb",
                        h2 { "Board" }
                        if t.board.is_empty() { p { class: "dim", "Nothing on the board yet. Ask for something that can be shown." } }
                        for f in t.board.iter().rev() { FigureView { node: f.clone() } }
                    }
                },
            }
        }
    }
}

/// What a run was asked, in a few words (no sender, no attachment tokens).
fn asked(input: &str) -> String {
    crate::core::media::without_refs(&crate::api::sender(input).1).chars().take(90).collect()
}

/// An attachment in the conversation: its picture when it has one, what it is, what was taken
/// from it, and the steps of its stream (how it was sensed, how long each took).
#[component]
fn MediaChip(chip: Chip) -> Element {
    let id = chip.id.clone();
    let has_picture = chip.pictures > 0;
    let picture = use_resource(move || {
        let id = id.clone();
        async move { if has_picture { media_picture(id).await.unwrap_or_default() } else { String::new() } }
    });
    let src = picture.read().clone().unwrap_or_default();
    let len = if chip.seconds > 0.0 { format!(" · {:.1}s", chip.seconds) } else { String::new() };
    let took: u64 = chip.steps.iter().map(|s| s.1).sum();
    rsx! {
        div { class: "media-chip kind-{chip.kind} st-{chip.status}",
            if !src.is_empty() { img { class: "media-pic", src: "{src}", alt: "{chip.name}" } }
            div { class: "media-meta",
                span { class: "media-name", title: "{chip.name}", "{chip.name}" }
                span { class: "media-state", "{chip.kind}{len} · {chip.status}" if chip.pictures > 1 { " · {chip.pictures} frames" } }
                if !chip.text.is_empty() { p { class: if chip.status == "error" { "media-text bad" } else { "media-text" }, title: "{chip.text}", "{chip.text}" } }
                if !chip.steps.is_empty() {
                    details { class: "media-steps",
                        summary { "stream · {chip.steps.len()} steps · {crate::core::run::took(took)}" }
                        ol { for (what, ms, how) in chip.steps.iter() { li { class: if how == "ok" { "" } else { "bad" }, b { "{what}" } " {crate::core::run::took(*ms)} · {how}" } } }
                    }
                }
            }
        }
    }
}
