//! # askk
//!
//! The folders are the map. A problem has one place:
//!
//! | folder | question it answers | may use |
//! | --- | --- | --- |
//! | `core/` | what things are and how they behave | the language only |
//! | `elements/` | the kinds of object an engine is made of | `core` |
//! | `host/` | how it is done on this machine (server only) | `core`, `elements` |
//! | `local/` | how it is done inside a browser tab (`local` build only; a spike) | `core`, `elements` |
//! | `api/` | what a window may ask, and the answers (plain functions) | `core`; `host` where a port is still missing |
//! | `ui/` | how it is drawn | `core`, `api` |
//! | `shells/` | what holds the window | `ui`, `api` |
//!
//! `structure.rs` holds the tests that keep these walls up.
// The tab's page asks only some of the questions; the rest are there for the real UI.
#[cfg_attr(feature = "local", allow(dead_code, unused_imports))]
mod api;
#[cfg(all(feature = "local", any(feature = "server", feature = "web", feature = "desktop", feature = "mobile")))]
compile_error!("`local` (the engine inside a browser tab) is a build of its own: build it with `--no-default-features --features local` (scripts/local.sh), not together with server, web, desktop or mobile");
// The engine runtime lives on the server; other builds only need the shared shapes.
#[cfg_attr(not(feature = "server"), allow(dead_code, unused_imports))]
mod core;
#[cfg_attr(not(feature = "server"), allow(dead_code, unused_imports))]
mod elements;
#[cfg(feature = "server")]
mod host;
#[cfg(feature = "local")]
mod local;
#[cfg(not(feature = "local"))]
mod shells;
#[cfg(test)]
mod structure;
mod ui;

#[cfg(not(feature = "local"))]
pub use ui::web::app::Route;

fn main() {
    #[cfg(feature = "server")]
    {
        let args: Vec<String> = std::env::args().collect();
        // `askk start | stop | status | restart`: the service in the background. This process
        // only starts, asks or stops it, says how that went, and leaves.
        if let Some(verb) = shells::service::wanted(&args) {
            std::process::exit(shells::service::tell(verb, host::service::act(verb, &args)));
        }
        // `askk terminal`: the same host, shown as lines instead of pages. With `--to`, or
        // with a service already running for this home, it only talks to that one, so no
        // host is started here.
        if let Some(wanted) = shells::terminal::wanted(&args) {
            let wanted = shells::terminal::attach(wanted, host::service::running(&args));
            if wanted.to.is_none() {
                host::start(args);
            }
            std::process::exit(shells::terminal::launch(wanted));
        }
        // Anything else is the service itself: it listens, so it leaves a record to be found by.
        host::serve(args);
    }
    // The tab is its own host: no server to ask, so it draws its own page.
    #[cfg(feature = "local")]
    local::launch();
    #[cfg(not(feature = "local"))]
    shells::launch();
}
