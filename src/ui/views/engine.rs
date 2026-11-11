use crate::api::{engine_view, run_engine, workspace_view};
use crate::ui::render::Render;
use crate::ui::components::{Icon, Pane};
use dioxus::prelude::*;

/// Where the browser keeps which side the prompt sits on (one choice for every engine page).
const SIDE_KEY: &str = "engine-page-prompt-side";

/// Which side of the engine page the prompt view takes; the elements take the other.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}

impl Side {
    pub fn parse(s: &str) -> Side {
        if s.trim() == "left" { Side::Left } else { Side::Right }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }
    pub fn flip(self) -> Side {
        match self {
            Side::Left => Side::Right,
            Side::Right => Side::Left,
        }
    }
}

/// One engine: two regions side by side, its elements (or, when it has a workspace, the IDE)
/// and the prompt it would send. A control swaps the sides; the choice is kept in the browser.
/// Which engine: the page's `path` param (`routes/e/[...path]`).
#[component]
pub fn EngineView() -> Element {
    let path = try_use_context::<crate::core::routes::Params>().and_then(|p| p.0.get("path").cloned()).unwrap_or_default();
    // Keyed by path: moving to another engine starts its page fresh.
    rsx! { EnginePage { key: "{path}", path: path.clone() } }
}

#[component]
fn EnginePage(path: String) -> Element {
    let mut side = use_signal(|| Side::Right);
    let mut show_ide = use_signal(|| true);
    let p = path.clone();
    let ide = use_resource(move || { let p = p.clone(); async move { workspace_view(p).await } });
    let has_ws = matches!(&*ide.read(), Some(Ok(v)) if v.workspace.is_some());
    // Browser-only: read the saved side after hydration.
    use_effect(move || {
        spawn(async move {
            let js = format!("try {{ return localStorage.getItem('{SIDE_KEY}') || ''; }} catch (e) {{ return ''; }}");
            if let Ok(v) = document::eval(&js).await {
                if let Some(s) = v.as_str() {
                    side.set(Side::parse(s));
                }
            }
        });
    });
    let swap = move |_| {
        let next = side().flip();
        side.set(next);
        document::eval(&format!("try {{ localStorage.setItem('{SIDE_KEY}', '{}'); }} catch (e) {{}}", next.as_str()));
    };
    let ide_on = has_ws && show_ide();
    rsx! {
        div { class: "engine-page fill",
            div { class: "row engine-bar",
                h2 { class: "grow mono", "{path}" }
                if has_ws {
                    div { class: "segmented glass", role: "group", "aria-label": "Engine region",
                        button { class: "seg", "aria-pressed": "{ide_on}", onclick: move |_| show_ide.set(true), Icon { name: "file", size: 16 } "Workspace" }
                        button { class: "seg", "aria-pressed": "{!ide_on}", onclick: move |_| show_ide.set(false), Icon { name: "layers", size: 16 } "Elements" }
                    }
                }
                button { class: "btn", title: "Swap the prompt and the engine sides", onclick: swap,
                    Icon { name: "split", size: 16 }
                    if side() == Side::Left { "Prompt left · swap" } else { "Prompt right · swap" }
                }
            }
            div { class: if side() == Side::Left { "engine-split prompt-left" } else { "engine-split" },
                div { class: "engine-main",
                    if ide_on {
                        super::ide::IdeView { path: path.clone() }
                    } else {
                        EngineElements { path: path.clone() }
                    }
                }
                super::prompt::PromptView { path: path.clone(), input: String::new(), class: "engine-prompt" }
            }
        }
    }
}

/// The engine's own view (all elements) and an input: the engine is a tool, input → answer.
#[component]
fn EngineElements(path: ReadSignal<String>) -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engine(&path()));
    let mut view = use_resource(move || {
        let _ = live();
        engine_view(path())
    });
    let mut input = use_signal(String::new);
    let mut answer = use_signal(String::new);
    let mut busy = use_signal(|| false);
    let run = move |_| async move {
        busy.set(true);
        answer.set(match run_engine(path(), input()).await { Ok(a) => a, Err(e) => format!("error: {e}") });
        busy.set(false);
        view.restart();
    };
    rsx! {
        div { class: "engine-elements",
            // The last runs as tiny cards: open one to read the loop step by step.
            super::loops::RunStrip { path }
            match &*view.read() {
                Some(Ok(n)) => rsx! { Render { node: n.clone() } },
                Some(Err(e)) => rsx! { Pane { p { "{e}" } } },
                None => rsx! {},
            }
            Pane { class: "stack",
                div { class: "row",
                    input { class: "grow", value: "{input}", oninput: move |e| input.set(e.value()) }
                    button { class: "btn primary", disabled: busy(), onclick: run, if busy() { {ui.t("running")} } else { {ui.t("run")} } }
                    if busy() {
                        button { class: "btn", onclick: move |_| async move { let _ = crate::api::stop_engine(path()).await; }, {ui.t("stop")} }
                    }
                }
                if !answer.read().is_empty() { pre { class: "reply", "{answer}" } }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Side;

    #[test]
    fn side_round_trips_and_defaults_right() {
        assert_eq!(Side::parse("left"), Side::Left);
        assert_eq!(Side::parse(""), Side::Right);
        assert_eq!(Side::parse("junk"), Side::Right);
        assert_eq!(Side::parse(Side::Left.as_str()), Side::Left);
        assert_eq!(Side::Left.flip(), Side::Right);
    }
}
