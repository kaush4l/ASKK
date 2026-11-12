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
use crate::api::{engine_run, media_picture, post_message, talk, talk_saved, Chip, Mode, Talk};
use crate::core::boxes::{GOAL, LEARNING};
use crate::core::run::Run;
use crate::ui::features::asks::{answer_text, parse_asks};
use crate::ui::features::run as words;
use crate::ui::web::components::{AskForm, EngineChip, EnginePick, Icon, RunView, SideEdge, SpecView, TalkList, Thread, SIDE_WIDTH};
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

/// How wide the panel beside is, kept by this browser for the page and for an open box apart.
/// Until it is read (or when nothing is kept) it is as wide as the stylesheet makes it.
fn use_side_width(boxed: bool) -> (Signal<Option<u32>>, Signal<u32>, impl FnMut((u32, bool)) + Copy) {
    let key = if boxed { "askk-side-w-box" } else { "askk-side-w" };
    let mut kept = use_signal(|| None::<u32>);
    // The width an edge starts from when nothing is kept: the stylesheet's own.
    let mut start = use_signal(|| 400u32);
    use_effect(move || {
        spawn(async move {
            let js = format!("let k = 0; try {{ k = Number(localStorage.getItem('{key}')) || 0; }} catch (e) {{}} return [k, Math.round(Math.min(460, Math.max(320, innerWidth * 0.34)))];");
            if let Ok(v) = document::eval(&js).await {
                let (k, d) = (v[0].as_u64().unwrap_or(0) as u32, v[1].as_u64().unwrap_or(400) as u32);
                start.set(d);
                if k > 0 {
                    kept.set(Some(k.clamp(SIDE_WIDTH.0, SIDE_WIDTH.1)));
                }
            }
        });
    });
    let set = move |(w, last): (u32, bool)| {
        kept.set(Some(w));
        if last {
            document::eval(&format!("try {{ localStorage.setItem('{key}', '{w}'); }} catch (e) {{}}"));
        }
    };
    (kept, start, set)
}

