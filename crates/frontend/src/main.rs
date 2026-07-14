//! askk-frontend — Dioxus components only: UI = fold(signals). Views under
//! `ui/` render projections from the `askk_browser` boot facade and send
//! commands back through it; no engine, storage, or web_sys access here.
//!
//! wasm → `dioxus::launch(App)`. Host → a living smoke binary: boots the
//! facade with a scripted MockProvider, drives one happy-path run, prints
//! the folded timeline (`cargo run -p askk-frontend`).
//!
//! Imports: core and browser only (kiln rule: the app imports only the
//! contracts). Imported by: nothing — this is the app.
//!
//! See MAP.md and docs/NAVIGATION.md.

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
mod ui;

#[cfg(target_arch = "wasm32")]
fn main() {
    dioxus::launch(ui::app::App);
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    use askk_browser::boot;
    use askk_core::RunStatus;

    boot::block_on(async {
        let handle = boot::host_session().await.expect("host session boots");
        let run = handle
            .submit("assistant", "Say hello via the echo tool.")
            .await
            .expect("submit accepts the baked agent");
        handle.drive().await;
        let projection = handle.projection(&run);
        println!(
            "run {} — {:?} in {} turns",
            run.0, projection.status, projection.turns_used
        );
        for line in &projection.timeline {
            println!("  | {line}");
        }
        for message in &projection.messages {
            println!("  [{:?}] {}", message.role, message.content);
        }
        assert_eq!(
            projection.status,
            RunStatus::Answered,
            "smoke run must answer"
        );
        println!("SMOKE GREEN");
    });
}
