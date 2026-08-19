//! `Terminal` — the Alpine workspace (plan, "UI shape": the one component with
//! no Python counterpart). It owns the command you are typing and nothing else;
//! the scrollback is the core's projection of the `exec` facts (I8), the same
//! list whether the agent ran the command or you did, still there after a reload.

pub(crate) mod attribution;
pub(crate) mod stop;

use std::rc::Rc;

use adapters_web::{sleep, WebApp};
use dioxus::prelude::*;
use kernel::Request;

use crate::terminal::stop::StopCommand;
use crate::ui::{Button, Card, EmptyState, Field, Form, Skeleton};
/// A command runs in the async half, so the pane re-reads until the scrollback grows. 700 ms: a
/// person watches, not races; `MAX_TICKS` is generous because the FIRST command waits on the boot.
const TICK_MS: i32 = 700;
/// The command field's id: the workspace EmptyState's action focuses it.
const COMMAND_ID: &str = "workspace-command";
const MAX_TICKS: usize = 430; // ~5 minutes

/// How many commands the scrollback holds: the core counts, this reads back.
fn commands_in(html: &str) -> usize {
    html.split_once("data-commands=\"")
        .and_then(|(_, rest)| rest.split_once('"'))
        .and_then(|(n, _)| n.parse().ok())
        .unwrap_or(0)
}

/// Re-read the scrollback from the core, for the SELECTED agent (10 walk,
/// finding 3): this was the one per-agent read that sent no `x-agent`. The
/// second return is whether a command TYPED here would run in the workspace
/// this pane names — the core's own answer, on a header, because the box was
/// live for every agent while always executing in this page's own space (11b
/// walk), and since R6-13 it is whether the box is rendered at all.
fn scrollback(web: &Signal<Option<Rc<WebApp>>>, agent: &str) -> (String, bool, String, String) {
    let Some(app) = web.peek().clone() else {
        return (String::new(), false, String::new(), String::new());
    };
    let res = app.handle(Request::get("/terminal").with_header("x-agent", agent));
    let typeable = res.headers.iter().any(|(k, v)| k == "x-typeable" && v == "1");
    let header = |name: &str| {
        res.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()).unwrap_or_default()
    };
    // …and WHAT A STOP WOULD DO in this build (R11-1b): the two engines can do
    // two different things about a command already running, and the button that
    // offers it must not describe them with one word. …and WHY THERE IS NO BOX,
    // when there is none (R16-P1-3): the field and the Run button vanished for a
    // read-only agent with nothing on the view saying so, and the core is the
    // side that knows which tools the agent's file names.
    (res.body.clone(), typeable, header("x-interrupt"), header("x-typeable-why"))
}

/// The workspace before its first command, SAYING WHAT IT COUNTS
/// (R10-8): it read `Nothing has been run yet` under `COMMANDS · MAIN` after
/// main had run six tools in that workspace — starting processes and reading
/// files, none of which is a shell command, which is all this pane holds.
fn nothing_run() -> Element {
    rsx! {
        EmptyState {
            title: "No shell command has been run here yet",
            // ONE SENTENCE (R8-EMPTY): what this pane holds, and where the
            // rest of the agent's work is — and the rule is now true
            // (R15-P1-4), since the trace no longer renders `exec` too.
            sentence: "This panel holds shell commands — the agent's and the ones you type — \
                       and its file and process work is in the Tool trace instead.",
            // NO ACTION (R15-P1-8). `Run a first command` focused a field that
            // is on screen, ~200px below, in the same card.
        }
    }
}

