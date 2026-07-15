//! Local-LLM provider seam: a profile whose base URL is `local` (or whose
//! model id is `local/`-prefixed) runs inference fully in-browser via the
//! vendored transformers.js worker bundle (`assets/llm/askk-llm.js`, rebuilt
//! by `scripts/llm/build.sh`). Model weights stream from the HF hub on first
//! use into the browser cache — no server, no key. WebGPU when available,
//! cpu-wasm fallback. The pure request→messages/parse halves live here so
//! host tests cover them; the Worker plumbing is wasm-only.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

use askk_core::request::{InferenceRequest, Role, SectionKind, Usage};
use serde_json::{json, Value};

/// Does this profile route to the in-browser provider?
pub fn is_local(base_url: &str, model: &str) -> bool {
    base_url.trim().eq_ignore_ascii_case("local") || model.trim().starts_with("local/")
}

/// Strip the optional `local/` routing prefix → the HF model id.
pub fn hf_model_id(model: &str) -> &str {
    let model = model.trim();
    model.strip_prefix("local/").unwrap_or(model)
}

/// Render the request into the worker's `messages` array for the in-browser
/// transformers.js path (the external openai_compat path now sends ONE
/// assembled prompt string instead — ADR-039): non-user-input sections join
/// into one leading system message, history follows, user-input sections
/// trail as user messages. Two local-template accommodations: `Role::Tool` maps to
/// `user` (gemma-family chat templates reject a `tool` role) and
/// consecutive same-role messages merge (the same templates enforce strict
/// user/assistant alternation — a tool turn followed by user input would
/// throw). Tools/parts drop: local models tool-call through the prompt
/// (contract instructions already ride the sections).
pub fn messages_json(req: &InferenceRequest) -> Value {
    let mut system = String::new();
    for (kind, text) in &req.sections {
        if *kind == SectionKind::UserInput {
            continue;
        }
        if !system.is_empty() {
            system.push_str("\n\n");
        }
        system.push_str(&format!("## {}\n{}", kind.name(), text));
    }
    let mut merged: Vec<(&str, String)> = Vec::new();
    let mut push = |role: &'static str, content: &str| match merged.last_mut() {
        Some((last, text)) if *last == role => {
            text.push_str("\n\n");
            text.push_str(content);
        }
        _ => merged.push((role, content.to_string())),
    };
    if !system.is_empty() {
        push("system", &system);
    }
    for message in &req.history {
        let role = match message.role {
            Role::System => "system",
            Role::User | Role::Tool => "user",
            Role::Assistant => "assistant",
        };
        push(role, &message.content);
    }
    for (kind, text) in &req.sections {
        if *kind == SectionKind::UserInput {
            push("user", text);
        }
    }
    Value::Array(
        merged
            .into_iter()
            .map(|(role, content)| json!({"role": role, "content": content}))
            .collect(),
    )
}

/// One parsed worker→host message. Progress/unknown types fold to `Other`
/// (the infer loop ignores them; devtools sees the raw postMessage).
#[derive(Debug, PartialEq)]
pub enum WorkerMsg {
    Delta(String),
    Done(Option<Usage>),
    Error(String),
    Other,
}

