//! The canvas: every running session as a box, and the one that is open (`docs/concept.md`).
//!
//! The shell asks for the boxes once ([`use_boxes_provider`]) and the pill and this canvas
//! draw the same list, so they can never disagree. What "done" means, the order, which boxes
//! count as running, what pinned means and how the address names the open box are decided
//! in `ui/features/boxes.rs`.
//!
//! A box opens in place: touching its head puts its id after the `#` of the address, and the
//! canvas then shows that box filling it ([`super::open`]); the same touch, or Escape, takes
//! the id away again. The address is the only place that says which box is open, so a
//! reload, a link and the back button all agree.
use crate::core::boxes::{SessionBox, State};
use crate::ui::features::asks::{answer_text, parse_asks, says_yes, Ask};
use crate::ui::features::boxes::{count, engine_of, link, on_canvas, opened, order, pins_from, pins_text, session_of, Mark, Seen};
use crate::ui::features::queue::{ready, waits, Queue};
use crate::ui::features::terminals::{inside, Inside};
use crate::ui::web::components::{BoxTile, Pane, Shown};
use crate::ui::web::kit::{Button, ButtonSize, ButtonVariant};
use crate::Route;
use dioxus::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

/// The boxes as this window knows them: the service's list, and what is this window's own
/// (what it has seen, what it pinned, what it holds until a box is done).
#[derive(Clone, Copy)]
pub struct Boxes {
    pub list: Signal<Vec<SessionBox>>,
    pub seen: Signal<Seen>,
    /// The boxes the owner pinned to the canvas, kept by the browser for this window.
    pub pins: Signal<BTreeSet<String>>,
    /// Whether the canvas shows the idle boxes too.
    pub idle_too: Signal<bool>,
    /// The messages that wait until their box is done.
    pub queue: Signal<Queue>,
    /// How often the list was asked for: something may have changed each time.
    asked: Signal<u64>,
    /// For each box, how often the list had been asked for when a message last went to it.
    sent_at: Signal<BTreeMap<String, u64>>,
    /// What went wrong the last time something was said to a box.
    pub wrong: Signal<String>,
}

impl Boxes {
    /// Every box in the order a person needs it, with its mark here and the address that
    /// opens it in place.
    pub fn shown(&self) -> Vec<Shown> {
        let (seen, pins) = (self.seen.read(), self.pins.read());
        order(&self.list.read(), &seen).into_iter().map(|b| Shown { mark: seen.mark(&b), to: link(&b.id), pinned: pins.contains(&b.id), b }).collect()
    }

    pub fn counts(&self) -> Vec<(Mark, usize)> {
        count(&self.list.read(), &self.seen.read())
    }

    /// The owner looked at this box: it is no longer "done".
    pub fn looked(&mut self, id: &str) {
        if self.seen.peek().is_done(id) {
            self.seen.write().looked(id);
        }
    }

    /// Pin a box to the canvas, or let it go; the browser keeps the list for this window.
    pub fn pin(&mut self, id: &str) {
        let mut pins = self.pins.write();
        if !pins.remove(id) {
            pins.insert(id.to_string());
        }
        let text = serde_json::to_string(&pins_text(&pins)).unwrap_or_default();
        document::eval(&format!("try {{ localStorage.setItem('askk-pins', {text}); }} catch (e) {{}}"));
    }

    /// Keep the queue in the browser beside the window, so a reload brings it back.
    fn keep_queue(&self) {
        let text = serde_json::to_string(&self.queue.peek().text()).unwrap_or_default();
        document::eval(&format!("try {{ localStorage.setItem('askk-queue', {text}); }} catch (e) {{}}"));
    }

    /// Take a waiting message back; gives its text, so it can be written on.
    pub fn unqueue(&mut self, id: &str, key: u64) -> Option<String> {
        let text = self.queue.write().remove(id, key);
        self.keep_queue();
        text
    }

    /// Say `text` to the box `id`. While the box works (or other messages already wait for
    /// it) the message waits in this window and goes when the box is done; else it goes now.
    pub fn say(&mut self, id: String, text: String) {
        let state = self.list.peek().iter().find(|b| b.id == id).map(|b| b.state).unwrap_or_default();
        // A terminal takes what is typed at once; only an engine or a session waits its turn.
        let terminal = matches!(inside(&id), Inside::Terminal(_));
        if !terminal && waits(state, self.queue.peek().of(&id).len()) {
            self.queue.write().push(&id, &text);
            self.keep_queue();
        } else {
            self.send(id, text);
        }
    }

