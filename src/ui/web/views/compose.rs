//! The foot of a conversation with an engine: the calls that wait for the owner's yes, and the
//! composer with everything it reaches.
//!
//! | what | asked or done here |
//! | --- | --- |
//! | a call that waits for a yes | `engine_permit` (live), answered with `approve` |
//! | what it may do without asking | `engine_permit`, chosen with `set_engine_permit` |
//! | its model | `engine_model` and the models, chosen with `set_engine_model` |
//! | `/` commands | `clear_history`, `talk_new`, `set_engine_goal`, `set_engine_model`, `compact`, `set_engine_permit` |
//! | `@` names, `#` files | the boxes this window knows; `workspace_view`, only once `#` is typed |
//! | steer | `steer`, and `steers` (live) to say where it landed |
//! | a paste, a drop, several files | `upload_bytes` (a paste of 32 KB or more becomes a text file) |
//! | text put aside (mod+S), voice (mod+shift+D) | this browser: `localStorage`, the Web Speech API where there is one |
use super::boxes::Boxes;
use crate::api::{post_message, Talk};
use crate::core::media::token;
use crate::ui::features::compose::{command, references, steer_line, Mention};
use crate::ui::features::run as words;
use crate::ui::web::components::{ApprovalForm, Attached, Composer, ModelChoice, Reach, SteerLine};
use dioxus::prelude::*;

/// What `@` can name: every other box this window knows, and this engine's other conversations.
fn mentions(boxes: &Boxes, me: &str, talk: &[crate::api::TalkInfo]) -> Vec<Mention> {
    let mut out: Vec<Mention> = boxes
        .list
        .read()
        .iter()
        .filter(|b| b.id != me)
        .map(|b| {
            let name = crate::ui::features::boxes::engine_of(&b.id).map(String::from).unwrap_or_else(|| b.id.clone());
            Mention { name, about: format!("{} · {}", b.kind, b.title), note: format!("the {} box “{}” ({:?}); last: {}", b.kind, b.title, b.state, b.last.chars().take(160).collect::<String>()).to_lowercase() }
        })
        .collect();
    out.extend(talk.iter().filter(|t| !t.current).map(|t| {
        let title = if t.name.is_empty() { t.title.clone() } else { t.name.clone() };
        Mention { name: format!("talk-{}", t.id), about: format!("conversation · {title}"), note: format!("your conversation “{title}” ({} turns), put aside", t.turns) }
    }));
    out
}

/// The browser keeps what was put aside per engine.
fn stash_key(path: &str) -> String {
    format!("askk-stash:{path}")
}

/// Watch the composer for pastes and drops: files, and a big text as a file. Each comes back
/// as `{name, mime, b64}` or `{name, mime, text}`.
const WATCH: &str = r#"
const ta = document.getElementById('composer');
if (!ta) return;
ta.askkSend = (m) => dioxus.send(m);
if (!ta.dataset.askkWatch) {
  ta.dataset.askkWatch = '1';
  const form = ta.closest('form');
  let plain = false;
  ta.addEventListener('keydown', (e) => { plain = (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'v' || e.key === 'V'); });
  const file = async (f) => {
    const b = new Uint8Array(await f.arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768));
    ta.askkSend({ name: f.name || 'pasted', mime: f.type || '', b64: btoa(s) });
  };
  ta.addEventListener('paste', (e) => {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (files.length) { e.preventDefault(); files.forEach(file); plain = false; return; }
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    if (new TextEncoder().encode(t).length >= BIG_PASTE && !plain) { e.preventDefault(); ta.askkSend({ name: 'pasted text.txt', mime: 'text/plain', text: t }); }
    plain = false;
  });
  if (form) {
    form.addEventListener('dragover', (e) => { e.preventDefault(); form.classList.add('is-drop'); });
    form.addEventListener('dragleave', () => form.classList.remove('is-drop'));
    form.addEventListener('drop', (e) => { e.preventDefault(); form.classList.remove('is-drop'); [...((e.dataTransfer && e.dataTransfer.files) || [])].forEach(file); });
  }
}
await new Promise(() => {});
"#;

