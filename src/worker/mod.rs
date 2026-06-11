//! Web Worker agent execution. A goal is dispatched from the main thread
//! ([`client`]) to a Web Worker that runs the ReAct loop ([`runtime`]); the two sides
//! exchange the typed messages defined in [`transport`]. On the host build these run
//! inline (no worker), which is what the unit tests exercise.

pub mod client;
pub mod page_proxy;
pub mod runtime;
pub mod transport;
