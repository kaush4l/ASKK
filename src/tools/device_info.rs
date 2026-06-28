//! `device_info` — hand the model the same capability sweep the Capabilities
//! page renders: what this browser context can sense and do, including which
//! tools map to which surfaces. Lets the agent plan around its actual host
//! instead of guessing. Probes on the page via [`crate::worker::page_proxy`].

use crate::capabilities::page_ops::PageOp;
use crate::state::{AppSnapshot, ToolSpec};
use crate::worker::page_proxy::run_page_op;
use serde_json::{Value, json};

use super::{ToolDescriptor, ToolFuture};

pub(crate) fn descriptor() -> ToolDescriptor {
    ToolDescriptor {
        spec: spec(),
        handler,
    }
}

fn spec() -> ToolSpec {
    ToolSpec {
        name: "device_info".to_string(),
        description: "Probe the browser host: media devices, sensors, WebGPU/WebNN and \
                      WASM features, storage, connectivity, and permission states, plus \
                      which agent tool exposes each surface. Returns JSON. Call this \
                      before planning anything device-dependent."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move { run_page_op(PageOp::Probe).await })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        assert_eq!(spec().name, "device_info");
    }
}
