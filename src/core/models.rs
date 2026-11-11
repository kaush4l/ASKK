//! # Models: what a model is
//!
//! A [`Model`] is just: `name` (also the id sent), `method`, `base_url`, `token_env`.
//! - `openai`: the OpenAI chat-completions API, which every server speaks (OpenAI, Anthropic's
//!   compatible endpoint, LM Studio, oMLX, vLLM, Ollama, …). Only `base_url` changes.
//! - `cli`: any command (`["claude","-p","{prompt}"]`); no `{prompt}` = stdin.
//!
//! `input`: how a `cli` model is handed its prompt. Empty = as text (an argument, or stdin).
//! `stream-json` = Claude Code's message stream on stdin, which can carry images; its reply is
//! read from the stream it prints (the command must ask for it:
//! `--input-format stream-json --output-format stream-json --verbose`). An `openai` model is
//! sent images as content parts whenever there are any.
//!
//! `token_env` is the *name* of an env var holding the token; tokens are never stored.
//! `max_tokens` (default [`MAX_TOKENS`]) caps each reply; `context` 0 = read from the listing.
//! How a model is reached is the host's business (`host/infer`).
use serde::{Deserialize, Serialize};

/// Every method a model can use.
pub const METHODS: &[&str] = &["openai", "cli"];

/// Where `openai` goes when a model sets no `base_url`.
#[cfg_attr(not(feature = "server"), allow(dead_code))]
pub const OPENAI_URL: &str = "https://api.openai.com/v1";

/// A model a server offers, with its context window when the server reports it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Found {
    pub name: String,
    pub context: u32,
}

/// Output cap per reply when a model sets none.
pub const MAX_TOKENS: u32 = 32_000;

fn max_tokens() -> u32 {
    MAX_TOKENS
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Model {
    pub name: String,
    /// `openai` or `cli`.
    #[serde(alias = "connector")]
    pub method: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub base_url: String,
    /// Name of the env var holding the token (never the token itself).
    #[serde(default, alias = "key_env", skip_serializing_if = "String::is_empty")]
    pub token_env: String,
    /// `cli` only: program and args.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub command: Vec<String>,
    /// Output cap per reply.
    #[serde(default = "max_tokens")]
    pub max_tokens: u32,
    /// Context window in tokens. 0 = ask the server's models listing, else unknown.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub context: u32,
    /// `cli` only: empty (text) or `stream-json` (messages on stdin, images included).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub input: String,
}

/// Every way a `cli` model can be handed its prompt.
pub const INPUTS: &[&str] = &["", "stream-json"];

impl Default for Model {
    fn default() -> Self {
        Self { name: String::new(), method: "openai".into(), base_url: String::new(), token_env: String::new(), command: vec![], max_tokens: MAX_TOKENS, context: 0, input: String::new() }
    }
}

/// Contents of `data/models.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Models {
    /// Name of the model used when a caller names none.
    #[serde(default)]
    pub default: String,
    #[serde(default)]
    pub models: Vec<Model>,
}

#[cfg_attr(not(feature = "server"), allow(dead_code))]
impl Models {
    pub fn find(&self, name: &str) -> Option<&Model> {
        let name = if name.is_empty() { &self.default } else { name };
        self.models.iter().find(|m| m.name == *name)
    }
}
