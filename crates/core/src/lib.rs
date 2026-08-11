//! L2 wiring (ARCHITECTURE §2): the §3 seam, routing dispatch, the effect
//! runtime loop, and boot. No domain logic lives here — this crate connects
//! the pure crates to each other and to injected ports, and nothing else.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

// G3 freeze: private fields are unread while bodies are todo!(); lift at G4.
#![allow(dead_code)]

mod app;
mod boot;
mod builtins;
mod chat;
mod dispatch;
mod error;
mod form;
mod runtime;

pub use app::{App, Ports};
pub use boot::{boot, migrate, schema_version};
pub use dispatch::{builtin_entry, dispatch, BuiltinHandler, Ctx, KvHandle};
pub use error::CoreError;
// `drive` is PROVISIONAL (G4): the async runtime loop — see runtime.rs.
pub use runtime::{drive, execute_effect, pump};

use kernel::{Request, Response};

/// The whole application (§3, I4): HTTP-shaped in, HTML-shaped out. Every UI
/// interaction crosses here and nowhere else; everything in the design is
/// downstream of protecting this signature. `app` is threaded explicitly
/// (not a global) so a test — or a second agent Worker — can hold its own
/// instance; the seam contract is unchanged from the Spike A free function.
///
/// Synchronous BY DESIGN: reads hit the in-memory projections of the event
/// log (I8 — every view is a projection), writes leave as Effects executed
/// asynchronously by the runtime. If a route ever "needs" async here, state
/// is living outside the log — that is the bug.
pub fn handle(app: &mut App, req: Request) -> Response {
    let response = dispatch::dispatch(app, &req);
    app.append(kernel::EventKind::RequestHandled {
        path: req.path,
        status: response.status,
    });
    response
}
