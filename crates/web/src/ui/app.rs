//! App layout: header, agent rail, run column (composer → timeline →
//! pending actions → status line), settings drawer. UI = fold(signals);
//! every command goes through the host facade (ADR-003/013).

use std::rc::Rc;

use dioxus::prelude::*;

use askk_core::{RunId, RunProjection, RunStatus};

use crate::host::boot::{self, HarnessHandle, ProviderProfileForm};
use crate::ui::actions::PendingActionsBar;
use crate::ui::settings::SettingsDrawer;
use crate::ui::timeline::Timeline;

const CSS: &str = include_str!("main.css");

fn status_label(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Running => "running",
        RunStatus::Answered => "answered",
        RunStatus::Unverified => "unverified",
        RunStatus::BudgetExhausted => "budget exhausted",
        RunStatus::Interrupted => "interrupted",
        RunStatus::Failed => "failed",
    }
}

#[component]
pub fn App() -> Element {
    // Bumped by the host on every stamped signal — reading it below
    // subscribes the view, so each signal triggers a refold (cheap here).
    let refold = use_signal(|| 0u64);
    let mut handle = use_signal(|| Option::<Rc<HarnessHandle>>::None);
    let mut boot_error = use_signal(|| Option::<String>::None);
    let mut ui_error = use_signal(|| Option::<String>::None);
    let mut current = use_signal(|| Option::<RunId>::None);
    let mut input = use_signal(String::new);
    let mut agent_id = use_signal(String::new);
    let mut show_settings = use_signal(|| false);
    let mut profile = use_signal(ProviderProfileForm::default);
    let mut busy = use_signal(|| false);

    use_future(move || async move {
        let notify: Box<dyn Fn()> = Box::new(move || {
            let mut counter = refold;
            counter += 1;
        });
        match boot::session(notify).await {
            Ok(h) => {
                profile.set(h.get_profile());
                if let Some(first) = h.agents().first() {
                    agent_id.set(first.id.clone());
                }
                handle.set(Some(Rc::new(h)));
            }
            Err(e) => boot_error.set(Some(e)),
        }
    });

    let _tick = refold();
    let cards = handle().map(|h| h.agents()).unwrap_or_default();
    let projection: Option<RunProjection> = match (handle(), current()) {
        (Some(h), Some(run_id)) => Some(h.projection(&run_id)),
        _ => None,
    };

    let on_submit = move |_| {
        let Some(h) = handle() else { return };
        let goal = input().trim().to_string();
        if goal.is_empty() || busy() {
            return;
        }
        let agent = agent_id();
        busy.set(true);
        ui_error.set(None);
        spawn(async move {
            match h.submit(&agent, &goal).await {
                Ok(run_id) => {
                    current.set(Some(run_id));
                    input.set(String::new());
                    h.drive().await;
                }
                Err(e) => ui_error.set(Some(e)),
            }
            busy.set(false);
            let mut counter = refold;
            counter += 1;
        });
    };

    let on_resolve = move |(action_id, approve): (String, bool)| {
        let Some(h) = handle() else { return };
        spawn(async move {
            h.resolve(&action_id, approve).await;
            let mut counter = refold;
            counter += 1;
        });
    };

    let on_save = move |form: ProviderProfileForm| {
        let Some(h) = handle() else { return };
        profile.set(form.clone());
        show_settings.set(false);
        spawn(async move {
            if let Err(e) = h.set_profile(form).await {
                ui_error.set(Some(e));
            }
        });
    };

    rsx! {
        document::Style { {CSS} }
        div { class: "app",
            header { class: "topbar",
                h1 { class: "brand", "ASKK" }
                button { class: "ghost", onclick: move |_| show_settings.set(!show_settings()), "Settings" }
            }
            div { class: "body",
                nav { class: "rail",
                    h2 { class: "rail-title", "Agents" }
                    for card in cards {
                        button {
                            key: "{card.id}",
                            class: if agent_id() == card.id { "agent active" } else { "agent" },
                            onclick: {
                                let id = card.id.clone();
                                move |_| agent_id.set(id.clone())
                            },
                            div { class: "agent-name", "{card.name}" }
                            div { class: "agent-desc", "{card.description}" }
                        }
                    }
                }
                main { class: "run",
                    div { class: "composer",
                        textarea {
                            class: "goal",
                            placeholder: "What should the agent do?",
                            value: "{input}",
                            oninput: move |e| input.set(e.value()),
                        }
                        button {
                            class: "primary",
                            disabled: busy() || handle().is_none(),
                            onclick: on_submit,
                            if busy() { "Running…" } else { "Submit" }
                        }
                    }
                    if let Some(e) = boot_error() {
                        div { class: "row error", "boot failed: {e}" }
                    }
                    if let Some(e) = ui_error() {
                        div { class: "row error", "{e}" }
                    }
                    if let Some(p) = projection {
                        Timeline { projection: p.clone() }
                        if !p.pending_actions.is_empty() {
                            PendingActionsBar { records: p.pending_actions.clone(), on_resolve }
                        }
                        div { class: "statusline",
                            "{status_label(p.status)} — {p.turns_used} turns"
                        }
                    } else {
                        div { class: "empty",
                            "No run yet. Pick an agent, describe the goal, submit."
                        }
                    }
                }
            }
            if show_settings() {
                SettingsDrawer {
                    profile: profile(),
                    on_save,
                    on_close: move |_| show_settings.set(false),
                }
            }
        }
    }
}