    /// Send now, and remember when, so the next waiting message is not sent on its heels.
    fn send(&mut self, id: String, text: String) {
        let asked = *self.asked.peek();
        self.sent_at.write().insert(id.clone(), asked);
        let mut wrong = self.wrong;
        wrong.set(String::new());
        spawn(async move {
            if let Err(e) = say(id, text).await {
                wrong.set(e);
            }
        });
    }
}

/// The box an address has open, if it names one.
pub fn open_of(route: &Route) -> Option<String> {
    match route {
        Route::Home { open } | Route::RoutePage { open, .. } => opened(open),
    }
}

/// Send `text` to the box `id`: leave a message for an engine, or prompt a session. The
/// answer is not waited for here: the box itself shows it working, then done.
async fn say(id: String, text: String) -> Result<(), String> {
    match (engine_of(&id), session_of(&id)) {
        (Some(path), _) => crate::api::post_message(path.to_string(), text).await.map(|_| ()).map_err(|e| e.to_string()),
        (_, Some(n)) => crate::api::session_prompt(n, text).await.map_err(|e| e.to_string()),
        _ => match inside(&id) {
            Inside::Terminal(t) => crate::api::terminal_type(t, format!("{text}\r")).await.map_err(|e| e.to_string()),
            _ => Err(format!("'{id}' cannot be spoken to from here yet")),
        },
    }
}

/// Start the person's own shell in a terminal the service holds, and open its box.
async fn new_terminal() -> Result<String, String> {
    let id = crate::api::terminal_open(String::new(), String::new(), 100, 30).await.map_err(|e| e.to_string())?;
    Ok(crate::ui::features::terminals::terminal_box(&id))
}

/// Ask for the boxes, again whenever an engine or a session is marked changed, and provide
/// them to the pill and the canvas. `engines` and `sessions` are the manifest's keys for them.
pub fn use_boxes_provider(engines: String, sessions: String) -> Boxes {
    let on_engines = super::live::use_live(move || engines.clone());
    let on_sessions = super::live::use_live(move || sessions.clone());
    // A terminal opened, closed or changed its screen.
    let on_terminals = super::live::use_live(|| "terminals".to_string());
    let mut list = use_signal(Vec::<SessionBox>::new);
    let mut seen = use_signal(Seen::default);
    let mut pins = use_signal(BTreeSet::<String>::new);
    let mut asked = use_signal(|| 0u64);
    let _ = use_resource(move || {
        let changed = (on_engines(), on_sessions(), on_terminals());
        async move {
            let _ = changed;
            if let Ok(now) = crate::api::boxes().await {
                seen.write().take(&now);
                if *list.peek() != now {
                    list.set(now);
                }
                asked += 1;
            }
        }
    });
    let mut queue = use_signal(Queue::default);
    // What this window pinned, and the messages that waited when it was last open, read once
    // the page is in a browser.
    use_effect(move || {
        spawn(async move {
            if let Ok(text) = document::eval("try { return localStorage.getItem('askk-pins') || '[]'; } catch (e) { return '[]'; }").await {
                pins.set(pins_from(text.as_str().unwrap_or_default()));
            }
            if let Ok(text) = document::eval("try { return localStorage.getItem('askk-queue') || ''; } catch (e) { return ''; }").await {
                let kept = Queue::from_text(text.as_str().unwrap_or_default());
                if !kept.waiting().is_empty() {
                    queue.set(kept);
                }
            }
        });
    });
    let mut boxes = use_context_provider(|| Boxes { list, seen, pins, idle_too: Signal::new(false), queue, asked, sent_at: Signal::new(BTreeMap::new()), wrong: Signal::new(String::new()) });
    // Send what waits: for each box something waits for, when the box is done and has taken
    // up what was sent before. Looked at again each time the list was asked for.
    let _ = use_resource(move || {
        let now = asked();
        let waiting = boxes.queue.read().waiting();
        async move {
            // Until the list has been asked for, no box is known: none is gone yet.
            if now == 0 {
                return;
            }
            for id in waiting {
                let state = list.peek().iter().find(|b| b.id == id).map(|b| b.state);
                // A box that is gone takes its queue with it.
                let Some(state) = state else {
                    while boxes.queue.write().take(&id).is_some() {}
                    boxes.keep_queue();
                    continue;
                };
                if state == State::Working || boxes.sent_at.peek().get(&id).is_some_and(|at| *at >= now) {
                    continue;
                }
                let unread = match engine_of(&id) {
                    Some(path) => crate::api::inbox(path.to_string()).await.map(|all| all.iter().filter(|m| !m.seen).count()).unwrap_or(0),
                    None => 0,
                };
                if ready(state, unread) {
                    let next = boxes.queue.write().take(&id);
                    boxes.keep_queue();
                    if let Some(q) = next {
                        boxes.send(id, q.text);
                    }
                }
            }
        }
    });
    boxes
}

