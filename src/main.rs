use dioxus::prelude::*;
use wasm_bindgen_futures::spawn_local;

mod components;
mod engine;
mod inference;
mod responses;
mod state;
mod storage;
mod tools;

use components::{set_status, AppShell};
use state::AppSnapshot;
use storage::{IndexedDbStorage, StorageAdapter};

fn main() {
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
                    Ok(Some(saved)) => snapshot.set(saved),
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
