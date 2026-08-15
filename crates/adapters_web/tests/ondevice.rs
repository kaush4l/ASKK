//! The browser's own model as a catalogue entry, pinned on the host (I3): the
//! two conversions that carry a turn to it and back, and the two rules that
//! keep it from misleading anybody where it is absent.

use adapters_web::catalogue::Catalogue;
use adapters_web::ondevice::{reply_body, split_turns, NAME};
use adapters_web::Endpoint;

/// What `context::openai_request_body` writes for one turn: a system message
/// carrying the whole assembled Document, and a short user message.
const BODY: &str = r##"{"model":"on-device","stream":false,"messages":[
  {"role":"system","content":"affordances: read_file(path)"},
  {"role":"user","content":"Proceed as the response_contract instructs."}]}"##;

/// The system turn is the session's, the rest is the prompt. Chrome takes a
/// system role only at creation and never evicts it, which is what the
/// Document's system section needs.
#[test]
fn the_system_document_creates_the_session_and_the_rest_is_prompted() {
    let (system, turns) = split_turns(BODY).expect("a readable body");
    assert_eq!(system.len(), 1, "one system turn: {system:?}");
    assert_eq!(system[0].0, "system");
    assert!(system[0].1.contains("read_file(path)"), "{:?}", system[0].1);
    assert_eq!(turns.len(), 1, "the user turn is what gets prompted");
    assert_eq!(turns[0].0, "user");
}

/// A body with no user turn still asks something — never an empty prompt.
#[test]
fn a_system_only_body_is_prompted_rather_than_asked_nothing() {
    let body = r#"{"messages":[{"role":"system","content":"say hi"}]}"#;
    let (system, turns) = split_turns(body).unwrap();
    assert!(system.is_empty(), "nothing left to create the session with");
    assert_eq!(turns.len(), 1, "the system turn is the prompt: {turns:?}");
}

/// An attachment is REFUSED, not silently dropped. This build has only ever
/// sent text; answering while discarding an image would be the quiet lie.
#[test]
fn an_image_is_refused_rather_than_dropped() {
    let body = r#"{"messages":[{"role":"user","content":[
        {"type":"text","text":"what is this"},
        {"type":"image_url","image_url":{"url":"data:image/png;base64,AA"}}]}]}"#;
    let err = split_turns(body).expect_err("an image cannot be sent as text");
    let kernel::ModelError::OnDevice { detail } = err else {
        panic!("an on-device refusal, not a transport or provider error: {err:?}");
    };
    assert!(detail.contains("only text"), "{detail}");
}

/// The reply is the shape the OpenAI path produces, at the exact path
/// `context::openai_reply_text` reads (`choices[0].message.content`) — nothing
/// downstream can tell which endpoint answered. Asserted here rather than
/// through that function because `adapters_web` may not depend on `context`
/// (ARCHITECTURE §4, and `check-layering.py` enforces it).
#[test]
fn the_answer_comes_back_in_the_openai_shape() {
    let v: serde_json::Value = serde_json::from_str(&reply_body("Rome")).unwrap();
    assert_eq!(v["choices"][0]["message"]["content"], "Rome");
    assert_eq!(v["choices"][0]["message"]["role"], "assistant");
    assert!(
        v.get("usage").is_none(),
        "no token counts were reported, so none are invented: {v}"
    );
}

/// I15, and the trap under it: where the entry is ABSENT, asking for it must
/// not fall through the catalogue's "an unknown name is a model id on the
/// default endpoint" rule and POST `model: on-device` at somebody's server.
#[test]
fn asking_for_it_where_it_is_absent_refuses_instead_of_calling_a_server() {
    let mut e = Endpoint::default();
    e.set_catalogue(
        r#"{"default":"local","models":{"local":{"model":"gemma","base_url":"http://127.0.0.1:8873/v1"}}}"#,
    );
    let err = e.resolve(NAME).expect_err("no such entry in this browser");
    let kernel::ModelError::OnDevice { detail } = err else {
        panic!("it must say the browser has no such model, not 'no endpoint': {err:?}");
    };
    assert!(detail.contains("Worker"), "a sub-agent is the common case: {detail}");
    // …and the ordinary escape hatch still works for every other name.
    assert_eq!(e.resolve("qwen3-30b").unwrap().model, "qwen3-30b");
}

/// Where it IS present, it resolves to itself, carries its note, and never
/// yields a URL to POST to.
#[test]
fn where_it_is_present_it_is_an_entry_with_no_address() {
    let mut e = Endpoint::default();
    e.set_catalogue(r#"{"default":"local","models":{"local":{"base_url":"http://x/v1"}}}"#);
    e.add_catalogue(
        r#"{"models":{"on-device":{"kind":"on-device","model":"your browser's own model",
            "base_url":"","note":"already on this machine"}}}"#,
    );
    let entry = e.resolve(NAME).expect("present here");
    assert!(entry.is_on_device());
    assert_eq!(entry.note, "already on this machine");
    assert!(entry.chat_url().is_err(), "there is no URL to POST to");
    assert!(e.names().iter().any(|n| n == NAME), "it is listed: {:?}", e.names());
}

/// The `note` reaches the catalogue from the file too — the field has been in
/// `models.json` since the start and nothing read it until now.
#[test]
fn a_note_in_the_file_is_read() {
    let c = Catalogue::parse(r#"{"default":"a","models":{"a":{"note":"bring a scoped key"}}}"#);
    assert_eq!(c.resolve("a").unwrap().note, "bring a scoped key");
}
