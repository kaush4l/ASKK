//! Hand an agent a task and walk away (15L). Everything until now started work
//! by TALKING to an agent, and the other half — "a way to simply run the agents
//! without human intervention" — had no control at all. This is the same seam
//! call the composer makes (`POST /chat` addressed with `x-agent`), for an agent
//! you are NOT talking to: it starts a turn in that agent's own Worker and
//! returns at once, and the card says how far it has got.

use std::rc::Rc;

use adapters_web::WebApp;
use dioxus::prelude::*;
use kernel::Request;

use crate::ui::{enter_submits, key_hint, Button, Card, Disclosure, Field, Form};
use crate::views::View;

/// Give one agent a task. `agent` is whoever the page has selected — the same
/// subject the rest of this view and the rail already have.
#[component]
pub fn TaskLauncher(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
    /// The `/agents` projection, for the ONE fact that decides whether there is
    /// a task to start at all and which starter tasks finish (R6-1, 29).
    agents: Signal<String>,
    /// So "watch it" is one press and not a hunt through the nav.
    view: Signal<View>,
) -> Element {
    let mut task = use_signal(String::new);
    // WHAT was launched, at WHOM, and where that agent's row stood BEFORE the
    // press (R2-2), SEEDED FROM THE LOG (R8-6) — and RE-SEEDED WHENEVER THE
    // SUBJECT CHANGES (R9-2). Seeded once at mount, switching agent mid-run left
    // `main`'s run in a card headed `RUN A TASK · RESEARCHER` with no composer.
    // A scoped panel shows its own scope; this effect is that rule.
    let mut sent = use_signal(|| None::<(String, String, u64)>);
    use_effect(move || {
        let who = agent();
        let _ = web.read(); // …and again once the core has answered at all
        sent.set(crate::receipt::last_run(web, &who));
    });
    let who = agent();
    let mut fire = move |text: String| {
        let Some(app) = web.peek().clone() else { return };
        let target = agent();
        let before = crate::runstatus::since(&web, &target);
        app.handle(
            Request::post_form("/chat", &[("message", text.as_str())])
                .with_header("x-agent", &target),
        );
        task.set(String::new());
        sent.set(Some((target, text, before)));
        // Every panel that follows an agent redraws off this.
        let mut tick = tick;
        let n = tick.peek().to_owned();
        tick.set(n + 1);
    };
    let mut launch = move || {
        let text = task.peek().trim().to_string();
        if !text.is_empty() {
            fire(text);
        }
    };
    // THE BOARD, READ ONCE FOR THIS CARD (R6-6). Read inside `LaunchedRun`,
    // the card around it could not know whether its own run was still going.
    let mut board = use_signal(String::new);
    // …and WHO ELSE IS WORKING, off the same response's `x-busy` (R9-2). One
    // read, two facts: the header the chrome's run pill already lives on.
    let mut busy = use_signal(String::new);
    use_effect(move || {
        let _ = tick();
        if let Some(app) = web.read().clone() {
            let res = app.handle(Request::get("/board"));
            let head = res.headers.iter().find(|(k, _)| k == "x-busy");
            busy.set(head.map(|(_, v)| v.clone()).unwrap_or_default());
            board.set(res.body);
        }
    });
    let projection = board.read().clone();
    let running = sent()
        .map(|(target, _, before)| crate::runstatus::live(&projection, &target, before))
        .unwrap_or(false);
    // WHAT THIS AGENT CAN DO, off the card's own `data-can` (29): the answer the
    // Agents view's doors are drawn from, so the Dashboard cannot offer a turn
    // the roster says is impossible. Empty while the roster loads — it acts, as
    // it always has, and is offered no examples, the set being chosen by an
    // answer nobody has yet.
    let can = crate::runstatus::cell(&agents.read(), &who, "data-can").unwrap_or_default();
    let acts = can != "read";
    // Somebody ELSE's run, named in one line rather than shown in this card
    // (R9-2). The board below lists every agent; what this adds is the DOOR, to
    // a run that was in this card a second ago.
    let elsewhere =
        busy.read().split(", ").find(|n| !n.is_empty() && *n != who).map(str::to_string);
    rsx! {
        // The TARGET is in the title (F2), and since 30 so is `can`: `Run a
        // task · critic` stood over a body saying there is no task to start.
        Card { title: if acts { format!("Run a task · {who}") } else { format!("Ask {who} · this one takes no tasks") },
            aria_label: "This panel is about {who}",
            // FIRST IN THE CARD, ABOVE THE FOLD, WHERE THE BUTTON WAS (R6-6):
            // the state of the run REPLACES the invitation to start one rather
            // than being patched in underneath it, and everything below is
            // rendered only while there is nothing to replace.
            if let Some((target, text, before)) = sent() {
                crate::runstatus::LaunchedRun {
                    board: projection.clone(), view,
                    who: target, task: text, baseline: before,
                    on_retry: move |t: String| { let mut again = fire; again(t) },
                }
            }
            // NO START CONTROL FOR AN AGENT THAT CANNOT ACT (29), and the reason
            // in words where it would have been. R2-12's precedent: a control
            // that does not apply here is NOT RENDERED, not rendered dead.
            if !running && !acts { {crate::examples::no_task(&who)} }
            if !running && acts {
                p { class: "note",
                    "Give {who} a task and walk away — it works on its own, and “Agents and \
                     what they are doing” below says how far it has got."
                }
                Form {
                    oneline: true,
                    onsubmit: move |_| launch(),
                    Field {
                        id: "task-field",
                        rows: 3, // the product's PRIMARY INPUT, once a 44px line (R4-4)
                        class: "grows",
                        value: "{task}",
                        aria_label: "Task for {who}",
                        placeholder: "Describe the whole task — what to make, where to put it, \
                                      and what to tell you when it is done…",
                        autocomplete: "off",
                        oninput: move |e: FormEvent| task.set(e.value()),
                        onkeydown: move |e: KeyboardEvent| {
                            if enter_submits(&e) {
                                e.prevent_default();
                                launch();
                            }
                        },
                    }
                    // "Start agent", never "Run" (R2-10): this press dispatches an
                    // agent that works on its own for as many steps as it likes,
                    // where the Workspace's button runs one shell line. DISABLED
                    // until there is a task (R2-9).
                    Button {
                        variant: "primary",
                        submit: true,
                        disabled: task.read().trim().is_empty(),
                        "Start agent"
                    }
                    // WHAT THE KEYS DO (R5-5). INSIDE the form, like the
                    // composer's: `flex-basis: 100%` means WIDTH in the form's row
                    // and HEIGHT in the card's column — outside, it was a 699px
                    // paragraph that pushed the examples off screen.
                    {key_hint()}
                }
                // WHY the primary is dead (R3-15). A disabled button was painted
                // a shade off the secondary beside it and explained itself
                // nowhere; `controls.css` paints it, this says it.
                if task.read().trim().is_empty() {
                    p { class: "note", "Start agent is off until you have typed a task." }
                }
                // …AND THE EXAMPLES DO NOT VANISH ON THE FIRST KEYSTROKE (R8-EX).
                // Typing one character deleted three buttons and a lead: the card
                // collapsed ~330px under the cursor. They go only when there is a
                // RUN to report (R6-6).
                {crate::examples::picks(task, &who, &can)}
            }
            // ONE LINE, AND A DOOR (R9-2). Not this card's run, so not this
            // card's card: the hash IS the view and its subject (R6-3), so
            // naming the other conversation is the whole navigation.
            if let Some(other) = elsewhere {
                p { class: "note", role: "status",
                    "{other} is still working on a task of its own — this panel is {who}'s."
                    Button {
                        variant: "ghost",
                        onclick: {
                            let other = other.clone();
                            move |_| crate::route::show(View::Chat, &other)
                        },
                        "Open {other}'s chat"
                    }
                }
            }
            // The six lines this panel used to spend introducing one text field
            // (F9). NOT SHOWN WHERE THERE IS NO BUTTON TO PRESS (29) — and it no
            // longer promises commands, a claim about the toolbox rather than
            // about this panel.
            if acts {
                Disclosure { summary: "What happens when you press Start agent",
                    p { class: "note",
                        "{who} works in the background, on its own: it uses the tools its file \
                         names, for as many steps as its own settings allow. Nothing on this \
                         page waits for it — switch views, or open Chat and join the \
                         conversation, without restarting anything."
                    }
                }
            }
        }
    }
}