/// What each blocked engine waits for the owner to say, by box id; asked again when an
/// engine changes.
fn use_asks(boxes: Boxes) -> Signal<BTreeMap<String, Vec<Ask>>> {
    let mut asks = use_signal(BTreeMap::<String, Vec<Ask>>::new);
    let _ = use_resource(move || {
        let blocked: Vec<String> = boxes.list.read().iter().filter(|b| b.state == State::Blocked).map(|b| b.id.clone()).collect();
        async move {
            let mut now = BTreeMap::new();
            for id in blocked {
                if let Some(path) = engine_of(&id) {
                    if let Ok((_, text)) = crate::api::engine_asks(path.to_string()).await {
                        now.insert(id, parse_asks(&text));
                    }
                }
            }
            if *asks.peek() != now {
                asks.set(now);
            }
        }
    });
    asks
}

/// Remember where on the canvas a box's tile is, so the open box grows from there and goes
/// back there. A box opened from the pill comes from the pill's side.
pub fn from_tile(id: &str) {
    let id = serde_json::to_string(&format!("tile-{id}")).unwrap_or_default();
    document::eval(&format!(
        "const c = document.querySelector('.canvas'), t = document.getElementById({id}); if (c) {{ let x = 0, y = 12; if (t) {{ const a = c.getBoundingClientRect(), b = t.getBoundingClientRect(); x = (b.left + b.width / 2 - a.left) / a.width * 100; y = (b.top + b.height / 2 - a.top) / a.height * 100; }} c.style.setProperty('--from-x', x + '%'); c.style.setProperty('--from-y', y + '%'); }}"
    ));
}

