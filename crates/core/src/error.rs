//! Core's typed error (PROMPT §13). Wraps the pure crates' errors at the
//! wiring layer so callers of boot/pump match one enum; each wrapped error
//! keeps its own type — no flattening to strings. …and the one classifier that
//! MAKES one of those variants out of bytes off the wire (R18-P1-7): the rule
//! lives here, on the host, so `cargo test` exercises it (I3), and the adapter
//! that holds the fetch only calls it.

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
    /// THIS BUILD'S OWN CODE COULD NOT BE LOADED. A Worker imports the
    /// fingerprinted bundle the page names in its preload links, so a browser
    /// still holding an older copy of the shell asks for a module name this
    /// deploy does not have. Typed because nothing here is misconfigured: the
    /// endpoint, the key and the agent files are all fine, and every remedy
    /// this app has for a failed turn sends a person somewhere useless.
    StaleAssets {
        /// The address the browser refused, when it named one.
        url: String,
    },
}

/// THE ONE PLACE A NON-2xx BECOMES A VARIANT (R18-P1-7). `read_reply` called
/// every one of them `Provider`, so a 404 saying `Model 'locl' not found` wore
/// the remedy for a refused credential — "check the base URL and API key in
/// Settings" — while the truth sat three levels of JSON down behind `Technical
/// detail`. Recognised HERE, beside `recognise`, for the same reason that one
/// is: it is the half that can be tested on the host with no browser (I3).
///
/// The discriminant is NOT the prose. It is the status the endpoint returned
/// plus the model id THIS PAGE ASKED FOR appearing in the answer — a fact we
/// hold, never a phrase we hope for. Anything else stays `Provider`, verbatim.
/// `keyed` is whether an `authorization` header actually went out — a fact the
/// adapter holds, not a reading of the provider's prose (22).
pub fn provider_error(status: u16, body: &str, asked: &str, keyed: bool) -> kernel::ModelError {
    let said = provider_message(body);
    let about_the_model = !asked.is_empty() && said.contains(asked);
    if status == 404 && about_the_model {
        return kernel::ModelError::ModelMissing {
            model: asked.to_string(),
            available: offered(&said),
        };
    }
    // A REFUSAL WITH NOTHING TO REFUSE. 403 as well as 401: providers disagree
    // about which one an absent credential earns, and both mean the same thing
    // when this page sent none.
    match matches!(status, 401 | 403) && !keyed {
        true => kernel::ModelError::NoKey {
            status,
            message: body.to_string(),
        },
        false => kernel::ModelError::Provider {
            status,
            message: body.to_string(),
        },
    }
}

/// The sentence inside the envelope. OpenAI-compatible servers nest it as
/// `{"error": {"message": …}}`; some send `{"error": "…"}`; some send prose.
/// All three read the same here, and an unparseable body IS its own message.
fn provider_message(body: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.to_string();
    };
    let error = value.get("error").unwrap_or(&value);
    match error.get("message").and_then(|m| m.as_str()) {
        Some(text) => text.to_string(),
        None => error.as_str().unwrap_or(body).to_string(),
    }
}

/// The models the endpoint said it DOES have, out of its own sentence. Empty
/// when it named none — the copy then says nothing about a list rather than
/// printing an empty one.
fn offered(said: &str) -> Vec<String> {
    let Some((_, tail)) = said.split_once("Available models:") else {
        return Vec::new();
    };
    tail.split(['\n', ','])
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}
