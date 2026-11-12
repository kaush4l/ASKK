//! Rooms: a discussion, a board or a game with several agents. Left: make one, in one of two
//! modes (**regular**: fill in the setup yourself, from a preset; **creator**: say what you
//! want and the desk agent designs the setup), and the list. Right: the chosen room's lines
//! and a box to speak or to let the seats go on.
//!
//! Which modes exist, what each offers and the presets are data (`modes.json`).
use crate::api::{harnesses, room_curation, room_design, room_open, room_say, room_view, rooms};
use crate::core::room::{Curation, Plan, Room, Rule, SeatPlan, MAX_SEATS, USER};
use crate::core::session::State;
use crate::ui::web::components::Pane;
use dioxus::prelude::*;

#[component]
pub fn RoomsView() -> Element {
    let root = super::live::use_manifest().rooms;
    let live = super::live::use_live(move || root.clone());
    let kinds = use_resource(harnesses);
    let fetched = use_resource(move || {
        let _ = live();
        rooms()
    });
    let mut all = use_signal(Vec::<Room>::new);
    use_effect(move || {
        if let Some(Ok(a)) = &*fetched.read() {
            all.set(a.clone());
        }
    });
    let mut chosen = use_signal(|| None::<u64>);
    let curated = use_resource(room_curation);
    let (curation, curation_error) = match &*curated.read() {
        Some(Ok(c)) => (c.clone(), String::new()),
        Some(Err(e)) => (Curation::default(), e.to_string()),
        None => (Curation { modes: vec![], presets: vec![] }, String::new()),
    };
    // The mode chosen; none chosen = the first on offer.
    let mut picked = use_signal(String::new);
    let mode = curation.modes.iter().find(|m| m.name == picked()).or(curation.modes.first()).cloned().unwrap_or_default();
    let offers = |maker: &str| mode.makers.iter().any(|m| m == maker);
    let mut status = use_signal(String::new);
    let mut working = use_signal(|| false);
    // The form: the plan being filled in.
    let mut plan = use_signal(Plan::default);
    // The desk agent: the wish, and the page it last made.
    let mut wish = use_signal(String::new);
    let mut page = use_signal(String::new);
    let presets = curation.presets.clone();
    // The form starts from the first preset.
    let first_preset = presets.first().cloned();
    use_effect(use_reactive!(|first_preset| {
        if let Some(p) = first_preset {
            if plan.peek().scenario.is_empty() {
                let mut w = plan.write();
                w.scenario = p.scenario;
                w.rule = p.rule;
            }
        }
    }));
    let kinds: Vec<_> = kinds.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let usable: Vec<String> = kinds.iter().filter(|k| k.missing.is_empty()).map(|k| k.kind.clone()).collect();
    let first = usable.first().cloned().unwrap_or_default();
    // A new room starts with two seats on the first harness that can run.
    use_effect(use_reactive!(|first| {
        if plan.peek().seats.is_empty() && !first.is_empty() {
            plan.write().seats = ["A", "B"].iter().map(|n| SeatPlan { name: n.to_string(), role: String::new(), harness: first.clone() }).collect();
        }
    }));
    let list = all();
    let current = chosen().or(list.last().map(|r| r.id)).and_then(|id| list.iter().find(|r| r.id == id).cloned());
    let made = move |r: Result<Room, ServerFnError>| {
        working.set(false);
        match r {
            Ok(r) => {
                chosen.set(Some(r.id));
                status.set(String::new());
            }
            Err(e) => status.set(e.to_string()),
        }
    };
    let (first_seat, first_desk, first_page) = (first.clone(), first.clone(), first.clone());
    rsx! {
        div { class: "sessions fill",
            Pane { class: "stack sessions-side",
                h2 { "New" }
                if curation.modes.len() > 1 {
                    div { class: "segmented glass", role: "group", "aria-label": "Mode",
                        for m in curation.modes.iter() {
                            button { class: "seg", r#type: "button", "aria-pressed": "{m.name == mode.name}", title: "{m.about}",
                                onclick: { let n = m.name.clone(); move |_| picked.set(n.clone()) },
                                "{m.name}"
                            }
                        }
                    }
                }
                if !mode.about.is_empty() { p { class: "dim", "{mode.about}" } }
                if !curation_error.is_empty() { p { class: "chat-error", role: "alert", "{curation_error}" } }
                if offers("desk") || offers("view") {
                    form { class: "stack",
                        onsubmit: move |e: FormEvent| e.prevent_default(),
                        textarea { rows: "5", placeholder: "What do you want? e.g. a debate between an optimist and a sceptic about remote work", "aria-label": "Wish", value: "{wish}", oninput: move |e| wish.set(e.value()) }
                        div { class: "row",
                            if offers("desk") {
                                button { class: "btn primary", r#type: "button", disabled: working() || first.is_empty(),
                                    onclick: move |_| {
                                        let desk = first_desk.clone();
                                        let mut made = made;
                                        async move {
                                            working.set(true);
                                            status.set("the desk agent is designing the room…".into());
                                            made(room_design(wish(), desk).await);
                                        }
                                    },
                                    "Design a room"
                                }
                            }
                            if offers("view") {
                                button { class: "btn", r#type: "button", disabled: working() || first.is_empty(),
                                    onclick: move |_| {
                                        let desk = first_page.clone();
                                        async move {
                                            working.set(true);
                                            status.set("the desk agent is designing the page…".into());
                                            let r = room_view(wish(), desk).await;
                                            working.set(false);
                                            match r {
                                                Ok(at) => {
                                                    page.set(at);
                                                    status.set(String::new());
                                                }
                                                Err(e) => status.set(e.to_string()),
                                            }
                                        }
                                    },
                                    "Design a page"
                                }
                            }
                        }
                        if !page.read().is_empty() { p { class: "dim", "Page made: " a { href: "{page}", "{page}" } } }
                    }
                }
                if offers("form") {
                    form { class: "stack",
                        onsubmit: move |e: FormEvent| {
                            e.prevent_default();
                            let mut made = made;
                            async move {
                                working.set(true);
                                made(room_open(plan()).await);
                            }
                        },
                        select { "aria-label": "Preset",
                            onchange: {
                                let presets = presets.clone();
                                move |e: FormEvent| {
                                    if let Some(p) = presets.iter().find(|p| p.name == e.value()) {
                                        let mut w = plan.write();
                                        w.scenario = p.scenario.clone();
                                        w.rule = p.rule;
                                    }
                                }
                            },
                            for p in presets.iter() { option { value: "{p.name}", "{p.name}" } }
                        }
                        input { placeholder: "Title (optional)", "aria-label": "Title", value: "{plan.read().title}", oninput: move |e| plan.write().title = e.value() }
                        textarea { rows: "4", placeholder: "Scenario: what is going on, and the rules", "aria-label": "Scenario", value: "{plan.read().scenario}", oninput: move |e| plan.write().scenario = e.value() }
                        select { "aria-label": "Who speaks each step",
                            onchange: move |e| plan.write().rule = if e.value() == "turn" { Rule::Turn } else { Rule::Round },
                            option { value: "round", selected: plan.read().rule == Rule::Round, "every seat speaks each step" }
                            option { value: "turn", selected: plan.read().rule == Rule::Turn, "one seat speaks each step" }
                        }
                        for (i, s) in plan.read().seats.iter().cloned().enumerate() {
                            div { class: "stack seat-row", key: "{i}",
                                div { class: "row",
                                    input { placeholder: "Name", "aria-label": "Seat {i + 1} name", value: "{s.name}", oninput: move |e| plan.write().seats[i].name = e.value() }
                                    select { "aria-label": "Seat {i + 1} harness", onchange: move |e| plan.write().seats[i].harness = e.value(),
                                        for k in kinds.iter() {
                                            option { value: "{k.kind}", selected: k.kind == s.harness, disabled: !k.missing.is_empty(), title: "{k.missing}", "{k.kind}" }
                                        }
                                    }
                                    button { class: "btn quiet-danger", r#type: "button", "aria-label": "Remove seat {i + 1}", onclick: move |_| { plan.write().seats.remove(i); }, "×" }
                                }
                                input { placeholder: "Part to play", "aria-label": "Seat {i + 1} part", value: "{s.role}", oninput: move |e| plan.write().seats[i].role = e.value() }
                            }
                        }
                        div { class: "row",
                            button { class: "btn", r#type: "button", disabled: plan.read().seats.len() >= MAX_SEATS || first_seat.is_empty(),
                                onclick: move |_| {
                                    let n = plan.read().seats.len();
                                    let name = char::from(b'A' + n as u8).to_string();
                                    plan.write().seats.push(SeatPlan { name, role: String::new(), harness: first_seat.clone() });
                                },
                                "Add seat"
                            }
                            span { class: "grow" }
                            button { class: "btn primary", r#type: "submit", disabled: working() || plan.read().seats.is_empty(), "Start" }
                        }
                    }
                }
                if usable.is_empty() && !kinds.is_empty() { p { class: "dim", "No harness can run on this machine." } }
                if !status.read().is_empty() { p { class: if working() { "dim" } else { "chat-error" }, role: "status", "{status}" } }
                div { class: "stack session-list", role: "list",
                    if list.is_empty() { p { class: "dim", "No rooms yet." } }
                    for r in list.iter().rev() {
                        button { key: "{r.id}", class: "btn session-item", r#type: "button", role: "listitem",
                            "aria-pressed": "{current.as_ref().is_some_and(|c| c.id == r.id)}",
                            onclick: { let id = r.id; move |_| chosen.set(Some(id)) },
                            span { class: "grow", "{r.title}" }
                            span { class: "dim", if r.state == State::Busy { "{r.seats.len()} seats · speaking" } else { "{r.seats.len()} seats" } }
                        }
                    }
                }
            }
            match current {
                Some(r) => rsx! { Table { key: "{r.id}", room: r } },
                None => rsx! { Pane { class: "stack", p { class: "dim", "Make a room to put agents around one table." } } },
            }
        }
    }
}

/// One room: the setup, what was said, and a box to speak or to let the seats go on.
#[component]
fn Table(room: Room) -> Element {
    let mut input = use_signal(String::new);
    let mut error = use_signal(String::new);
    let busy = room.state == State::Busy;
    let id = room.id;
    let lines = room.lines.len();
    use_effect(use_reactive!(|(lines, busy)| {
        let _ = (lines, busy);
        document::eval("requestAnimationFrame(() => { const b = document.querySelector('.session-talk .bubbles'); if (b) b.scrollTop = b.scrollHeight; })");
    }));
    let send = move |e: FormEvent| {
        e.prevent_default();
        async move {
            match room_say(id, input()).await {
                Ok(()) => {
                    input.set(String::new());
                    error.set(String::new());
                }
                Err(e) => error.set(e.to_string()),
            }
        }
    };
    let next = room.seats.get(room.next % room.seats.len().max(1)).map(|s| s.name.clone()).unwrap_or_default();
    rsx! {
        Pane { class: "stack session-talk",
            div { class: "row",
                h2 { "{room.title}" }
                span { class: "grow" }
                for s in room.seats.iter() { span { class: "badge", title: "{s.role}", "{s.name} · {s.harness}" } }
            }
            details { class: "dim", summary { "The setup" } pre { class: "room-setup", "{room.scenario}" } }
            div { class: "bubbles",
                if room.lines.is_empty() { p { class: "dim", "Say something, or let the seats begin." } }
                for (i, l) in room.lines.iter().enumerate() {
                    div { key: "{i}", class: if l.who == USER { "bubble user" } else { "bubble model" },
                        span { class: "dim", if l.who == USER { "you" } else { "{l.who}" } }
                        pre { "{l.text}" }
                    }
                }
                if busy { p { class: "dim", role: "status", "{next} is speaking…" } }
                if !room.error.is_empty() { p { class: "chat-error", role: "alert", "{room.error}" } }
                if !error.read().is_empty() { p { class: "chat-error", role: "alert", "{error}" } }
            }
            form { class: "row session-composer", onsubmit: send,
                textarea { class: "grow", rows: "2", placeholder: "Say something to the room, or leave empty to let {next} go on", "aria-label": "Say", value: "{input}",
                    oninput: move |e| input.set(e.value()),
                    onkeydown: move |e: KeyboardEvent| {
                        if e.key() == Key::Enter && !e.modifiers().shift() {
                            e.prevent_default();
                            document::eval("document.querySelector('.session-composer')?.requestSubmit()");
                        }
                    },
                }
                button { class: "btn primary", r#type: "submit", disabled: busy, if input.read().trim().is_empty() { "Go on" } else { "Say" } }
            }
        }
    }
}
