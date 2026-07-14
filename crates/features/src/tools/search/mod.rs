//! FEATURE: web connectors — everything `web_search` reaches the open web
//! with. `engines` owns the general chain (SearXNG primary → DuckDuckGo →
//! Wikipedia fallback) and the `WebSearch` tool itself; `news` owns the
//! news lane's pure URL builders/parsers (Wikinews → GDELT). The HTTP
//! `Transport` is injected (ADR-009) so tests script it with
//! `MockTransport`; every call is `Effect::Pure` — no state writes.

pub mod engines;
pub mod news;

pub use engines::{register_web_search, WebSearch};