#[component]
pub fn Terminal(
    web: Signal<Option<Rc<WebApp>>>,
    tick: Signal<u32>,
    agent: ReadSignal<String>,
) -> Element {
    let mut panel = use_signal(String::new);
    let mut draft = use_signal(String::new);
    let mut running = use_signal(|| false);
    let mut typeable = use_signal(|| false);
    let mut interrupt = use_signal(String::new);
    let mut no_box = use_signal(String::new);
    use_hook(adapters_web::prewarm); // WHERE the ~47 MB starts moving, not page load (c2w.rs)
    use_effect(move || {
        let _ = (tick(), agent());
        let (body, can_type, how, why) = scrollback(&web, &agent());
        typeable.set(can_type);
        interrupt.set(how);
        no_box.set(why);
        if *panel.peek() != body { crate::ui::show_newest_soon("terminal"); } // R14-P1-5
        panel.set(body);
    });
    let mut submit = move || {
        let command = draft().trim().to_string();
        if command.is_empty() || running() || !typeable() {
            return;
        }
        let Some(app) = web.peek().clone() else { return };
        let before = commands_in(&panel.peek().clone());
        draft.set(String::new());
        running.set(true);
        panel.set(
            app.handle(
                Request::post_form("/terminal", &[("command", &command)])
                    .with_header("x-agent", &agent()),
            )
            .body,
        );
        spawn(async move {
            // The echoed "running…" is at the bottom of the scrollback too.
            let _ = sleep(30).await; crate::ui::show_newest("terminal");
            // Watch until the command COUNT rises, not until the pane stops
            // changing: a first boot streams a disk and looks identical for
            // every one of those ticks. An optimisation only — the page's
            // heartbeat re-reads this pane too (R2-8).
            for _ in 0..MAX_TICKS {
                if sleep(TICK_MS).await.is_err() {
                    break;
                }
                let (next, ..) = scrollback(&web, &agent());
                if commands_in(&next) > before {
                    panel.set(next);
                    // The DOM catches up next frame, then scroll.
                    let _ = sleep(30).await;
                    crate::ui::show_newest("terminal");
                    break;
                }
            }
            running.set(false);
        });
    };
    let projection = panel.read().clone();
    let who = agent();
    // Nothing has been run, nothing is RUNNING (R2-8: an empty state over a
    // command in flight is that round's bug), and a command typed HERE runs.
    let idle = projection.contains("data-running=\"0\"");
    // SOMETHING IS RUNNING, from the projection and not from this component's
    // own flag (R11-1): the flag knew only about commands typed HERE and died
    // with it, while `data-running` counts the agent's too.
    let (in_flight, how) = (!projection.is_empty() && !idle, interrupt());
    let fresh = !projection.is_empty() && commands_in(&projection) == 0 && idle && typeable();
    // WHETHER THIS AGENT HAS A LINUX AT ALL — the core's own answer (R10-11).
    let alone = projection.contains("data-workspace=\"none\"");
    rsx! {
        // "Commands", not "Workspace terminal" (R7-7): one concept had three
        // names and it is not a terminal. The view is the Workspace; its
        // halves are Commands and Files.
        Card { title: "Commands · {who}", aria_label: "Commands for {who}",
            div { aria_live: "polite",
                if projection.is_empty() {
                    Skeleton { lines: 3, label: "Reading the folder's scrollback" }
                } else if fresh {
                    {nothing_run()}
                } else {
                    div { dangerous_inner_html: "{projection}" }
                }
            }
            // NOT RENDERED FOR AN AGENT THAT CANNOT USE IT (R6-13). A dead
            // `Run command` box carrying `disabled` and nothing saying so sat
            // under the sentence explaining why it was dead, which reads as a
            // caption on something you can still try.
            if in_flight && typeable() { StopCommand { web, agent, how: how.clone(), panel } }
            if typeable() {
            Form { oneline: true, onsubmit: move |_| submit(),
                Field {
                    id: COMMAND_ID,
                    r#type: "text",
                    value: "{draft}",
                    aria_label: "Command to run in the folder",
                    placeholder: "uname -a",
                    autocomplete: "off",
                    // In-flight only: cannot-at-all does not render (R6-13).
                    disabled: running(),
                    oninput: move |e: FormEvent| draft.set(e.value()),
                }
                // "Run command", never "Run" (R2-10): the Dashboard's "Run"
                // starts an AGENT; this runs one shell line. Empty = disabled.
                Button {
                    variant: "primary",
                    submit: true,
                    disabled: running() || draft.read().trim().is_empty(),
                    if running() { "Running…" } else { "Run command" }
                }
            }
            }
            // …AND WHY THERE IS NONE (R16-P1-3): the box simply disappeared on
            // switching to a read-only agent, explained only on another view.
            if !typeable() && !no_box.read().is_empty() {
                p { class: "note", role: "status", "{no_box}" }
            }
            // WHOSE LINUX THIS IS (`attribution.rs`) — and nothing at all for an
            // agent that runs no commands in one (R10-11).
            if !alone { {crate::terminal::attribution::credit()} }
        }
    }
}