pub fn parse_worker_msg(raw: &str) -> WorkerMsg {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return WorkerMsg::Other;
    };
    match value["type"].as_str() {
        Some("delta") => WorkerMsg::Delta(value["text"].as_str().unwrap_or_default().to_string()),
        Some("done") => {
            WorkerMsg::Done(value["usage"]["input_tokens"].as_u64().map(|input| Usage {
                input_tokens: input,
                output_tokens: value["usage"]["output_tokens"].as_u64().unwrap_or(0),
            }))
        }
        Some("error") => WorkerMsg::Error(
            value["message"]
                .as_str()
                .unwrap_or("unknown worker error")
                .to_string(),
        ),
        _ => WorkerMsg::Other,
    }
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use std::cell::{Cell, RefCell};

    use dioxus::prelude::*;
    use futures::channel::mpsc;
    use futures::future::LocalBoxFuture;
    use futures::StreamExt;
    use serde_json::json;
    use wasm_bindgen::prelude::Closure;
    use wasm_bindgen::{JsCast, JsValue};
    use web_sys::{MessageEvent, Worker, WorkerOptions, WorkerType};

    use askk_core::provider::{Provider, ProviderError};
    use askk_core::request::{InferenceReply, InferenceRequest};

    use super::{messages_json, parse_worker_msg, WorkerMsg};

    const LLM_JS: Asset = asset!("/assets/llm/askk-llm.js");
    const LLM_ORT_MJS: Asset = asset!("/assets/llm/llm-ort.mjs");
    const LLM_ORT_WASM: Asset = asset!("/assets/llm/llm-ort.wasm");

    thread_local! {
        /// One worker per page: the model pipelines it holds are the whole
        /// point (a respawn re-initializes multi-GB weights into GPU memory).
        static WORKER: RefCell<Option<Worker>> = const { RefCell::new(None) };
        /// ponytail: one in-flight generate per page — a second concurrent
        /// local run gets RateLimited (loop retries). Per-run workers if
        /// parallel local inference ever matters.
        static BUSY: Cell<bool> = const { Cell::new(false) };
    }

    fn unreachable_err(context: &str, e: JsValue) -> ProviderError {
        ProviderError::Unreachable {
            hint: format!(
                "local llm worker {context}: {}",
                e.as_string().unwrap_or_else(|| format!("{e:?}"))
            ),
        }
    }

    /// Get-or-spawn the worker; a fresh spawn is pointed at the staged ONNX
    /// runtime pair before anything else (Dioxus hashes asset filenames, so
    /// the worker cannot guess them).
    fn ensure_worker() -> Result<Worker, ProviderError> {
        WORKER.with(|slot| {
            if let Some(worker) = slot.borrow().as_ref() {
                return Ok(worker.clone());
            }
            let options = WorkerOptions::new();
            options.set_type(WorkerType::Module);
            let worker = Worker::new_with_options(&LLM_JS.to_string(), &options)
                .map_err(|e| unreachable_err("spawn", e))?;
            let init = json!({
                "type": "init",
                "mjs": LLM_ORT_MJS.to_string(),
                "wasm": LLM_ORT_WASM.to_string(),
            });
            worker
                .post_message(&JsValue::from_str(&init.to_string()))
                .map_err(|e| unreachable_err("init", e))?;
            *slot.borrow_mut() = Some(worker.clone());
            Ok(worker)
        })
    }

    /// Resolver branch (boot.rs hook): `Some(provider)` when the active
    /// profile routes local, `None` to fall through to the HTTP registry.
    pub fn local_provider(
        profile_id: &str,
        form: &crate::profile::ProviderProfileForm,
    ) -> Option<std::rc::Rc<dyn Provider>> {
        if !super::is_local(&form.base_url, &form.model) {
            return None;
        }
        let model = super::hf_model_id(&form.model);
        Some(std::rc::Rc::new(LocalLlm::new(
            &format!("{profile_id}/{model}"),
            model,
            // ponytail: same 2048 runaway-generation cap as the HTTP path.
            form.max_tokens.unwrap_or(2048),
        )))
    }

    /// Features-lab helper: run one in-browser generation, streaming deltas via
    /// `on_delta`, and return the full text. Wraps the `Provider` path with a
    /// throwaway single-turn request so the lab need not build one — the engine
    /// is untouched (ADR-041).
    pub async fn generate_once(
        model: &str,
        prompt: &str,
        max_tokens: u32,
        mut on_delta: impl FnMut(&str),
    ) -> Result<String, String> {
        use askk_core::request::{InferenceConfig, InferenceRequest, SectionKind};

        let llm = LocalLlm::new("lab", super::hf_model_id(model), max_tokens);
        let req = InferenceRequest {
            sections: vec![(SectionKind::UserInput, prompt.to_string())],
            config: InferenceConfig {
                max_tokens: Some(max_tokens),
                ..Default::default()
            },
            ..Default::default()
        };
        llm.infer(&req, &mut on_delta)
            .await
            .map(|reply| reply.text)
            .map_err(|err| format!("{err:?}"))
    }

    /// In-browser provider: one `infer` = one worker `generate` round trip.
    pub struct LocalLlm {
        id: String,
        model: String,
        max_tokens: u32,
    }

    impl LocalLlm {
        pub fn new(id: &str, model: &str, max_tokens: u32) -> Self {
            Self {
                id: id.into(),
                model: model.into(),
                max_tokens,
            }
        }
    }

    /// Clears BUSY + the worker handler even on early-return error paths.
    struct InFlight;

    impl Drop for InFlight {
        fn drop(&mut self) {
            BUSY.with(|b| b.set(false));
            WORKER.with(|slot| {
                if let Some(worker) = slot.borrow().as_ref() {
                    worker.set_onmessage(None);
                    worker.set_onerror(None);
                }
            });
        }
    }

    impl Provider for LocalLlm {
        fn id(&self) -> &str {
            &self.id
        }

        fn infer<'a>(
            &'a self,
            req: &'a InferenceRequest,
            on_delta: &'a mut dyn FnMut(&str),
        ) -> LocalBoxFuture<'a, Result<InferenceReply, ProviderError>> {
            Box::pin(async move {
                if BUSY.with(|b| b.replace(true)) {
                    return Err(ProviderError::RateLimited {
                        retry_after_ms: Some(2000),
                    });
                }
                let _guard = InFlight;
                let worker = ensure_worker()?;
                let (tx, mut rx) = mpsc::unbounded::<String>();
                let onmessage = Closure::wrap(Box::new({
                    let tx = tx.clone();
                    move |e: MessageEvent| {
                        if let Ok(raw) = js_sys::JSON::stringify(&e.data()) {
                            let _ = tx.unbounded_send(raw.into());
                        }
                    }
                }) as Box<dyn FnMut(MessageEvent)>);
                worker.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));
                // A crashed worker (bundle 404, GPU OOM) never posts `done`;
                // without this the receive loop below would hang the run.
                let onerror = Closure::wrap(Box::new(move |e: web_sys::ErrorEvent| {
                    let raw = json!({"type": "error", "message": e.message()}).to_string();
                    let _ = tx.unbounded_send(raw);
                })
                    as Box<dyn FnMut(web_sys::ErrorEvent)>);
                worker.set_onerror(Some(onerror.as_ref().unchecked_ref()));
                let generate = json!({
                    "type": "generate",
                    "model": self.model,
                    "messages": messages_json(req),
                    "max_tokens": req.config.max_tokens.unwrap_or(self.max_tokens),
                });
                worker
                    .post_message(&JsValue::from_str(&generate.to_string()))
                    .map_err(|e| unreachable_err("post", e))?;
                let mut text = String::new();
                let mut usage = None;
                while let Some(raw) = rx.next().await {
                    match parse_worker_msg(&raw) {
                        WorkerMsg::Delta(chunk) => {
                            text.push_str(&chunk);
                            on_delta(&chunk);
                        }
                        WorkerMsg::Done(u) => {
                            usage = u;
                            break;
                        }
                        WorkerMsg::Error(message) => {
                            // Bad model id / failed load reads as a bad
                            // request — actionable in the run timeline.
                            return Err(ProviderError::BadRequest(format!(
                                "local model '{}': {message}",
                                self.model
                            )));
                        }
                        WorkerMsg::Other => {}
                    }
                }
                Ok(InferenceReply {
                    text,
                    native_tool_calls: Vec::new(),
                    usage,
                })
            })
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub use imp::{generate_once, local_provider};

