//! Talk: the conversation with an engine (a page names this view `chat`).
//!
//! One screen, three regions:
//!
//! | region | what it shows | made of |
//! | --- | --- | --- |
//! | head | who is being talked to and what it is doing now; the other engines to talk to | `EngineChip`, `EnginePick` |
//! | thread | every turn: what was asked, the run that answered (it opens stage by stage, each tool call with its program and result), what was drawn, what was said | `Thread` → `TurnView` → `RunView` |
//! | composer | the message being written and what is attached to it; Send, Stop | `Composer` |
//!
//! Beside them, a panel that opens and closes: the board (every figure), the loop (every run)
//! or the prompt the engine would send now.
//!
//! This file only asks and hands down: which engine (the page's `path` param, else the view's
//! argument, else `askk`), its conversation, the runs a person opened in full, the pictures of
//! what is attached. Every part it draws with is given those values (`ui/web/components`).
use crate::api::{engine_run, media_begin, media_done, media_picture, media_piece, post_message, talk, Chip, Mode, Talk};
use crate::core::media::{b64, token};
use crate::core::run::Run;
use crate::ui::features::run as words;
use crate::ui::web::components::{Attached, Composer, EngineChip, EnginePick, Icon, RunView, Thread};
use crate::ui::web::figure::FigureView;
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant, Tabs, TabsContent, TabsList, TabsTrigger};
use dioxus::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

/// Bytes of a file sent in one piece.
const PIECE: usize = 256 * 1024;

#[component]
pub fn ChatView(#[props(default)] arg: String) -> Element {
    let start = try_use_context::<crate::core::routes::Params>().and_then(|p| p.0.get("path").cloned()).filter(|p| !p.is_empty()).or((!arg.is_empty()).then_some(arg)).unwrap_or_else(|| "askk".into());
    let mut path = use_signal(|| start);
    let modes = use_resource(crate::api::modes);
    let engines: Vec<Mode> = modes.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    rsx! {
        // Keyed by engine: another engine starts with its own conversation and composer.
        for p in [path()] {
            Conversation { key: "{p}", path: p.clone(), engines: engines.clone(), on_pick: move |p| path.set(p) }
        }
    }
}

/// The engine at `path` as the head shows it: the mode that names it, else just its name.
fn who(engines: &[Mode], path: &str) -> Mode {
    engines.iter().find(|m| m.path == path).cloned().unwrap_or_else(|| Mode { name: path.rsplit('/').next().unwrap_or(path).to_string(), path: path.to_string(), ..Default::default() })
}

/// Every run in a conversation that is still going, by id.
fn going(t: &Talk) -> BTreeSet<u64> {
    t.beats.iter().filter_map(|b| b.run.as_ref()).chain(t.runs.iter()).filter(|r| r.running()).map(|r| r.id).collect()
}

