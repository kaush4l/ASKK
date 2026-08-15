//! Credentials, pinned on the host (I3). One key per catalogue ENTRY: the
//! increment-04 build carried a single key to every entry, so entering an
//! OpenRouter key and switching entries sent it to api.openai.com,
//! api.anthropic.com and 127.0.0.1. These tests are what refuse that.

use adapters_web::Endpoint;

/// The shipped file, trimmed to the shapes that matter.
const FILE: &str = r#"{
  "default": "local",
  "models": {
    "local": {"model": "gemma-4-12B-it-qat-mxfp8", "base_url": "http://127.0.0.1:8873/v1"},
    "openai": {"model": "gpt-5", "base_url": "https://api.openai.com/v1"},
    "openrouter": {"model": "openai/gpt-4o-mini", "base_url": "https://openrouter.ai/api/v1"},
    "sonnet": {"kind": "anthropic", "model": "claude-sonnet-5",
               "base_url": "https://api.anthropic.com/v1"}
  }
}"#;

fn shipped() -> Endpoint {
    let mut e = Endpoint::default();
    e.set_catalogue(FILE);
    e
}

/// The 02b bug, re-pinned through the catalogue AND per entry: Save with the
/// write-only key field blank must NOT wipe that entry's stored key; only an
/// explicit empty clears it.
#[test]
fn a_blank_key_field_still_preserves_the_stored_key() {
    let mut e = shipped();
    e.select("openai");
    e.set("", Some("sk-secret"), "");
    e.set("https://api.openai.com/v1", None, "");
    assert!(e.summary().1, "a key is still saved");
    assert_eq!(e.api_key_for("openai"), "sk-secret");
    e.set("", Some(""), "");
    assert!(!e.summary().1, "and clearing it is explicit and possible");
}

/// The increment-04 credential leak, pinned: ONE key per ENTRY. A key entered
/// under `openrouter` must never be attached to a call to `api.openai.com`,
/// `api.anthropic.com` or `127.0.0.1` — switching entries used to carry it to
/// all three (`ux-walker`).
#[test]
fn a_key_saved_for_one_entry_is_not_sent_to_another() {
    let mut e = shipped();
    e.select("openrouter");
    e.set("", Some("sk-openrouter"), "");
    for other in ["openai", "local", "sonnet"] {
        e.select(other);
        assert_eq!(e.api_key_for(other), "", "{other} must have no key");
        assert!(!e.summary().1, "{other} must not report a saved key");
    }
    e.select("openai");
    e.set("", Some("sk-openai"), "");
    assert_eq!(e.api_key_for("openrouter"), "sk-openrouter", "kept, untouched");
    assert_eq!(e.api_key_for("openai"), "sk-openai");
    // And it survives the round trip through storage, still separated.
    let mut reloaded = shipped();
    reloaded.load_profile(&e.profile_json());
    assert_eq!(reloaded.api_key_for("openrouter"), "sk-openrouter");
    assert_eq!(reloaded.api_key_for("openai"), "sk-openai");
    assert_eq!(reloaded.api_key_for("local"), "");
}