/// Host stub for the lab's one-shot generate (wasm-only at runtime).
#[cfg(not(target_arch = "wasm32"))]
pub async fn generate_once(
    _model: &str,
    _prompt: &str,
    _max_tokens: u32,
    _on_delta: impl FnMut(&str),
) -> Result<String, String> {
    Err("in-browser generation requires the wasm build".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use askk_core::request::{InferenceConfig, Message};

    #[test]
    fn local_profile_detection_and_model_id() {
        assert!(is_local("local", "any-model"));
        assert!(is_local(" Local ", "m"));
        assert!(is_local("", "local/onnx-community/gemma-4-E2B-it-ONNX"));
        assert!(!is_local("http://localhost:1234/v1", "llama3.2"));
        assert!(!is_local("", "localhost-model"));
        assert_eq!(
            hf_model_id("local/onnx-community/gemma-4-E2B-it-ONNX"),
            "onnx-community/gemma-4-E2B-it-ONNX"
        );
        assert_eq!(hf_model_id(" onnx-community/x "), "onnx-community/x");
    }

    #[test]
    fn messages_render_system_history_then_user_input() {
        let req = InferenceRequest {
            sections: vec![
                (SectionKind::Identity, "You are X.".into()),
                (SectionKind::Contract, "Answer in TOON.".into()),
                (SectionKind::UserInput, "hello".into()),
            ],
            history: vec![
                Message::new(Role::Assistant, "earlier"),
                Message::new(Role::Tool, "tool output"),
            ],
            config: InferenceConfig::default(),
            ..Default::default()
        };
        let messages = messages_json(&req);
        let arr = messages.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0]["role"], "system");
        let system = arr[0]["content"].as_str().unwrap();
        assert!(system.contains("## identity\nYou are X."));
        assert!(system.contains("## contract\nAnswer in TOON."));
        assert_eq!(arr[1]["role"], "assistant");
        // Tool history maps to user (gemma templates have no tool role) and
        // merges with the trailing user input (strict alternation — two
        // consecutive user messages would make apply_chat_template throw).
        assert_eq!(
            arr[2],
            serde_json::json!({"role": "user", "content": "tool output\n\nhello"})
        );
    }

    #[test]
    fn worker_messages_parse() {
        assert_eq!(
            parse_worker_msg(r#"{"type":"delta","text":"he"}"#),
            WorkerMsg::Delta("he".into())
        );
        assert_eq!(
            parse_worker_msg(r#"{"type":"done","usage":{"input_tokens":10,"output_tokens":5}}"#),
            WorkerMsg::Done(Some(Usage {
                input_tokens: 10,
                output_tokens: 5
            }))
        );
        assert_eq!(
            parse_worker_msg(r#"{"type":"done"}"#),
            WorkerMsg::Done(None)
        );
        assert_eq!(
            parse_worker_msg(r#"{"type":"error","message":"no such model"}"#),
            WorkerMsg::Error("no such model".into())
        );
        assert_eq!(
            parse_worker_msg(r#"{"type":"progress","file":"model.onnx","pct":40}"#),
            WorkerMsg::Other
        );
        assert_eq!(parse_worker_msg("not json"), WorkerMsg::Other);
    }
}
