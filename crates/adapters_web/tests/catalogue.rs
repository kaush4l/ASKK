//! The catalogue rules, pinned on the host (I3): no browser, no network.
//! These are the Python `core/inference.py` guarantees, not this build's.

use adapters_web::catalogue::Catalogue;
use adapters_web::Endpoint;

/// The shipped file, trimmed to the shapes that matter.
const FILE: &str = r#"{
  "default": "local",
  "models": {
    "local": {"model": "gemma-4-12B-it-qat-mxfp8", "base_url": "http://127.0.0.1:8873/v1",
              "api": "completions", "api_key_env": "OMLX_API_KEY"},
    "openai": {"model": "gpt-5", "base_url": "https://api.openai.com/v1"},
    "sonnet": {"kind": "anthropic", "model": "claude-sonnet-5",
               "base_url": "https://api.anthropic.com/v1"}
  }
}"#;

fn shipped() -> Endpoint {
    let mut e = Endpoint::default();
    e.set_catalogue(FILE);
    e
}

/// No name = the entry `default` names. This is what makes an install with no
/// settings at all still have a real, honest endpoint.
#[test]
fn an_empty_name_resolves_to_the_default_entry() {
    let c = Catalogue::parse(FILE);
    let e = c.resolve("").expect("a default entry");
    assert_eq!(e.name, "local");
    assert_eq!(e.model, "gemma-4-12B-it-qat-mxfp8");
    assert_eq!(e.base_url, "http://127.0.0.1:8873/v1");
    assert_eq!(e.chat_url().unwrap(), "http://127.0.0.1:8873/v1/chat/completions");
}

/// A name that IS a key is that entry — `model: local` in an agent.md is a
/// catalogue key, not a model id.
#[test]
fn a_known_name_is_the_entry_not_a_model_id() {
    let e = Catalogue::parse(FILE).resolve("openai").unwrap();
    assert_eq!((e.model.as_str(), e.base_url.as_str()), ("gpt-5", "https://api.openai.com/v1"));
}

/// The Python's escape hatch: an unknown key is a MODEL ID served by the
/// default entry's endpoint. One line in an agent file points it at another
/// model on the same server.
#[test]
fn an_unknown_name_is_a_model_id_on_the_default_endpoint() {
    let e = Catalogue::parse(FILE).resolve("qwen3-30b").unwrap();
    assert_eq!(e.model, "qwen3-30b", "the key itself becomes the model id");
    assert_eq!(e.base_url, "http://127.0.0.1:8873/v1", "the default entry's endpoint");
    assert_eq!(e.name, "local");
}

/// An entry whose wire protocol this build does not speak refuses in words,
/// rather than POSTing chat-completions bytes at a server expecting Messages.
#[test]
fn an_entry_this_build_cannot_speak_refuses_by_name() {
    let err = Catalogue::parse(FILE).resolve("sonnet").unwrap().chat_url().unwrap_err();
    match err {
        kernel::ModelError::Unsupported { detail } => {
            assert!(detail.contains("sonnet") && detail.contains("anthropic"), "{detail}");
        }
        other => panic!("expected Unsupported, got {other:?}"),
    }
}

/// A user override in the store beats the shipped file — field by field, so
/// changing the base URL keeps the file's model name.
#[test]
fn a_stored_override_beats_the_file() {
    let mut e = shipped();
    e.select("local");
    e.set("http://127.0.0.1:9000/v1", None, "");
    let entry = e.resolve("local").unwrap();
    assert_eq!(entry.base_url, "http://127.0.0.1:9000/v1", "the user's URL wins");
    assert_eq!(entry.model, "gemma-4-12B-it-qat-mxfp8", "and the file's model survives");
    // It survives a reload, which is the whole point of persisting it.
    let mut reloaded = shipped();
    reloaded.load_profile(&e.profile_json());
    assert_eq!(reloaded.resolve("local").unwrap().base_url, "http://127.0.0.1:9000/v1");
}

/// Precedence, stated: the user's explicit pick in Settings outranks the
/// agent's `model:` key; with no pick, the agent's key decides.
#[test]
fn an_explicit_pick_outranks_the_agents_model_key() {
    let mut e = shipped();
    assert_eq!(e.resolve("openai").unwrap().name, "openai", "no pick: the agent chooses");
    e.select("local");
    assert_eq!(e.resolve("openai").unwrap().name, "local", "a pick overrides the agent");
}

/// Overrides are per entry: editing one must not wipe another.
#[test]
fn overrides_are_kept_per_entry() {
    let mut e = shipped();
    e.select("local");
    e.set("http://127.0.0.1:9000/v1", None, "");
    e.select("openai");
    e.set("https://openrouter.ai/api/v1", None, "openai/gpt-4o-mini");
    // Read the catalogue directly: `resolve` honours the explicit pick, and
    // what is being asserted here is that BOTH overrides are still stored.
    let c = e.catalogue();
    assert_eq!(c.resolve("local").unwrap().base_url, "http://127.0.0.1:9000/v1");
    assert_eq!(c.resolve("openai").unwrap().model, "openai/gpt-4o-mini");
    assert_eq!(c.resolve("openai").unwrap().base_url, "https://openrouter.ai/api/v1");
}
