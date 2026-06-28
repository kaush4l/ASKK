//! Binary payload codecs for the two fat frames ([`BinKind`](super::hub_frame::BinKind)).
//!
//! A [`HubFrame`](super::hub_frame::HubFrame) is small JSON; its heavy payloads (a
//! dispatched/returned [`AppSnapshot`](crate::state::AppSnapshot), a typed tool
//! payload, a file chunk) travel out-of-band as a Transferable `ArrayBuffer` so they
//! skip the structured-clone copy. This module is the pure encode/decode boundary;
//! the wasm client/runtime does the actual `postMessage(..., [buffer])` transfer.
//!
//! ## Codec choice — important
//!
//! [`postcard`] is compact but **non-self-describing**: decoding relies on the
//! target type's shape, and `serde`'s `deserialize_any` is unsupported. Any type
//! containing a [`serde_json::Value`] therefore *cannot* round-trip through postcard
//! — and `AppSnapshot` does (e.g. `ToolSpec.input_schema`). So [`BinKind::Snapshot`]
//! uses self-describing **JSON bytes** (still transferable, just less compact),
//! while the Value-free [`BinKind::ToolPayload`] / [`BinKind::FileChunk`] use
//! postcard. [`build_bin_frame`] picks the codec by kind so callers can't get it
//! wrong.

// Not wired into any caller yet (the fat-frame transfer lands at the watcher-hub
// cutover, plan C2+); allow dead_code crate-wide here until then.
#![allow(dead_code)]

use serde::Serialize;
use serde::de::DeserializeOwned;

use super::hub_frame::{BinDescriptor, BinKind};

/// Encode a Value-free typed payload with postcard (compact, non-self-describing).
pub fn to_postcard<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    postcard::to_allocvec(value).map_err(|err| format!("postcard encode: {err}"))
}

/// Decode a postcard payload. Fails for types containing `serde_json::Value`.
pub fn from_postcard<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    postcard::from_bytes(bytes).map_err(|err| format!("postcard decode: {err}"))
}

/// Encode as self-describing JSON bytes — for Value-bearing payloads (the snapshot).
/// Transferable all the same (the bytes ride an `ArrayBuffer`).
pub fn to_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|err| format!("json encode: {err}"))
}

/// Decode self-describing JSON bytes.
pub fn from_json_bytes<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_slice(bytes).map_err(|err| format!("json decode: {err}"))
}

/// Build a `(descriptor, bytes)` pair for a fat payload, picking the codec by kind:
/// [`BinKind::Snapshot`] → JSON bytes (Value-safe); everything else → postcard.
pub fn build_bin_frame<T: Serialize>(
    kind: BinKind,
    value: &T,
) -> Result<(BinDescriptor, Vec<u8>), String> {
    let bytes = match kind {
        BinKind::Snapshot => to_json_bytes(value)?,
        BinKind::ToolPayload | BinKind::FileChunk => to_postcard(value)?,
    };
    let byte_len = u32::try_from(bytes.len()).map_err(|_| "payload exceeds 4 GiB".to_string())?;
    Ok((BinDescriptor { kind, byte_len }, bytes))
}

/// Decode a claimed sidecar by its descriptor's kind, mirroring [`build_bin_frame`].
pub fn read_bin_frame<T: DeserializeOwned>(
    descriptor: &BinDescriptor,
    bytes: &[u8],
) -> Result<T, String> {
    match descriptor.kind {
        BinKind::Snapshot => from_json_bytes(bytes),
        BinKind::ToolPayload | BinKind::FileChunk => from_postcard(bytes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use serde_json::Value;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Plain {
        a: u32,
        b: String,
    }

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct WithValue {
        schema: Value,
    }

    #[test]
    fn postcard_round_trips_value_free_payload() {
        let p = Plain {
            a: 7,
            b: "hi".into(),
        };
        let bytes = to_postcard(&p).unwrap();
        assert_eq!(from_postcard::<Plain>(&bytes).unwrap(), p);
    }

    #[test]
    fn postcard_cannot_round_trip_serde_json_value() {
        // Documents the exact reason Snapshot uses JSON bytes: Value's Deserialize
        // calls deserialize_any, which postcard does not support.
        let v = WithValue {
            schema: serde_json::json!({"type": "object"}),
        };
        let bytes = to_postcard(&v).unwrap(); // encode succeeds...
        assert!(from_postcard::<WithValue>(&bytes).is_err()); // ...decode cannot.
    }

    #[test]
    fn json_bytes_round_trip_value_bearing_payload() {
        let v = WithValue {
            schema: serde_json::json!({"type": "object", "n": 3}),
        };
        let bytes = to_json_bytes(&v).unwrap();
        assert_eq!(from_json_bytes::<WithValue>(&bytes).unwrap(), v);
    }

    #[test]
    fn build_and_read_pick_codec_by_kind() {
        // Snapshot kind → JSON path handles a Value-bearing payload.
        let v = WithValue {
            schema: serde_json::json!({"k": "v"}),
        };
        let (desc, bytes) = build_bin_frame(BinKind::Snapshot, &v).unwrap();
        assert_eq!(desc.kind, BinKind::Snapshot);
        assert_eq!(desc.byte_len as usize, bytes.len());
        assert_eq!(read_bin_frame::<WithValue>(&desc, &bytes).unwrap(), v);

        // ToolPayload kind → postcard path for a Value-free payload.
        let p = Plain {
            a: 1,
            b: "x".into(),
        };
        let (desc, bytes) = build_bin_frame(BinKind::ToolPayload, &p).unwrap();
        assert_eq!(read_bin_frame::<Plain>(&desc, &bytes).unwrap(), p);
    }
}
