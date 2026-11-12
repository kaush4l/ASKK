//! One conversation with an engine: the Talk page shows it, and so does an engine's box when
//! it is open on the canvas.
//!
//! | region | what it shows | made of |
//! | --- | --- | --- |
//! | head | who is being talked to and what it is doing now; the other engines to talk to; its spec behind one touch; its conversations, and a new one | `EngineChip`, `EnginePick`, `SpecView`, `TalkList` |
//! | thread | every turn: what was asked, the run that answered (it opens stage by stage, each tool call with its program and result), what was drawn, what was said, and the answer being written now, as it comes | `Thread` → `TurnView` → `RunView`, `Writing` |
//! | foot | what the engine waits for the owner to say; the messages that wait until it is done; the message being written, what is attached, which model answers; Send, Stop | `AskForm`, `Composer` |
//!
//! Beside them, a panel that opens and closes: the board (every figure), the loop (every run),
//! the prompt the engine would send now, what the last run changed in its workspace (Diff) and
//! the workspace's files (Files, `changes.rs`).
//!
//! This file only asks and hands down. Every part it draws with is given its values
//! (`ui/web/components`).
use super::boxes::Boxes;
use crate::api::{engine_run, media_picture, post_message, talk, Chip, Mode, Talk};
use crate::core::boxes::{GOAL, LEARNING};
use crate::core::media::token;
use crate::core::run::Run;
use crate::ui::features::asks::{answer_text, parse_asks};
use crate::ui::features::run as words;
use crate::ui::web::components::{AskForm, Attached, Composer, EngineChip, EnginePick, Icon, ModelChoice, RunView, SpecView, TalkList, Thread};
use crate::ui::web::figure::FigureView;
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant, Collapsible, CollapsibleContent, CollapsibleTrigger, Tabs, TabsContent, TabsList, TabsTrigger};
use dioxus::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

/// The engine at `path` as the head shows it: the mode that names it, else just its name.
fn who(engines: &[Mode], path: &str) -> Mode {
    engines.iter().find(|m| m.path == path).cloned().unwrap_or_else(|| Mode { name: path.rsplit('/').next().unwrap_or(path).to_string(), path: path.to_string(), ..Default::default() })
}

/// Every run in a conversation that is still going, by id.
fn going(t: &Talk) -> BTreeSet<u64> {
    t.beats.iter().filter_map(|b| b.run.as_ref()).chain(t.runs.iter()).filter(|r| r.running()).map(|r| r.id).collect()
}

/// What a run was asked, in a few words (no sender, no attachment tokens).
fn asked(input: &str) -> String {
    crate::core::media::without_refs(&crate::api::sender(input).1).chars().take(90).collect()
}

/// Which model answers `path`: every model, the default, and the one the engine names itself.
fn use_models(path: String) -> (ModelChoice, EventHandler<String>) {
    let mut models = use_resource(crate::api::models::list_models);
    let own = use_resource(move || {
        let path = path.clone();
        async move {
            // The engine's own file says which model it names; none = it follows the default.
            let files = crate::api::pack_export(path).await.map(|(files, _)| files).unwrap_or_default();
            files.into_iter().find(|(name, _)| name == "engine.json").and_then(|(_, text)| serde_json::from_str::<serde_json::Value>(&text).ok()).and_then(|v| v["model"].as_str().map(String::from)).unwrap_or_default()
        }
    });
    let all = models.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let choice = ModelChoice { models: all.models.iter().map(|m| m.name.clone()).collect(), default: all.default.clone(), own: own().unwrap_or_default() };
    let pick = use_callback(move |name: String| {
        let mut next = all.clone();
        spawn(async move {
            next.default = name;
            if crate::api::models::save_models(next).await.is_ok() {
                models.restart();
            }
        });
    });
    (choice, pick)
}