#[component]
fn Conversation(path: String, engines: Vec<Mode>, on_pick: EventHandler<String>) -> Element {
    let input = use_signal(String::new);
    // The message just sent, shown until the conversation holds it: (text, turns when sent).
    let mut pending = use_signal(|| (String::new(), 0usize));
    let mut error = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut confirm = use_signal(|| false);
    let mut attached = use_signal(Vec::<Attached>::new);
    let mut next_key = use_signal(|| 0u64);
    // The panel beside the conversation: `None` leaves it to the screen (shown when wide).
    let mut side = use_signal(|| None::<bool>);
    let (p1, p2, p3) = (path.clone(), path.clone(), path.clone());
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engine(&p1));
    let mut conv = use_resource(move || {
        let _ = live();
        talk(p2.clone())
    });
    // Keep the last answer while the next is fetched, so the page never blinks.
    let mut shown = use_signal(|| None::<Talk>);
    use_effect(move || {
        if let Some(Ok(t)) = &*conv.read() {
            shown.set(Some(t.clone()));
        }
    });
    let loading = shown.read().is_none() && conv.read().is_none();
    let t = shown().unwrap_or_default();
    let fetch_error = conv.read().as_ref().and_then(|r| r.as_ref().err().map(|e| e.to_string())).unwrap_or_default();
    // The runs a person opened, and those still going, are asked for in full (their long
    // texts: the prompt, the reply, each program and its result) and asked again as they move.
    let mut opened = use_signal(BTreeSet::<u64>::new);
    let mut full = use_signal(BTreeMap::<u64, Run>::new);
    let _runs = use_resource(move || {
        let _ = live();
        let mut want = opened();
        want.extend(shown.read().as_ref().map(going).unwrap_or_default());
        let p = p3.clone();
        async move {
            for id in want {
                if full.peek().get(&id).is_some_and(|r| !r.running()) {
                    continue;
                }
                if let Ok(r) = engine_run(p.clone(), id).await {
                    full.write().insert(id, r);
                }
            }
        }
    });
    // A run held in full is shown only while it agrees with the conversation on how it stands.
    let stands: BTreeMap<u64, String> = t.beats.iter().filter_map(|b| b.run.as_ref()).chain(t.runs.iter()).map(|r| (r.id, r.status.clone())).collect();
    let runs: BTreeMap<u64, Run> = full().into_iter().filter(|(id, r)| stands.get(id).is_none_or(|s| *s == r.status)).collect();
    // The pictures of what is attached, asked for once each.
    let mut pictures = use_signal(BTreeMap::<String, String>::new);
    let _pictures = use_resource(move || {
        let in_talk: Vec<Chip> = shown.read().as_ref().map(|t| t.beats.iter().flat_map(|b| b.media.clone()).collect()).unwrap_or_default();
        let here: Vec<Chip> = attached.read().iter().filter_map(|a| a.chip.clone()).collect();
        let ids: Vec<String> = in_talk.into_iter().chain(here).filter(|c| c.pictures > 0 && !pictures.peek().contains_key(&c.id)).map(|c| c.id).collect();
        async move {
            for id in ids {
                if let Ok(src) = media_picture(id.clone()).await {
                    pictures.write().insert(id, src);
                }
            }
        }
    });
    // Keep the newest message in sight.
    use_effect(move || {
        let _ = (shown.read().as_ref().map(|t| (t.beats.len(), t.beats.last().map(|b| b.replies.len() + b.figures.len()))), pending.read().0.len());
        document::eval("requestAnimationFrame(() => { const b = document.getElementById('thread'); if (b) b.scrollTop = b.scrollHeight; })");
    });
    let attach = move |e: FormEvent| {
        let files = e.files();
        spawn(async move {
            for f in files {
                let key = next_key();
                next_key += 1;
                let name = f.name();
                attached.write().push(Attached { key, name: name.clone(), status: "reading".into(), chip: None });
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
    let sending = attached.read().iter().any(Attached::sending);
    let turns_now = t.beats.len();
    let send = {
        let path = path.clone();
        move |_| {
            let path = path.clone();
            let mut input = input;
            spawn(async move {
                let tokens: Vec<String> = attached.read().iter().filter_map(|p| p.chip.as_ref().map(|c| token(&c.id))).collect();
                let said = input().trim().to_string();
                if (said.is_empty() && tokens.is_empty()) || busy() || sending {
                    return;
                }
                let text = [said.clone(), tokens.join(" ")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
                busy.set(true);
                error.set(String::new());
                pending.set((if said.is_empty() { "(attachment)".into() } else { said }, turns_now));
                input.set(String::new());
                attached.write().clear();
                // Posted to the engine's box: it runs on its own; live updates bring the reply.
                if let Err(e) = post_message(path, text).await {
                    error.set(e.to_string());
                    pending.set((String::new(), 0));
                }
                busy.set(false);
                conv.restart();
            });
        }
    };
    let stop = {
        let path = path.clone();
        move |_| {
            let path = path.clone();
            spawn(async move {
                if let Err(e) = crate::api::stop_engine(path).await {
                    error.set(e.to_string());
                }
            });
        }
    };
    let clear = {
        let path = path.clone();
        move |_| {
            let path = path.clone();
            spawn(async move {
                if let Err(e) = crate::api::clear_history(path).await {
                    error.set(e.to_string());
                }
                confirm.set(false);
                full.write().clear();
                conv.restart();
            });
        }
    };
    // Open or close the panel. Left to the screen so far, it is shown exactly when the screen
    // is wide, so the first press asks the window which that is.
    let toggle_side = move |_| {
        spawn(async move {
            let now = match side() {
                Some(open) => open,
                None => document::eval("return matchMedia('(min-width: 1200px)').matches;").await.ok().and_then(|v| v.as_bool()).unwrap_or(false),
            };
            side.set(Some(!now));
        });
    };
    let waiting = !pending.read().0.is_empty() && pending.read().1 >= t.beats.len();
    let working = words::at_work(&t.activity);
    let side_class = match side() {
        Some(true) => "talk fill side-open",
        Some(false) => "talk fill side-closed",
        None => "talk fill",
    };
    rsx! {
        div { class: "{side_class}",
            section { class: "talk-main", "aria-label": "Conversation with {path}",
                header { class: "talk-head",
                    EngineChip { engine: who(&engines, &path), activity: t.activity.clone(), detail: t.detail.clone() }
                    if engines.len() > 1 { EnginePick { engines: engines.clone(), chosen: path.clone(), on_pick } }
                    span { class: "grow" }
                    if confirm() {
                        Button { variant: ButtonVariant::Destructive, size: ButtonSize::Sm, onclick: clear, "Clear all turns" }
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, onclick: move |_| confirm.set(false), "Cancel" }
                    } else {
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, disabled: busy(), aria_label: "Clear the conversation", title: "Clear the conversation and the board (notes and learning stay)", onclick: move |_| confirm.set(true),
                            Icon { name: "trash", size: 18 }
                        }
                    }
                    Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, class: "panel-toggle", aria_label: "Board, loop and prompt", title: "Show or hide the board, the loop and the prompt", onclick: toggle_side,
                        Icon { name: "panel", size: 18 }
                    }
                }
                Thread { beats: t.beats.clone(), runs: runs.clone(), pictures: pictures(), pending: if waiting { pending.read().0.clone() } else { String::new() }, loading,
                    on_open: move |(id, open): (u64, bool)| {
                        if open { opened.write().insert(id); } else { opened.write().remove(&id); }
                    },
                }
                div { class: "talk-foot",
                    div { class: "lane",
                        if !error.read().is_empty() { p { class: "talk-error", role: "alert", "{error}" } }
                        if !fetch_error.is_empty() { p { class: "talk-error", role: "alert", "{fetch_error}" } }
                        Composer { value: input, to: path.clone(), attached: attached(), pictures: pictures(), working, busy: busy() || sending,
                            on_send: send, on_stop: stop, on_attach: attach, on_remove: move |key| attached.write().retain(|a| a.key != key),
                        }
                    }
                }
            }
            div { class: "talk-scrim", onclick: move |_| side.set(Some(false)) }
            aside { class: "talk-side glass", "aria-label": "Board, loop and prompt",
                Tabs { default_value: "board", class: "fill talk-tabs",
                    div { class: "talk-side-head",
                        TabsList {
                            TabsTrigger { value: "board", class: "px-3", Icon { name: "chart", size: 16 } "Board" if !t.board.is_empty() { span { class: "count", "{t.board.len()}" } } }
                            TabsTrigger { value: "loop", class: "px-3", Icon { name: "refresh", size: 16 } "Loop" }
                            TabsTrigger { value: "prompt", class: "px-3", Icon { name: "layers", size: 16 } "Prompt" }
                        }
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, class: "side-close", aria_label: "Close the panel", onclick: move |_| side.set(Some(false)), Icon { name: "close", size: 18 } }
                    }
                    TabsContent { value: "board", class: "talk-panel",
                        if t.board.is_empty() { p { class: "dim", "Nothing on the board yet. Ask for something that can be shown." } }
                        for f in t.board.iter().rev() { FigureView { node: f.clone() } }
                    }
                    TabsContent { value: "loop", class: "talk-panel",
                        p { class: "dim", "Every run of this engine, newest first. Open one to read it stage by stage." }
                        if t.runs.is_empty() { p { class: "dim", "No runs yet." } }
                        for r in t.runs.iter().rev() {
                            RunView { key: "{r.id}", asked: asked(&r.input), run: runs.get(&r.id).cloned().unwrap_or_else(|| r.clone()),
                                on_open: { let id = r.id; move |open| { if open { opened.write().insert(id); } else { opened.write().remove(&id); } } },
                            }
                        }
                    }
                    TabsContent { value: "prompt", class: "talk-panel",
                        super::prompt::PromptView { path: path.clone(), input }
                    }
                }
            }
        }
    }
}

/// What a run was asked, in a few words (no sender, no attachment tokens).
fn asked(input: &str) -> String {
    crate::core::media::without_refs(&crate::api::sender(input).1).chars().take(90).collect()
}
