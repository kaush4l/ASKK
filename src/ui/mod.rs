//! # UI: everything a person sees
//!
//! | folder | what it is | builds |
//! | --- | --- | --- |
//! | `features/` | what a person can do, as plain values and words: no drawing, no library | all |
//! | `web/` | pages (Dioxus): browser, Mac app, phone, tablet | all but `local` |
//! | `terminal/` | lines in a terminal | `server` |
//!
//! A feature is decided once (which answers it asks, what the lines say); each kind of UI
//! only decides how to show it. The page a tab draws for itself (`local/page.rs`) uses the
//! same features.
//!
//! No UI touches the host: it asks through `api/`.
pub mod features;
#[cfg(feature = "server")]
pub mod terminal;
#[cfg(not(feature = "local"))]
pub mod web;