/// `boxed`: it is drawn inside an open box, whose head already says who this is.
#[component]
pub fn Conversation(path: String, #[props(default)] engines: Vec<Mode>, #[props(optional)] on_pick: Option<EventHandler<String>>, #[props(default)] boxed: bool) -> Element {
    let mut input = use_signal(String::new);
    // The message just sent, shown until the conversation holds it: (text, turns when sent).
    let mut pending = use_signal(|| (String::new(), 0usize));
    let mut error = use_signal(String::new);
    let mut confirm = use_signal(|| false);
    // The panel beside the conversation: `None` leaves it to the screen (shown when wide).
    let mut side = use_signal(|| None::<bool>);
    // A conversation archived a moment ago, which can still be brought back: (id, title).
    let mut undo = use_signal(|| None::<(u64, String, bool)>);
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
    // Conversations found by what is typed in the list's search field.
    let mut query = use_signal(String::new);
    let p9 = path.clone();
    let hits = use_resource(move || {
        let (p, q) = (p9.clone(), query());
        async move {
            if q.trim().is_empty() {
                return None;
            }
            crate::api::talk_search(p, q).await.ok()
        }
    });
    let hits = move || hits.read().clone().flatten();
    // A conversation put aside, being read while the open one stays as it is (`None`: the open one).
    let mut reading = use_signal(|| None::<u64>);
    let p8 = path.clone();
    let saved = use_resource(move || {
        let _ = live();
        let (p, id) = (p8.clone(), reading());
        async move {
            match id {
                Some(id) => talk_saved(p, id).await.map(|t| Some((id, t))).map_err(|e| e.to_string()),
                None => Ok(None),
            }
        }
    });
    let (side_w, side_start, on_side_w) = use_side_width(boxed);
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
    let t = shown().unwrap_or_default();
    // What the thread and the board show: the open conversation, or the one being read.
    // Kept while it is asked again, so the one being read never blinks.
    let mut held_read = use_signal(|| None::<(u64, Talk)>);
    use_effect(move || {
        if let Some(Ok(Some(got))) = saved.read().as_ref() {
            held_read.set(Some(got.clone()));
        }
    });
    let read_one: Option<Talk> = held_read().filter(|(id, _)| Some(*id) == reading()).map(|(_, t)| t);
    let loading = (shown.read().is_none() && conv.read().is_none()) || (reading().is_some() && read_one.is_none());
    let seen = read_one.clone().unwrap_or_else(|| if reading().is_some() { Talk::default() } else { t.clone() });
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
        let ids: Vec<String> = in_talk.into_iter().filter(|c| c.pictures > 0 && !pictures.peek().contains_key(&c.id)).map(|c| c.id).collect();
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
    // A call that waits for a yes is answered in the foot, with Allow and Deny.
    let open_asks: Vec<_> = asks.read().as_ref().and_then(|r| r.as_ref().ok()).map(|(_, text)| parse_asks(text)).unwrap_or_default().into_iter().filter(|a| crate::core::permit::id_in(&a.question).is_none()).collect();
    let mut answered = use_signal(String::new);
    let spec = use_resource(move || {
        let _ = live();
        crate::api::engine_prompt(p5.clone(), String::new())
    });
    let part = |name: &str| spec.read().as_ref().and_then(|r| r.as_ref().ok()).and_then(|s| s.iter().find(|x| x.name == name).map(|x| x.body.clone())).unwrap_or_default();
    // Keep the newest message in sight, and the answer being written as it grows.
    use_effect(move || {
        let _ = (shown.read().as_ref().map(|t| (t.beats.len(), t.beats.last().map(|b| b.replies.len() + b.figures.len()))), pending.read().0.len());
        let _ = arriving.read().as_ref().and_then(|r| r.as_ref().ok()).map(|a| a.said.len());
        // Twice: turns far off screen are not laid out until they come near (`content-visibility`),
        // so the first jump lands on an estimate and the second on the true end.
        document::eval("const end = () => { const b = document.getElementById('thread'); if (b) b.scrollTop = b.scrollHeight; }; requestAnimationFrame(() => { end(); requestAnimationFrame(end); });");
    });
    let working = words::at_work(&t.activity);
    let act = {
        let path = path.clone();
        // Clear its conversation.
        move |_: bool| {
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
    // Rename, settle or archive a conversation; an archive can be undone for five seconds.
    let mark = {
        let path = path.clone();
        move |(tid, what, title): (u64, String, String)| {
            let path = path.clone();
            spawn(async move {
                let done = match what.as_str() {
                    "archive" | "unarchive" => crate::api::talk_archive(path, tid, what == "archive").await,
                    "settle" | "unsettle" => crate::api::talk_settle(path, tid, what == "settle").await,
                    name => crate::api::talk_rename(path, tid, name.strip_prefix("name:").unwrap_or_default().to_string()).await,
                };
                match done {
                    Err(e) => error.set(e.to_string()),
                    Ok(()) => {
                        talks.restart();
                        if what == "archive" {
                            let stamp = web_time::SystemTime::now().duration_since(web_time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                            undo.set(Some((tid, title, stamp % 2 == 0)));
                            let mine = undo();
                            let _ = document::eval("await new Promise(r => setTimeout(r, 5000)); return 0;").await;
                            if undo() == mine {
                                undo.set(None);
                            }
                        }
                    }
                }
            });
        }
    };
    let current_id = talk_list.iter().find(|t| t.current).map(|t| t.id);
    // Begin a new conversation (`None`) or bring back one put aside. While it works, one put
    // aside is only read: the open one goes on, and is shown live again when it is chosen.
    let switch = {
        let path = path.clone();
        move |id: Option<u64>| {
            let (mut reading, mut show_talks) = (reading, show_talks);
            if id.is_some() && id == current_id {
                reading.set(None);
                show_talks.set(false);
                return;
            }
            if let (Some(id), true) = (id, working) {
                reading.set(Some(id));
                show_talks.set(false);
                return;
            }
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
                        reading.set(None);
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
    let title_of = |id: Option<u64>| talk_list.iter().find(|t| Some(t.id) == id || (id.is_none() && t.current)).map(|t| t.title.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| "New conversation".to_string());
    let current_title = title_of(None);
    let reading_title = title_of(reading());
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
    // Until the conversation holds it (a refocus can fold turns, so it is looked for, not counted).
    let waiting = !pending.read().0.is_empty() && pending.read().1 >= t.beats.len() && t.beats.last().is_none_or(|b| b.text.trim() != pending.read().0.trim());
    let side_class = match side() {
        Some(true) => "talk fill side-open",
        Some(false) => "talk fill side-closed",
        None => "talk fill",
    };
    let side_style = side_w().map(|w| format!("--side-kept:{w}px")).unwrap_or_default();
    rsx! {
        div { class: if boxed { "{side_class} is-boxed" } else { "{side_class}" }, style: "{side_style}",
            section { class: "talk-main", "aria-label": "Conversation with {path}",
                Collapsible { class: "talk-top",
                    header { class: "talk-head",
                        EngineChip { engine: who(&engines, &path), activity: t.activity.clone(), detail: t.detail.clone() }
                        if let Some(pick) = on_pick.filter(|_| engines.len() > 1) { EnginePick { engines: engines.clone(), chosen: path.clone(), on_pick: pick } }
                        span { class: "grow" }
                        // Its conversations: which is open, the others behind one touch, and a new one.
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, class: "talks-toggle", aria_pressed: show_talks(), aria_label: "Conversations: {reading_title}", title: "Every conversation with it",
                            onclick: move |_| show_talks.toggle(),
                            Icon { name: "history", size: 16 } span { class: "talks-now", "{reading_title}" }
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
                            Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, disabled: working, aria_label: "Clear the conversation", title: "Clear the conversation and the board (notes and learning stay)", onclick: move |_| confirm.set(true),
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
                    TalkList { talks: talk_list.clone(), busy: working, reading: reading(), hits: hits().unwrap_or_default(), query: query(),
                        on_open: { let switch = switch.clone(); move |id| switch(Some(id)) },
                        on_new: { let switch = switch.clone(); move |_| switch(None) },
                        on_mark: { let mark = mark.clone(); move |x| mark(x) },
                        on_query: move |q: String| query.set(q),
                    }
                }
                Thread { beats: seen.beats.clone(), runs: runs.clone(), pictures: pictures(), pending: if waiting && reading().is_none() { pending.read().0.clone() } else { String::new() }, loading, writing: writing.filter(|_| reading().is_none()),
                    on_open: move |(id, open): (u64, bool)| {
                        if open { opened.write().insert(id); } else { opened.write().remove(&id); }
                    },
                    on_edit: if reading().is_none() && !working { Some(EventHandler::new({ let path = path.clone(); move |n: usize| {
                        let path = path.clone();
                        spawn(async move {
                            match crate::api::rewind(path, n).await {
                                Ok(asked) => { pending.set((String::new(), 0)); input.set(asked); full.write().clear(); conv.restart(); document::eval("document.getElementById('composer')?.focus()"); }
                                Err(e) => error.set(e.to_string()),
                            }
                        });
                    } })) } else { None },
                    on_cite: move |said: String| {
                        let next = crate::ui::features::compose::cite(&said, &input.peek());
                        input.set(next);
                        document::eval("const c = document.getElementById('composer'); if (c) { c.focus(); c.setSelectionRange(c.value.length, c.value.length); }");
                    },
                }
                div { class: "talk-foot",
                    div { class: "lane",
                        if !error.read().is_empty() { p { class: "talk-error", role: "alert", "{error}" } }
                        if !fetch_error.is_empty() { p { class: "talk-error", role: "alert", "{fetch_error}" } }
                        // A conversation put aside, read: back to the open one, or open this one.
                        if reading().is_some() {
                            div { class: "reading-note glass", role: "status",
                                p { class: "grow",
                                    "You are reading “{reading_title}”, put aside. "
                                    if working { "It is at work in “{current_title}”, which goes on and is shown live when you go back to it. This one can be opened to talk in when it is done." } else { "Open it to go on with it here." }
                                }
                                Button { variant: ButtonVariant::Outline, size: ButtonSize::Sm, onclick: move |_| reading.set(None), "Back to “{current_title}”" }
                                Button { variant: ButtonVariant::Default, size: ButtonSize::Sm, disabled: working, title: if working { "It is at work: this one can be opened when it is done" } else { "Bring this conversation back; the open one is put aside" },
                                    onclick: { let switch = switch.clone(); move |_| if let Some(id) = reading() { switch(Some(id)) } },
                                    "Open this one"
                                }
                            }
                        }
                        // What it waits for is answered here, where it is seen.
                        if !open_asks.is_empty() && reading().is_none() {
                            div { class: "asks-here", role: "group", "aria-label": "It waits for you",
                                for ask in open_asks {
                                    AskForm { key: "{ask.question}", sent: answered(), on_answer: { let (q, answer) = (ask.question.clone(), answer.clone()); move |a| answer((q.clone(), a)) }, ask }
                                }
                            }
                        }
                        if let Some((tid, title, _)) = undo() {
                            div { class: "undo-note glass", role: "status",
                                p { class: "grow", "“{title}” is archived." }
                                Button { variant: ButtonVariant::Outline, size: ButtonSize::Sm, onclick: { let mark = mark.clone(); move |_| { undo.set(None); mark((tid, "unarchive".into(), String::new())); } },
                                    Icon { name: "undo", size: 14 } "Undo"
                                }
                            }
                        }
                        if reading().is_none() {
                            super::compose::Foot { path: path.clone(), input, pending, error, t: t.clone(), talks: talk_list.clone(),
                                on_sent: move |_| conv.restart(),
                                on_reset: move |_| { pending.set((String::new(), 0)); full.write().clear(); opened.write().clear(); conv.restart(); talks.restart(); },
                            }
                        }
                    }
                }
            }
            div { class: "talk-scrim", onclick: move |_| side.set(Some(false)) }
            // Between the conversation and the panel: drawn outside the panel, whose glass
            // would hold the window-wide layer a drag spreads over the page.
            SideEdge { width: side_w().unwrap_or(side_start()), on_width: on_side_w }
            aside { class: "talk-side glass", "aria-label": "Board, loop, prompt, diff and files",
                Tabs { default_value: "board", class: "fill talk-tabs",
                    div { class: "talk-side-head",
                        TabsList {
                            TabsTrigger { value: "board", class: "px-3", Icon { name: "chart", size: 16 } "Board" if !seen.board.is_empty() { span { class: "count", "{seen.board.len()}" } } }
                            TabsTrigger { value: "loop", class: "px-3", Icon { name: "refresh", size: 16 } "Loop" }
                            TabsTrigger { value: "prompt", class: "px-3", Icon { name: "layers", size: 16 } "Prompt" }
                            TabsTrigger { value: "diff", class: "px-3", Icon { name: "diff", size: 16 } "Diff" }
                            TabsTrigger { value: "files", class: "px-3", Icon { name: "folder", size: 16 } "Files" }
                        }
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Icon, class: "side-close", aria_label: "Close the panel", onclick: move |_| side.set(Some(false)), Icon { name: "close", size: 18 } }
                    }
                    TabsContent { value: "board", class: "talk-panel",
                        if seen.board.is_empty() { p { class: "dim", "Nothing on the board yet. Ask for something that can be shown." } }
                        for f in seen.board.iter().rev() { FigureView { node: f.clone() } }
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