/// The canvas of running sessions, with the open box over it. Idle ones stay in the pill
/// unless they are pinned or asked for.
#[component]
pub fn BoxesView() -> Element {
    let mut boxes = use_context::<Boxes>();
    let asks = use_asks(boxes);
    let mut idle_too = boxes.idle_too;
    let mut sent = use_signal(BTreeMap::<String, String>::new);
    let all = boxes.shown();
    let (seen, pins) = (boxes.seen.read().clone(), boxes.pins.read().clone());
    let on: Vec<Shown> = all.iter().filter(|s| idle_too() || on_canvas(&s.b, &seen, &pins)).cloned().collect();
    let hidden = all.len() - all.iter().filter(|s| on_canvas(&s.b, &seen, &pins)).count();
    let counts = boxes.counts();
    // The box the address names, once the list holds it.
    let named = open_of(&use_route::<Route>());
    let open = named.clone().and_then(|id| all.iter().find(|s| s.b.id == id).cloned());
    let is_open = open.is_some();
    // The open box stays drawn while it leaves, so it leaves the way it came.
    let mut held = use_signal(|| None::<Shown>);
    let now = open.clone();
    let mut focused = use_signal(String::new);
    use_effect(use_reactive!(|now| {
        let id = now.as_ref().map(|s| s.b.id.clone()).unwrap_or_default();
        if let Some(s) = now {
            boxes.looked(&s.b.id);
            if held.peek().as_ref() != Some(&s) {
                held.set(Some(s));
            }
        }
        // The focus follows the box: into it when it opens, back to its tile when it is put
        // back. Only when the box changed, never while the same one is redrawn.
        let was = focused.peek().clone();
        if was != id {
            let tile = serde_json::to_string(&format!("tile-{was}")).unwrap_or_default();
            document::eval(&if id.is_empty() {
                format!("requestAnimationFrame(() => document.getElementById({tile})?.querySelector('.box-title')?.focus({{ preventScroll: true }}));")
            } else {
                "requestAnimationFrame(() => document.querySelector('.box-open.is-open .open-title')?.focus({ preventScroll: true }));".to_string()
            });
            focused.set(id);
        }
    }));
    let missing = named.filter(|_| !is_open && !all.is_empty());
    let queue = boxes.queue.read().clone();
    let wrong = (boxes.wrong)();
    // Only a build that holds terminals offers to start one (the tab does not: core/caps.rs).
    let caps = use_resource(|| async { crate::api::capabilities().await.unwrap_or_default() });
    let terminals = caps.read().as_ref().is_some_and(|c| c.iter().any(|c| c.name == "terminals" && c.here));
    rsx! {
        div { class: if is_open { "canvas fill has-open" } else { "canvas fill" },
            div { class: "canvas-tiles", "inert": is_open.then_some("true"),
                div { class: "box-bar",
                    p { class: "box-counts", "aria-live": "polite",
                        if all.is_empty() { span { class: "dim", "no sessions yet" } }
                        for (m, n) in counts {
                            span { key: "{m.key()}", class: "pill-count is-{m.key()}", "{m.sign()} {n} {m.word()}" }
                        }
                    }
                    if terminals { Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm,
                        onclick: move |_| {
                            let mut wrong = boxes.wrong;
                            spawn(async move {
                                match new_terminal().await {
                                    Ok(id) => {
                                        navigator().push(link(&id));
                                    }
                                    Err(e) => wrong.set(e),
                                }
                            });
                        },
                        "New terminal"
                    } }
                    if hidden > 0 {
                        Button { variant: ButtonVariant::Ghost, size: ButtonSize::Sm, aria_pressed: idle_too(), onclick: move |_| idle_too.toggle(),
                            if idle_too() { "Only what runs or is pinned" } else { "Show the {hidden} idle too" }
                        }
                    }
                }
                if !wrong.is_empty() { p { class: "box-wrong", role: "alert", "{wrong}" } }
                if let Some(id) = missing { p { class: "box-wrong", role: "alert", "There is no session “{id}”. It may have ended." } }
                if on.is_empty() {
                    Pane {
                        p { "Nothing is running." }
                        p { class: "dim", "Every session is in the list on the left. Open one to speak to it, pin it to keep it here, or show the idle ones and speak into a box." }
                    }
                } else {
                    div { class: "box-grid",
                        for s in on {
                            BoxTile { key: "{s.b.id}", asks: asks.read().get(&s.b.id).cloned().unwrap_or_default(), sent: sent.read().get(&s.b.id).cloned().unwrap_or_default(),
                                waiting: queue.of(&s.b.id).len(), shown: s,
                                on_look: move |id: String| from_tile(&id),
                                on_say: move |(id, text): (String, String)| boxes.say(id, text),
                                on_pin: move |id: String| boxes.pin(&id),
                                on_answer: move |(id, question, answer): (String, String, String)| {
                                    spawn(async move {
                                        // A call that waits for a yes is answered yes or no; any other question is a message.
                                        let said = match (crate::core::permit::id_in(&question), engine_of(&id)) {
                                            (Some(aid), Some(path)) => crate::api::approve(path.to_string(), aid, says_yes(&answer)).await.map_err(|e| e.to_string()),
                                            _ => say(id.clone(), answer_text(&question, &answer)).await,
                                        };
                                        sent.write().insert(id, said.map(|_| "Sent".to_string()).unwrap_or_else(|e| format!("error: {e}")));
                                    });
                                },
                            }
                        }
                    }
                }
            }
            if let Some(s) = held() {
                div { class: if is_open { "box-open is-open" } else { "box-open" }, "inert": (!is_open).then_some("true"),
                    ontransitionend: move |_| {
                        if !is_open {
                            held.set(None);
                        }
                    },
                    // Keyed by the box: another box opens with its own conversation.
                    for shown in [open.unwrap_or(s)] {
                        super::open::OpenBox { key: "{shown.b.id}", shown }
                    }
                }
            }
        }
    }
}
