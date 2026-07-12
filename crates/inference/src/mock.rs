//! MockProvider: scripted replies + request recording. This powers every
//! runtime workflow test — deterministic, zero network.

use std::cell::RefCell;
use std::collections::VecDeque;

use futures::future::LocalBoxFuture;

use askk_core::provider::{Provider, ProviderError};
use askk_core::request::{InferenceReply, InferenceRequest};

type Script = RefCell<VecDeque<Result<InferenceReply, ProviderError>>>;

#[derive(Debug, Default)]
pub struct MockProvider {
    id: String,
    script: Script,
    requests: RefCell<Vec<InferenceRequest>>,
}

impl MockProvider {
    pub fn new(id: &str) -> Self {
        Self {
            id: id.into(),
            ..Self::default()
        }
    }

    /// Script a plain text reply.
    pub fn push_text(&self, text: &str) {
        self.push_reply(InferenceReply::text(text));
    }

    pub fn push_reply(&self, reply: InferenceReply) {
        self.script.borrow_mut().push_back(Ok(reply));
    }

    pub fn push_error(&self, error: ProviderError) {
        self.script.borrow_mut().push_back(Err(error));
    }

    /// Build a provider from a fixture script: reply blocks separated by lines
    /// that are exactly `---`. A block that is exactly `!error: timeout` (or
    /// `!error: malformed <msg>`) scripts a typed error instead of a reply.
    /// Fixture files live beside the tests and load via `include_str!`, so the
    /// same scripts work under any target with no runtime file I/O.
    pub fn from_script(id: &str, script: &str) -> Self {
        let mock = Self::new(id);
        for block in script.split("\n---\n") {
            let block = block.trim_matches('\n');
            if block.is_empty() {
                continue;
            }
            match block.strip_prefix("!error:").map(str::trim) {
                Some("timeout") => mock.push_error(ProviderError::Timeout),
                Some(rest) => mock.push_error(ProviderError::Malformed(
                    rest.strip_prefix("malformed")
                        .map(str::trim)
                        .unwrap_or(rest)
                        .to_string(),
                )),
                None => mock.push_text(block),
            }
        }
        mock
    }

    /// Every request this provider has seen, in order, for assertions.
    pub fn requests(&self) -> Vec<InferenceRequest> {
        self.requests.borrow().clone()
    }

    pub fn remaining(&self) -> usize {
        self.script.borrow().len()
    }
}

impl Provider for MockProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn infer<'a>(
        &'a self,
        req: &'a InferenceRequest,
        on_delta: &'a mut dyn FnMut(&str),
    ) -> LocalBoxFuture<'a, Result<InferenceReply, ProviderError>> {
        self.requests.borrow_mut().push(req.clone());
        let next = self.script.borrow_mut().pop_front();
        Box::pin(async move {
            // An exhausted script is a test bug — surface it loudly but typed.
            let reply = next
                .unwrap_or_else(|| Err(ProviderError::Malformed("mock script exhausted".into())))?;
            if !reply.text.is_empty() {
                on_delta(&reply.text);
            }
            Ok(reply)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::request::{SectionKind, ToolCall};
    use futures::executor::block_on;
    use serde_json::json;

    fn request(input: &str) -> InferenceRequest {
        InferenceRequest {
            sections: vec![(SectionKind::UserInput, input.into())],
            ..Default::default()
        }
    }

    #[test]
    fn scripted_replies_pop_in_order() {
        let mock = MockProvider::new("mock/test");
        mock.push_text("first");
        mock.push_reply(InferenceReply {
            native_tool_calls: vec![ToolCall {
                id: "c1".into(),
                name: "read".into(),
                args: json!({}),
            }],
            ..Default::default()
        });
        mock.push_error(ProviderError::Timeout);
        assert_eq!(mock.remaining(), 3);

        let mut deltas = String::new();
        let reply = block_on(mock.infer(&request("a"), &mut |d| deltas.push_str(d))).unwrap();
        assert_eq!(reply.text, "first");
        assert_eq!(deltas, "first");

        let reply = block_on(mock.infer(&request("b"), &mut |_| {})).unwrap();
        assert_eq!(reply.native_tool_calls[0].name, "read");

        let err = block_on(mock.infer(&request("c"), &mut |_| {})).unwrap_err();
        assert_eq!(err, ProviderError::Timeout);
        assert_eq!(mock.remaining(), 0);
    }

    #[test]
    fn records_every_request_for_assertions() {
        let mock = MockProvider::new("mock/test");
        mock.push_text("x");
        block_on(mock.infer(&request("what is 2+2"), &mut |_| {})).unwrap();
        let seen = mock.requests();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].sections[0].1, "what is 2+2");
    }

    #[test]
    fn from_script_splits_blocks_and_scripts_errors() {
        let mock = MockProvider::from_script(
            "mock/test",
            "action: tool\nanswer: {\"name\": \"echo\"}\n---\n!error: timeout\n---\nfinal answer\n",
        );
        assert_eq!(mock.remaining(), 3);
        let reply = block_on(mock.infer(&request("a"), &mut |_| {})).unwrap();
        assert!(reply.text.contains("echo"));
        let err = block_on(mock.infer(&request("b"), &mut |_| {})).unwrap_err();
        assert_eq!(err, ProviderError::Timeout);
        let reply = block_on(mock.infer(&request("c"), &mut |_| {})).unwrap();
        assert_eq!(reply.text, "final answer");
    }

    #[test]
    fn exhausted_script_is_a_typed_error_not_a_panic() {
        let mock = MockProvider::new("mock/test");
        let err = block_on(mock.infer(&request("a"), &mut |_| {})).unwrap_err();
        assert!(matches!(err, ProviderError::Malformed(m) if m.contains("exhausted")));
    }
}
