//! askk-frontend: the Dioxus browser shell over the finished runtime.
//!
//! wasm → `dioxus::launch(App)`. Host → a living smoke binary: boots the
//! facade with a scripted MockProvider, drives one happy-path run, prints
//! the folded timeline (`cargo run -p askk-frontend`).

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
