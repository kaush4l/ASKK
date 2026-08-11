//! Effects (§11, GLOSSARY): serializable descriptions of something to be
//! done. The output of `step`; executed by the `core` runtime through ports;
//! results return as the next Event. Coarse on purpose (ARCHITECTURE §1c:
//! one CallModel, one InvokeTool — never micro-effects), so one Work turn is
//! one step in, one effect out, one event back.

use serde::{Deserialize, Serialize};

use context::{Document, ProviderFormat};
use kernel::{EndpointName, EventKind, ToolId};

/// The closed set of things an agent can ask the runtime to do — the §11
/// list, typed. Serializable because pending effects must survive a refresh
/// (replay reloads state + effects from the log, I11).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Effect {
    /// Call the model with an assembled paper (I13: nothing reaches a model
    /// except as a Document — this variant's type makes ad-hoc strings
    /// unrepresentable).
    CallModel {
        document: Document,
        format: ProviderFormat,
        endpoint: EndpointName,
        /// The agent's `model:` catalogue key (increment 04). Symbolic: the
        /// adapter resolves it against `public/models.json`, so no URL and no
        /// concrete model id exists anywhere upstream of the broker (I6).
        model: String,
    },
    /// Run one tool through its granted capability (Work's single action).
    InvokeTool { tool: ToolId, args_json: String },
    /// Record a fact (I8) beyond what the runtime already logs.
    Emit { kind: EventKind },
    /// Write through StorePort — the agent persists state as data, never
    /// holds a connection (I2).
    Persist { key: String, value_json: String },
    /// Wake me later (heartbeat, retries with backoff).
    Sleep { ms: u64 },
    /// Hand a goal to another agent running in its own Worker (§10 Tier 2,
    /// ADR-008), and take its answer back as an observation. This is the
    /// Python `Tool.from_engine`: the caller never touches the sub-agent's
    /// loop, it sends it a message and waits.
    ///
    /// `batch` is the LINE the call was written on. Calls sharing a batch were
    /// written on one line, which in the Python means "independent, run at the
    /// same time"; the runtime awaits a batch together and the next batch only
    /// afterwards. Increment 05 shipped the ordering half of that rule on a
    /// single-threaded host — one Worker per agent is what makes the
    /// concurrency half real.
    Delegate {
        agent: String,
        goal: String,
        batch: u16,
    },
}
