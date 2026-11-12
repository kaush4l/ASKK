//! Answers: the service itself.
//!
//! Plain functions over the core: no UI library, no wire. Whoever asks (a Dioxus window, the
//! `/ask` route, the tab's own page) gets the same answer, and an error is one sentence.
use super::*;

/// Who the service is right now: version, build, since when, process number. It costs
/// nothing to ask, so a client asks it whenever it has been away: the same `started` means
/// the same run of the service, a new one means it restarted (ask for everything again), and
/// a new `build` means the program was made again (a page loads itself again). The decision
/// is written once, in `ui/features/service.rs`.
pub async fn hello() -> Result<Hello, String> {
    Ok(crate::core::service::hello())
}

/// Look at the home now and put in force what a person changed by hand since the last look.
/// The answer says what was read again, what waits for a restart, and what was refused.
/// The service does the same by itself every `look_every_ms` (settings).
pub async fn reload() -> Result<Reloaded, String> {
    crate::core::world::world();
    Ok(crate::core::reread::reload())
}

/// The settings in force (`settings.json`, as last read without a mistake in it).
pub async fn service_settings() -> Result<Settings, String> {
    Ok(crate::core::settings::settings())
}

/// Ask the service to finish. It answers, then ends a moment later; what every engine knew
/// at its last step is on disk. `askk stop` asks this.
pub async fn stop_service() -> Result<String, String> {
    crate::core::service::stop()
}
