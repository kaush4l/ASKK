//! `geolocate` — resolve the device's current position. The browser's
//! geolocation permission prompt gates access; coordinates go to the model, so
//! the spec says so plainly and the user can deny per-site. Executes on the
//! page via [`crate::worker::page_proxy`].

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
        name: "geolocate".to_string(),
        description: "Get the device's current location (the browser asks the user for \
                      permission). Returns latitude, longitude, and accuracy in meters \
                      as JSON."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
    }
}

fn handler<'a>(_snapshot: &'a mut AppSnapshot, _args: &'a Value) -> ToolFuture<'a> {
    Box::pin(async move { run_page_op(PageOp::Geolocate { timeout_ms: 10_000 }).await })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_shape_is_stable() {
        assert_eq!(spec().name, "geolocate");
    }
}