/// The one key already stored is not dropped by that change: it lands on the
/// entry it was last used with, and nowhere else.
#[test]
fn a_single_stored_key_migrates_onto_the_entry_it_was_used_with() {
    let mut e = shipped();
    e.load_profile(r#"{"selected":"openrouter","api_key":"sk-old","overrides":{}}"#);
    assert_eq!(e.api_key_for("openrouter"), "sk-old");
    assert_eq!(e.api_key_for("openai"), "", "not carried to the others");
    // With no pick, it belonged to the catalogue default, which is what it
    // was silently being used as.
    let mut d = shipped();
    d.load_profile(r#"{"api_key":"sk-old"}"#);
    assert_eq!(d.api_key_for("local"), "sk-old");
}

/// There is a way back. Once any entry was saved the choice used to be
/// permanent — the walker had to delete the IndexedDB database to reset.
#[test]
fn reset_returns_to_the_shipped_catalogue_default() {
    let mut e = shipped();
    e.select("openai");
    e.set("https://elsewhere.example/v1", Some("sk-secret"), "my-model");
    e.reset();
    assert_eq!(e.current(), "local", "back to the file's own default");
    assert_eq!(e.resolve("openai").unwrap().base_url, "https://api.openai.com/v1");
    assert_eq!(e.api_key_for("openai"), "", "and the key is gone, not orphaned");
}

/// A profile written before the catalogue existed carried a bare base_url.
/// Nobody's saved endpoint is lost by this increment.
#[test]
fn a_pre_catalogue_profile_becomes_an_override() {
    let mut e = shipped();
    e.load_profile(r#"{"base_url":"http://127.0.0.1:1234/v1","api_key":"sk-old","model":"mine"}"#);
    let entry = e.resolve("").unwrap();
    assert_eq!(entry.base_url, "http://127.0.0.1:1234/v1");
    assert_eq!(entry.model, "mine");
    assert_eq!(e.api_key(), "sk-old");
}

/// No catalogue file at all (a failed fetch) still leaves a usable app: a
/// typed error, and a typed-in URL that works.
#[test]
fn without_a_catalogue_there_is_a_typed_error_and_a_way_out() {
    let mut e = Endpoint::default();
    assert!(e.names().is_empty());
    assert!(matches!(
        e.resolve("").unwrap_err(),
        kernel::ModelError::EndpointUnknown { .. }
    ));
    e.set("http://127.0.0.1:8873/v1", None, "local-model");
    assert_eq!(e.resolve("").unwrap().base_url, "http://127.0.0.1:8873/v1");
}

/// Saving the values the pane PRE-FILLED is agreement, not an override. Before
/// increment 06 every Save pinned every field — the fields are never blank, so
/// "blank uses this entry's own" was unreachable and a later `models.json`
/// edit could never reach anyone who had pressed Save (`ux-walker`).
#[test]
fn saving_the_prefilled_values_pins_nothing() {
    let mut e = shipped();
    e.select("local");
    // Exactly what the pane shows for this entry, saved back unchanged.
    let (url, _, model, _) = e.summary();
    e.set(&url, Some("k"), &model);
    assert!(
        !e.profile_json().contains("127.0.0.1"),
        "no override was stored: {}",
        e.profile_json()
    );

    // The endpoint moves when the FILE moves — which is the whole point.
    e.set_catalogue(&FILE.replace("127.0.0.1:8873", "127.0.0.1:9999"));
    assert_eq!(e.summary().0, "http://127.0.0.1:9999/v1");
    assert_eq!(e.api_key_for("local"), "k", "the key is untouched");

    // A value that really differs is still an override, and still reverts.
    e.set("http://127.0.0.1:1234/v1", None, "");
    assert_eq!(e.summary().0, "http://127.0.0.1:1234/v1");
    e.set("", None, "");
    assert_eq!(e.summary().0, "http://127.0.0.1:9999/v1", "blank reverts");
}

/// The search endpoint rides in the SAME record, which is what a Worker boots
/// from — so a sub-agent searches where the page does (increment 21). It is
/// not a credential and has no key of its own; the record is the only thing
/// being tested here.
#[test]
fn the_search_endpoint_survives_a_round_trip_and_a_reset_clears_it() {
    let mut e = shipped();
    assert_eq!(e.search(), "", "the shipped state is unset, which is the refusing one");

    e.set_search("https://search.example.org/");
    assert_eq!(e.search(), "https://search.example.org", "no trailing slash to double");

    let mut booted = Endpoint::default();
    booted.load_profile(&e.profile_json());
    assert_eq!(booted.search(), "https://search.example.org", "a Worker gets it");

    // A record written before this setting existed must not inherit one.
    let mut older = Endpoint::default();
    older.load_profile(r#"{"selected": "local", "keys": {}}"#);
    assert_eq!(older.search(), "");

    e.reset();
    assert_eq!(e.search(), "", "forgetting the endpoints forgets this one too");
}