/// `boxed`: it is drawn inside an open box, whose head already says who this is.
#[component]
pub fn Conversation(path: String, #[props(default)] engines: Vec<Mode>, #[props(optional)] on_pick: Option<EventHandler<String>>, #[props(default)] boxed: bool) -> Element {
    let mut input = use_signal(String::new);
    // The message just sent, shown until the conversation holds it: (text, turns when sent).
    let mut pending = use_signal(|| (String::new(), 0usize));
    let mut error = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let mut confirm = use_signal(|| false);
    let mut attached = use_signal(Vec::<Attached>::new);
    let next_key = use_signal(|| 0u64);
    // The panel beside the conversation: `None` leaves it to the screen (shown when wide).
    let mut side = use_signal(|| None::<bool>);
    let mut boxes = use_context::<Boxes>();
    let id = format!("engine:{path}");
    let (p1, p2, p3, p4, p5) = (path.clone(), path.clone(), path.clone(), path.clone(), path.clone());
    let m = super::live::use_manifest();
    // The answer being written arrives under a key of its own, so the rest is not asked again
    // for every piece of it.
    let heard_key = crate::core::heard::heard_key(&m.engine(&path));
    let live = super::live::use_live(move || m.engine(&p1));
    let on_heard = super::live::use_live(move || heard_key.clone());
    let p6 = path.clone();
    let arriving = use_resource(move || {
        let _ = on_heard();
        crate::api::run_partial(p6.clone())
    });
    let writing = arriving.read().as_ref().and_then(|r| r.as_ref().ok()).filter(|a| !a.said.is_empty()).map(|a| (a.run, a.said.clone()));
    // Its conversations: the open one first.
    let p7 = path.clone();
    let mut talks = use_resource(move || {
        let _ = live();
        crate::api::talks(p7.clone())
    });
    let talk_list = talks.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let mut show_talks = use_signal(|| false);
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
    // What it waits for the owner to say, and what it is made to do: asked again as it changes.
    let asks = use_resource(move || {
        let _ = live();
        crate::api::engine_asks(p4.clone())
    });
    let open_asks = asks.read().as_ref().and_then(|r| r.as_ref().ok()).map(|(_, text)| parse_asks(text)).unwrap_or_default();
    let mut answered = use_signal(String::new);
    let spec = use_resource(move || {
        let _ = live();
        crate::api::engine_prompt(p5.clone(), String::new())
    });
    let part = |name: &str| spec.read().as_ref().and_then(|r| r.as_ref().ok()).and_then(|s| s.iter().find(|x| x.name == name).map(|x| x.body.clone())).unwrap_or_default();
    let (model, on_model) = use_models(path.clone());
    // Keep the newest message in sight, and the answer being written as it grows.
    use_effect(move || {
        let _ = (shown.read().as_ref().map(|t| (t.beats.len(), t.beats.last().map(|b| b.replies.len() + b.figures.len()))), pending.read().0.len());
        let _ = arriving.read().as_ref().and_then(|r| r.as_ref().ok()).map(|a| a.said.len());
        // Twice: turns far off screen are not laid out until they come near (`content-visibility`),
        // so the first jump lands on an estimate and the second on the true end.
        document::eval("const end = () => { const b = document.getElementById('thread'); if (b) b.scrollTop = b.scrollHeight; }; requestAnimationFrame(() => { end(); requestAnimationFrame(end); });");
    });
    let sending = attached.read().iter().any(Attached::sending);
    let turns_now = t.beats.len();
    let working = words::at_work(&t.activity);
    let queued = boxes.queue.read().of(&id);
    let waits = working || !queued.is_empty();
    let send = {
        let (path, id) = (path.clone(), id.clone());
        move |_| {
            let tokens: Vec<String> = attached.read().iter().filter_map(|p| p.chip.as_ref().map(|c| token(&c.id))).collect();
            let said = input().trim().to_string();
            if (said.is_empty() && tokens.is_empty()) || busy() || sending {
                return;
            }
            let text = [said.clone(), tokens.join(" ")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
            input.set(String::new());
            attached.write().clear();
            error.set(String::new());
            // While it works, the message waits in sight and goes when it is done.
            if waits {
                boxes.say(id.clone(), text);
                return;
            }
            let path = path.clone();
            busy.set(true);
            pending.set((if said.is_empty() { "(attachment)".into() } else { said }, turns_now));
            spawn(async move {
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
    let act = {
        let path = path.clone();
        // Stop the engine, or clear its conversation.
        move |clear: bool| {
            let path = path.clone();
            spawn(async move {
                let done = if clear { crate::api::clear_history(path).await } else { crate::api::stop_engine(path).await };
                if let Err(e) = done {
                    error.set(e.to_string());
                }
                if clear {
                    confirm.set(false);
                    full.write().clear();
                    conv.restart();
                }
            });
        }
    };
    // Begin a new conversation (`None`) or bring back one put aside.
    let switch = {
        let path = path.clone();
        move |id: Option<u64>| {
            let path = path.clone();
            spawn(async move {
                let done = match id {
                    Some(id) => crate::api::talk_open(path, id).await,
                    None => crate::api::talk_new(path).await.map(|_| ()),
                };
                match done {
                    Err(e) => error.set(e.to_string()),
                    Ok(()) => {
                        error.set(String::new());
                        full.write().clear();
                        opened.write().clear();
                        show_talks.set(false);
                        conv.restart();
                        talks.restart();
                    }
                }
            });
        }
    };
    let current_title = talk_list.iter().find(|t| t.current).map(|t| t.title.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| "New conversation".to_string());
    let answer = {
        let path = path.clone();
        move |(question, said): (String, String)| {
            let path = path.clone();
            spawn(async move {
                let sent = post_message(path, answer_text(&question, &said)).await;
                answered.set(sent.map(|_| "Sent".to_string()).unwrap_or_else(|e| format!("error: {e}")));
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
    let side_class = match side() {
        Some(true) => "talk fill side-open",
        Some(false) => "talk fill side-closed",
        None => "talk fill",
    };
    rsx! {
        div { class: if boxed { "{side_class} is-boxed" } else { "{side_class}" },
            section { class: "talk-main", "aria-label": "Conversation with {path}",
                Collapsible { class: "talk-top",
                    header { class: "talk-head",
                        EngineChip { engine: who(&engines, &path), activity: t.activity.clone(), detail: t.detail.clone() }
                        if let Some(pick) = on_pick.filter(|_| engines.len() > 1) { EnginePick { engines: engines.clone(), chosen: path.clone(), on_pick: pick } }
                        span { class: "grow" }
                        // Its conversations: which is open, the others behind one touch, and a new one.
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, class: "talks-toggle", aria_pressed: show_talks(), aria_label: "Conversations: {current_title}", title: "Every conversation with it",
                            onclick: move |_| show_talks.toggle(),
                            Icon { name: "history", size: 16 } span { class: "talks-now", "{current_title}" }
                            if talk_list.len() > 1 { span { class: "count", "{talk_list.len()}" } }
                        }
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, disabled: working, aria_label: "New conversation", title: if working { "It is at work: a new conversation can begin when it is done" } else { "Begin a new conversation; this one is kept" },
                            onclick: { let switch = switch.clone(); move |_| switch(None) },
                            Icon { name: "plus", size: 18 }
                        }
                        // Its goal, its learnings and its tools, behind one touch.
                        CollapsibleTrigger { class: "spec-toggle", aria_label: "Goal, learnings and tools of {path}",
                            Icon { name: "flag", size: 16 } span { class: "spec-toggle-word", "Spec" } span { class: "chev", "aria-hidden": "true", Icon { name: "chevron", size: 12 } }
                        }
                        if confirm() {
                            Button { variant: ButtonVariant::Destructive, size: ButtonSize::Sm, onclick: { let act = act.clone(); move |_| act(true) }, "Clear all turns" }
                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, onclick: move |_| confirm.set(false), "Cancel" }
                        } else {
                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, disabled: busy(), aria_label: "Clear the conversation", title: "Clear the conversation and the board (notes and learning stay)", onclick: move |_| confirm.set(true),
                                Icon { name: "trash", size: 18 }
                            }
                        }
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, class: "panel-toggle", aria_label: "Board, loop, prompt, diff and files", title: "Show or hide the board, the loop, the prompt, what changed and the files", onclick: toggle_side,
                            Icon { name: "panel", size: 18 }
                        }
                    }
                    CollapsibleContent { class: "talk-spec",
                        SpecView { goal: part(GOAL), learnings: part(LEARNING), tools: part(crate::core::TOOLBOX) }
                    }
                }
                if show_talks() {
                    TalkList { talks: talk_list.clone(), busy: working,
                        on_open: { let switch = switch.clone(); move |id| switch(Some(id)) },
                        on_new: { let switch = switch.clone(); move |_| switch(None) },
                    }
                }
                Thread { beats: t.beats.clone(), runs: runs.clone(), pictures: pictures(), pending: if waiting { pending.read().0.clone() } else { String::new() }, loading, writing,
                    on_open: move |(id, open): (u64, bool)| {
                        if open { opened.write().insert(id); } else { opened.write().remove(&id); }
                    },
                }
                div { class: "talk-foot",
                    div { class: "lane",
                        if !error.read().is_empty() { p { class: "talk-error", role: "alert", "{error}" } }
                        if !fetch_error.is_empty() { p { class: "talk-error", role: "alert", "{fetch_error}" } }
                        // What it waits for is answered here, where it is seen.
                        if !open_asks.is_empty() {
                            div { class: "asks-here", role: "group", "aria-label": "It waits for you",
                                for ask in open_asks {
                                    AskForm { key: "{ask.question}", sent: answered(), on_answer: { let (q, answer) = (ask.question.clone(), answer.clone()); move |a| answer((q.clone(), a)) }, ask }
                                }
                            }
                        }
                        Composer { value: input, to: path.clone(), attached: attached(), pictures: pictures(), working, busy: busy() || sending, queued, model,
                            on_send: send, on_stop: { let act = act.clone(); move |_| act(false) },
                            on_attach: move |e: FormEvent| { spawn(super::upload::upload(e.files(), attached, next_key)); },
                            on_remove: move |key| attached.write().retain(|a| a.key != key),
                            on_unqueue: { let id = id.clone(); move |(key, edit): (u64, bool)| {
                                let text = boxes.unqueue(&id, key);
                                if let Some(text) = text.filter(|_| edit) { input.set(text); }
                            } },
                            on_steer: { let id = id.clone(); move |key: u64| boxes.steer(&id, key) },
                            on_model: move |name| on_model.call(name),
                        }
                    }
                }
            }
            div { class: "talk-scrim", onclick: move |_| side.set(Some(false)) }
            aside { class: "talk-side glass", "aria-label": "Board, loop, prompt, diff and files",
                Tabs { default_value: "board", class: "fill talk-tabs",
                    div { class: "talk-side-head",
                        TabsList {
                            TabsTrigger { value: "board", class: "px-3", Icon { name: "chart", size: 16 } "Board" if !t.board.is_empty() { span { class: "count", "{t.board.len()}" } } }
                            TabsTrigger { value: "loop", class: "px-3", Icon { name: "refresh", size: 16 } "Loop" }
                            TabsTrigger { value: "prompt", class: "px-3", Icon { name: "layers", size: 16 } "Prompt" }
                            TabsTrigger { value: "diff", class: "px-3", Icon { name: "diff", size: 16 } "Diff" }
                            TabsTrigger { value: "files", class: "px-3", Icon { name: "folder", size: 16 } "Files" }
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
                    // Drawn only while chosen, so they ask only then.
                    TabsContent { value: "diff", class: "talk-panel",
                        super::changes::DiffTab { path: path.clone() }
                    }
                    TabsContent { value: "files", class: "talk-panel",
                        super::changes::FilesTab { path: path.clone() }
                    }
                }
            }
        }
    }
}
