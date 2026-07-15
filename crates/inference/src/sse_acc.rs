//! Streamed OpenAI-compatible reply accumulator: content deltas pass through
//! `on_delta` as they arrive; tool_call deltas merge by index (id/name land
//! once, arguments concatenate); usage rides the final chunk. Split out of
//! `openai_compat` to keep that file under the size cap (ADR-012).

use serde_json::{json, Value};

use askk_core::request::{InferenceReply, ToolCall, Usage};

use crate::openai_compat::parse_usage;

#[derive(Default)]
pub(crate) struct StreamAcc {
    pub saw_event: bool,
    text: String,
    usage: Option<Usage>,
    calls: Vec<PartialCall>,
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    args: String,
}

impl StreamAcc {
    pub(crate) fn absorb(&mut self, data: &str, on_delta: &mut dyn FnMut(&str)) {
        if data == "[DONE]" {
            self.saw_event = true;
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return; // tolerate keepalives / partial junk
        };
        self.saw_event = true;
        let delta = &value["choices"][0]["delta"];
        if let Some(chunk) = delta["content"].as_str() {
            if !chunk.is_empty() {
                self.text.push_str(chunk);
                on_delta(chunk);
            }
        }
        if let Some(calls) = delta["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"].as_u64().unwrap_or(0) as usize;
                while self.calls.len() <= index {
                    self.calls.push(PartialCall::default());
                }
                let slot = &mut self.calls[index];
                if let Some(id) = call["id"].as_str() {
                    if !id.is_empty() {
                        slot.id = id.into();
                    }
                }
                if let Some(name) = call["function"]["name"].as_str() {
                    if !name.is_empty() {
                        slot.name = name.into();
                    }
                }
                if let Some(args) = call["function"]["arguments"].as_str() {
                    slot.args.push_str(args);
                }
            }
        }
        if let Some(u) = parse_usage(&value["usage"], "prompt_tokens", "completion_tokens") {
            self.usage = Some(u);
        }
    }

    pub(crate) fn into_reply(self) -> InferenceReply {
        InferenceReply {
            text: self.text,
            native_tool_calls: self
                .calls
                .into_iter()
                .filter(|c| !c.name.is_empty())
                .map(|c| ToolCall {
                    id: c.id,
                    name: c.name,
                    args: serde_json::from_str(&c.args).unwrap_or_else(|_| json!({})),
                })
                .collect(),
            usage: self.usage,
        }
    }
}
