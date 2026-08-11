//! L0 leaf vocabulary (ARCHITECTURE §2). Ids, typed errors, the HTTP-shaped
//! seam types, Event + event-log types, capability grants, and the five port
//! traits. Imports nothing from the workspace — every other crate imports this.
//!
//! G3 interface freeze: types and signatures only; bodies are `todo!()`.

mod capability;
mod error;
mod event;
mod http;
mod ids;
mod ports;
mod status;

pub use capability::{CapabilityGrant, CapabilityId};
pub use error::{DelegateError, ModelError, NetError, StoreError};
pub use status::Status;
pub use event::{Event, EventKind, EventLog};
pub use http::{Request, Response};
pub use ids::{
    AgentId, EndpointName, EventId, ModuleId, PhaseId, SectionId, Timestamp, ToolId, Version,
};
pub use ports::{
    AgentPort, BlobStore, BoxFuture, BrokeredRequest, BrokeredResponse, ClockPort, KvStore,
    ModelPort, ModelReply, NetPort, RngPort, StorePort, Usage,
};
