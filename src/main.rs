use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

mod agent_prompt;
mod components;
// Parts of the core's public surface are exercised only by host tests today
// (NoHooks, the mock-inference seam) or reserved for modality wiring (Part
// constructors); the bin-target lints cannot see test usage. Pruned/narrowed
// as the loop-level shell tests and a Part-capable provider land.
#[allow(dead_code, unused_imports)]
mod core;
mod engine;
mod inference;
mod mcp;
mod responses;
mod scheduler;
mod shell;
mod state;
mod storage;
mod strategy;
mod tools;
mod worker;
mod workflow;

use components::{AppShell, set_status};
use state::{AppSnapshot, RunStatus};
use storage::{IndexedDbStorage, StorageAdapter};

fn main() {
    #[cfg(target_arch = "wasm32")]
    {
        // Surface any panic to the browser console instead of failing silently, so
        // an unexpected error is visible and debuggable rather than a blank tab.
        std::panic::set_hook(Box::new(|info| {
            web_sys::console::error_1(&wasm_bindgen::JsValue::from_str(&format!(
                "ASKK panic: {info}"
            )));
        }));

        let global = js_sys::global();
        let has_document =
            js_sys::Reflect::has(&global, &wasm_bindgen::JsValue::from_str("document"))
                .unwrap_or(false);
        if !has_document {
            return;
        }
    }
    dioxus::launch(App);
}

#[component]
fn App() -> Element {
    let mut snapshot = use_signal(AppSnapshot::default);
    let goal = use_signal(String::new);
    let new_agent_name = use_signal(|| "Specialist".to_string());
    let new_agent_role = use_signal(|| {
        "Handle a focused part of the goal and use compiled tools when useful.".to_string()
    });
    let provider_models = use_signal(Vec::<String>::new);

    use_effect(move || {
        spawn_local(async move {
            match IndexedDbStorage::open().await {
                Ok(storage) => match storage.load_snapshot().await {
                    Ok(Some(saved)) => {
                        snapshot.set(saved.clone());
                        if saved
                            .current_run
                            .as_ref()
                            .is_some_and(|run| run.status == RunStatus::Paused)
                        {
                            let _ = storage.save_snapshot(&saved).await;
                        }
                    }
                    Ok(None) => {}
                    Err(err) => set_status(&mut snapshot, format!("Load failed: {err}")),
                },
                Err(err) => set_status(&mut snapshot, err),
            }
        });
    });

    rsx! {
        AppShell {
            snapshot,
            goal,
            new_agent_name,
            new_agent_role,
            provider_models,
        }
    }
}
