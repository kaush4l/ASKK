//! [`HubFrame`] — the single envelope every watcher-routed message rides in.
//!
//! The legacy transport ([`super::transport`]) splits page↔worker traffic into two
//! enums ([`WorkerCommand`](super::transport::WorkerCommand) /
//! [`WorkerEvent`](super::transport::WorkerEvent)) for one worker. The rewrite has a
//! *fleet* of workers behind a central watcher, so every message needs an explicit
//! address and a uniform shape: a [`HubFrame`] carries `to` (its [`Endpoint`] in the
//! supervision tree), the `run_id` it belongs to, one [`FrameKind`], and an optional
//! [`BinDescriptor`] naming a transferable binary sidecar (the two fat frames travel
//! their bytes out-of-band; see [`super::bin_carrier`]).
//!
//! `FrameKind` deliberately *subsumes* the legacy variants (so the cutover is a
//! re-addressing, not a re-modelling) and adds the two event planes — the durable
//! [`State`](FrameKind::State) plane ([`Signal`]) and the ephemeral
//! [`Telemetry`](FrameKind::Telemetry) plane ([`TelemetrySignal`]) — plus tool RPC
//! ([`ToolCall`](FrameKind::ToolCall) / [`ToolReturn`](FrameKind::ToolReturn)).
//!
//! Pure value types; the actual `postMessage`/transfer wiring lives in the wasm
//! client/runtime. These are not wired into any caller yet (that happens at the
//! watcher-hub cutover, plan C2+), so dead_code is allowed crate-wide here until
//! then — on every target, not just off-wasm.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::capabilities::page_ops::PageOp;
use crate::core::contract::{HostAddr, ToolRequest, ToolResponse};
use crate::core::event::Signal;
use crate::core::telemetry::TelemetrySignal;

use super::transport::{PageOpResolved, WorkerCancel, WorkerDispatch, WorkerError, WorkerResult};

/// A node in the supervision tree a frame can be addressed to. The watcher routes by
/// this; nothing else inspects it.
///
/// Externally tagged (no `tag = "..."`): the `Engine(String)` newtype variant wraps a
/// primitive, which serde cannot represent under internal tagging. External tagging
/// round-trips every variant shape — `Main`/`Watcher` as a bare string,
/// `Engine`/`Host` as a single-key map.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Endpoint {
    /// The main thread (UI + authoritative state + StateWriter).
    Main,
    /// The watcher/supervisor itself.
    Watcher,
    /// A specific engine worker, by id.
    Engine(String),
    /// A tool/MCP host, by its [`HostAddr`].
    Host(HostAddr),
}

/// What kind of transferable binary sidecar rides alongside a [`HubFrame`]. The
/// payload bytes are carried out-of-band (a Transferable `ArrayBuffer`), not inside
/// the JSON frame, so the fat frames don't pay a structured-clone copy.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BinKind {
    /// A serialized [`AppSnapshot`](crate::state::AppSnapshot) (json-bytes; see
    /// the codec note in [`super::bin_carrier`]).
    Snapshot,
    /// A typed, Value-free tool payload (postcard).
    ToolPayload,
    /// Raw file bytes (OPFS/bridge data plane).
    FileChunk,
}

/// Describes the binary sidecar so the receiver can claim and decode it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BinDescriptor {
    pub kind: BinKind,
    pub byte_len: u32,
}

/// One routed message: an address, the run it belongs to, a [`FrameKind`], and an
/// optional binary sidecar descriptor.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HubFrame {
    pub to: Endpoint,
    pub run_id: String,
    pub kind: FrameKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin: Option<BinDescriptor>,
}

impl HubFrame {
    /// Address a frame with no binary sidecar.
    pub fn new(to: Endpoint, run_id: impl Into<String>, kind: FrameKind) -> Self {
        Self {
            to,
            run_id: run_id.into(),
            kind,
            bin: None,
        }
    }

    /// Attach a binary sidecar descriptor (the bytes travel out-of-band).
    pub fn with_bin(mut self, bin: BinDescriptor) -> Self {
        self.bin = Some(bin);
        self
    }
}

/// Every kind of message that crosses the hub. Subsumes the legacy
/// command/event variants and adds the two event planes plus tool RPC.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "frame")]
pub enum FrameKind {
    /// A worker/host announced it is up (`id` is its address).
    Ready { id: String },
    /// Main → watcher → engine: start a run (carries the dispatch payload; its
    /// snapshot may instead ride as a [`BinKind::Snapshot`] sidecar).
    Dispatch(WorkerDispatch),
    /// Cancel a run.
    Cancel(WorkerCancel),
    /// Telemetry plane: an ephemeral, coalesced status/progress delta.
    Telemetry(TelemetrySignal),
    /// State plane: a durable, ordered run delta for the StateWriter to apply.
    State(Signal),
    /// A run produced its terminal result.
    Result(WorkerResult),
    /// A run errored.
    Error(WorkerError),
    /// Engine → host: invoke a tool.
    ToolCall(ToolRequest),
    /// Host → engine: a tool's result + durable patch.
    ToolReturn(ToolResponse),
    /// Worker → main: run a window-only page operation.
    PageOpRequest { request_id: String, op: PageOp },
    /// Main → worker: the result of a proxied page operation.
    PageOpResolved(PageOpResolved),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::telemetry::{AgentActivity, TelemetrySignal};

    #[test]
    fn telemetry_frame_round_trips_addressed_to_main() {
        let frame = HubFrame::new(
            Endpoint::Main,
            "run-1",
            FrameKind::Telemetry(TelemetrySignal::StatusChanged {
                id: "engine-1".into(),
                activity: AgentActivity::WaitingLlm,
            }),
        );
        let json = serde_json::to_string(&frame).unwrap();
        assert!(json.contains("\"to\":\"main\""));
        assert!(json.contains("\"frame\":\"telemetry\""));
        let parsed: HubFrame = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.run_id, "run-1");
        assert!(matches!(parsed.to, Endpoint::Main));
        assert!(matches!(parsed.kind, FrameKind::Telemetry(_)));
        assert!(parsed.bin.is_none());
    }

    #[test]
    fn engine_endpoint_and_bin_descriptor_round_trip() {
        let frame = HubFrame::new(
            Endpoint::Engine("engine-7".into()),
            "run-9",
            FrameKind::Ready {
                id: "engine-7".into(),
            },
        )
        .with_bin(BinDescriptor {
            kind: BinKind::Snapshot,
            byte_len: 4096,
        });
        let parsed: HubFrame =
            serde_json::from_str(&serde_json::to_string(&frame).unwrap()).unwrap();
        assert!(matches!(parsed.to, Endpoint::Engine(ref id) if id == "engine-7"));
        assert_eq!(parsed.bin.unwrap().byte_len, 4096);
    }

    #[test]
    fn host_endpoint_carries_mcp_addr() {
        let frame = HubFrame::new(
            Endpoint::Host(HostAddr::McpServer {
                server_id: "chrome".into(),
            }),
            "run-3",
            FrameKind::Ready {
                id: "chrome".into(),
            },
        );
        let parsed: HubFrame =
            serde_json::from_str(&serde_json::to_string(&frame).unwrap()).unwrap();
        match parsed.to {
            Endpoint::Host(HostAddr::McpServer { server_id }) => assert_eq!(server_id, "chrome"),
            other => panic!("expected mcp host endpoint, got {other:?}"),
        }
    }
}
