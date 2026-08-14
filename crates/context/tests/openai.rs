//! The one thing `temperature:` had never done: reach a request body.
//!
//! The key parsed (`spec.rs`), rendered back out (`author.rs`) and printed on
//! the agent card for eighteen rounds while `Effect::CallModel` had no field
//! for it. This is the wire end of the fix.

use context::{openai_request_body, ContentPart, Message, Role};

fn one() -> Vec<Message> {
    vec![Message {
        role: Role::User,
        content: vec![ContentPart::Text { text: "hi".into() }],
    }]
}

#[test]
fn the_agents_temperature_reaches_the_request_body() {
    let body = openai_request_body(&one(), "local", Some(0.7));
    let v: serde_json::Value = serde_json::from_str(&body).expect("valid JSON body");
    assert_eq!(v["temperature"], serde_json::json!(0.7));
}

/// …AND AN AGENT FILE THAT NAMES NONE SENDS NONE. An absent key means "the
/// endpoint's default"; stamping a number we invented would be this build
/// silently overriding a server setting nobody asked it to touch.
#[test]
fn a_file_that_names_no_temperature_sends_no_temperature() {
    let body = openai_request_body(&one(), "local", None);
    let v: serde_json::Value = serde_json::from_str(&body).expect("valid JSON body");
    assert!(v.get("temperature").is_none(), "not even a null: {body}");
}
