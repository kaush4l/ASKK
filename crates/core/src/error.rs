//! Core's typed error (PROMPT §13). Wraps the pure crates' errors at the
//! wiring layer so callers of boot/pump match one enum; each wrapped error
//! keeps its own type — no flattening to strings.

use serde::{Deserialize, Serialize};

use agent::AgentError;
use kernel::{ModelError, NetError, StoreError};
use module::ModuleError;
use script::ScriptError;

/// What wiring can fail on. Public because the composition root (adapters)
/// must render these to the user — a boot that cannot migrate, a pump that
/// lost its model — and rendering needs the variant, not a message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CoreError {
    Store(StoreError),
    Model(ModelError),
    Net(NetError),
    Module(ModuleError),
    Script(ScriptError),
    Agent(AgentError),
    /// Stored schema is NEWER than this build (ADR-005/007): refuse to boot,
    /// offer export — never silently downgrade.
    SchemaNewerThanCode {
        stored: u32,
        expected: u32,
    },
    /// An effect referenced something that no longer exists (tool, agent,
    /// endpoint) — surfaced as a fact, handled by the machine.
    DanglingReference {
        message: String,
    },
}