/// Listen and hand back what is heard: `{fin, mid}` as it comes, `{end}` when it stops.
const LISTEN: &str = r#"
const R = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!R) { dioxus.send({ end: true, error: 'no speech here' }); return; }
const r = new R();
r.interimResults = true; r.continuous = true; r.lang = navigator.language || 'en-US';
window.askkVoice = r;
r.onresult = (e) => { let fin = '', mid = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else mid += t; } dioxus.send({ fin, mid }); };
r.onerror = (e) => dioxus.send({ error: e.error || 'it could not hear' });
r.onend = () => { window.askkVoice = null; dioxus.send({ end: true }); };
r.start();
await new Promise(() => {});
"#;

/// `t`: the conversation as it stands. `on_reset`: the conversation was cleared or a new one
/// begun, so the view asks for it again.
#[component]
pub fn Foot(path: String, mut input: Signal<String>, mut pending: Signal<(String, usize)>, mut error: Signal<String>, t: Talk, talks: Vec<crate::api::TalkInfo>, on_sent: EventHandler<()>, on_reset: EventHandler<()>) -> Element {
    let mut busy = use_signal(|| false);
    let mut note = use_signal(String::new);
    let mut attached = use_signal(Vec::<Attached>::new);
    let next_key = use_signal(|| 0u64);
    let mut boxes = use_context::<Boxes>();
    let id = format!("engine:{path}");
    let m = super::live::use_manifest();
    let p0 = path.clone();
    let live = super::live::use_live(move || m.engine(&p0));
    // What it may do without asking, and what waits for a yes.
    let p1 = path.clone();
    let mut permit = use_resource(move || {
        let _ = live();
        crate::api::engine_permit(p1.clone())
    });
    let permit_now = permit.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    // Its model, and every model.
    let mut models = use_resource(crate::api::models::list_models);
    let p2 = path.clone();
    let mut own = use_resource(move || {
        let _ = live();
        crate::api::engine_model(p2.clone())
    });
    let all = models.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let choice = ModelChoice { models: all.models.iter().map(|m| m.name.clone()).collect(), default: all.default.clone(), own: own.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default() };
    // Where the last steers landed.
    let p3 = path.clone();
    let steers = use_resource(move || {
        let _ = live();
        crate::api::steers(p3.clone())
    });
    let running = t.runs.iter().rev().find(|r| r.running()).map(|r| r.id);
    let last_run = t.runs.last().map(|r| r.id).unwrap_or_default();
    let steered: Vec<SteerLine> = steers
        .read()
        .as_ref()
        .and_then(|r| r.as_ref().ok())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|s| (!s.landed() && !s.posted && running.is_some()) || (s.landed() && (Some(s.run) == running || s.run == last_run)))
        .map(|s| SteerLine { id: s.id, said: steer_line(s.landed().then_some(s.step), s.posted), landed: s.landed(), text: s.text })
        .collect();
    // `#` reaches the workspace's files: asked once the sign is typed.
    let wants_files = use_memo(move || input.read().contains('#'));
    let p4 = path.clone();
    let files = use_resource(move || {
        let (want, p) = (wants_files(), p4.clone());
        async move {
            if !want {
                return vec![];
            }
            crate::api::workspace_view(p).await.ok().and_then(|v| v.workspace).map(|w| w.files).unwrap_or_default()
        }
    });
    let reach = Reach { mentions: mentions(&boxes, &id, &talks), files: files().unwrap_or_default(), asked: t.beats.iter().filter(|b| b.from == "user" && !b.text.trim().is_empty()).map(|b| b.text.clone()).collect() };
    // What this browser keeps put aside, and whether it can hear.
    let mut stash = use_signal(Vec::<String>::new);
    let mut hears = use_signal(|| None::<bool>);
    let key = stash_key(&path);
    let k0 = key.clone();
    use_effect(move || {
        let k = k0.clone();
        spawn(async move {
            if let Ok(v) = document::eval(&format!("let s = []; try {{ s = JSON.parse(localStorage.getItem({k:?}) || '[]'); }} catch (e) {{}} return [s, !!(window.SpeechRecognition || window.webkitSpeechRecognition)];")).await {
                stash.set(serde_json::from_value(v[0].clone()).unwrap_or_default());
                hears.set(v[1].as_bool().filter(|h| *h).map(|_| false));
            }
        });
    });
    // Pastes and drops, from the moment the composer is there.
    use_effect(move || {
        spawn(async move {
            let mut watch = document::eval(&WATCH.replace("BIG_PASTE", &crate::ui::features::compose::BIG_PASTE.to_string()));
            while let Ok(v) = watch.recv::<serde_json::Value>().await {
                let name = v["name"].as_str().unwrap_or("pasted").to_string();
                let mime = v["mime"].as_str().unwrap_or_default().to_string();
                let bytes = match (v["b64"].as_str(), v["text"].as_str()) {
                    (Some(b), _) => crate::core::media::unb64(b).unwrap_or_default(),
                    (_, Some(t)) => t.as_bytes().to_vec(),
                    _ => continue,
                };
                spawn(super::upload::upload_bytes(name, mime, bytes, attached, next_key));
            }
        });
    });
    let keep_stash = move |list: Vec<String>, k: String| {
        let text = serde_json::to_string(&list).unwrap_or_default();
        document::eval(&format!("try {{ localStorage.setItem({k:?}, {text:?}); }} catch (e) {{}}"));
    };
    let working = words::at_work(&t.activity);
    let queued = boxes.queue.read().of(&id);
    let waits = working || !queued.is_empty();
    let sending = attached.read().iter().any(Attached::sending);
    let turns_now = t.beats.len();
    let send = {
        let (path, id, reach) = (path.clone(), id.clone(), reach.clone());
        move |_| {
            let said = input().trim().to_string();
            // A command is run, not sent.
            if let Some((name, args)) = command(&said) {
                let path = path.clone();
                input.set(String::new());
                note.set(String::new());
                spawn(async move {
                    let done: Result<String, String> = match name {
                        "clear" => crate::api::clear_history(path).await.map(|_| "The conversation is cleared.".to_string()).map_err(|e| e.to_string()),
                        "new" => crate::api::talk_new(path).await.map(|_| "A new conversation begins; the last one is kept.".to_string()).map_err(|e| e.to_string()),
                        "goal" => crate::api::set_engine_goal(path, args.clone()).await.map(|_| format!("Its goal is now: {args}")).map_err(|e| e.to_string()),
                        "model" => crate::api::set_engine_model(path, args.clone()).await.map(|_| if args.is_empty() { "It follows the default model again.".to_string() } else { format!("It uses {args} now.") }).map_err(|e| e.to_string()),
                        "compact" => crate::api::compact(path).await.map(|s| format!("Compacted into: {}", s.chars().take(200).collect::<String>())).map_err(|e| e.to_string()),
                        "permit" => crate::api::set_engine_permit(path, args.clone()).await.map(|_| format!("Permission mode: {args}.")).map_err(|e| e.to_string()),
                        _ => Err(format!("/{name} is not known here")),
                    };
                    match done {
                        Ok(said) => {
                            note.set(said);
                            if matches!(name, "clear" | "new" | "compact") {
                                on_reset.call(());
                            }
                            if name == "model" {
                                own.restart();
                            }
                        }
                        Err(e) => error.set(e),
                    }
                });
                return;
            }
            let tokens: Vec<String> = attached.read().iter().filter_map(|p| p.chip.as_ref().map(|c| token(&c.id))).collect();
            if (said.is_empty() && tokens.is_empty()) || busy() || sending {
                return;
            }
            let text = [references(&said, &reach.mentions), tokens.join(" ")].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
            input.set(String::new());
            attached.write().clear();
            error.set(String::new());
            note.set(String::new());
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
                on_sent.call(());
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
    let k1 = key.clone();
    rsx! {
        if !permit_now.waiting.is_empty() {
            div { class: "asks-here approvals", role: "group", "aria-label": "Calls that wait for your yes",
                for a in permit_now.waiting.clone() {
                    ApprovalForm { key: "{a.id}", approval: a.clone(), on_answer: { let path = path.clone(); move |yes: bool| {
                        let (path, aid) = (path.clone(), a.id);
                        spawn(async move {
                            if let Err(e) = crate::api::approve(path, aid, yes).await { error.set(e.to_string()); }
                            permit.restart();
                        });
                    } } }
                }
            }
        }
        if !note.read().is_empty() { p { class: "talk-note", role: "status", "{note}" } }
        Composer { value: input, to: path.clone(), attached: attached(), pictures: Default::default(), working, busy: busy() || sending, queued, steered, model: Some(choice), permit: Some(permit_now.mode.clone()).filter(|m| !m.is_empty()), reach,
            stashed: stash.read().len(), voice: hears(),
            on_send: send, on_stop: stop,
            on_attach: move |e: FormEvent| { spawn(super::upload::upload(e.files(), attached, next_key)); },
            on_remove: move |key| attached.write().retain(|a| a.key != key),
            on_unqueue: { let id = id.clone(); move |(key, edit): (u64, bool)| {
                let text = boxes.unqueue(&id, key);
                if let Some(text) = text.filter(|_| edit) { input.set(text); }
            } },
            on_steer: { let (id, path) = (id.clone(), path.clone()); move |key: u64| {
                if let Some(text) = boxes.unqueue(&id, key) {
                    let path = path.clone();
                    spawn(async move {
                        match crate::api::steer(path, text).await {
                            Ok(0) => note.set("It was done already: the message went as a plain one.".into()),
                            Ok(_) => note.set(String::new()),
                            Err(e) => error.set(e.to_string()),
                        }
                    });
                }
            } },
            on_model: { let path = path.clone(); move |name: String| {
                let path = path.clone();
                spawn(async move {
                    if let Err(e) = crate::api::set_engine_model(path, name).await { error.set(e.to_string()); }
                    own.restart();
                    models.restart();
                });
            } },
            on_permit: { let path = path.clone(); move |mode: String| {
                let path = path.clone();
                spawn(async move {
                    if let Err(e) = crate::api::set_engine_permit(path, mode).await { error.set(e.to_string()); }
                    permit.restart();
                });
            } },
            on_stash: move |text: Option<String>| {
                let mut list = stash();
                match text {
                    Some(t) => { list.push(t); input.set(String::new()); note.set("Put aside: mod+S in an empty composer brings it back.".into()); }
                    None => match list.pop() { Some(t) if input.peek().trim().is_empty() => { input.set(t); note.set(String::new()); } Some(t) => { list.push(t); note.set("Empty the composer first: what is put aside comes back into an empty one.".into()); } None => {} },
                }
                keep_stash(list.clone(), k1.clone());
                stash.set(list);
            },
            on_voice: move |_| {
                if hears().is_none() { return; }
                if hears() == Some(true) {
                    document::eval("if (window.askkVoice) window.askkVoice.stop();");
                    return;
                }
                hears.set(Some(true));
                spawn(async move {
                    let base = input.peek().trim_end().to_string();
                    let mut heard = if base.is_empty() { String::new() } else { format!("{base} ") };
                    let mut ear = document::eval(LISTEN);
                    while let Ok(v) = ear.recv::<serde_json::Value>().await {
                        if let Some(fin) = v["fin"].as_str() { heard.push_str(fin); }
                        let mid = v["mid"].as_str().unwrap_or_default();
                        input.set(format!("{heard}{mid}"));
                        if let Some(e) = v["error"].as_str() { note.set(format!("Voice: {e}")); }
                        if v["end"].as_bool() == Some(true) { break; }
                    }
                    hears.set(Some(false));
                });
            },
        }
    }
}
