//! The two halves of the on-device path that are not the browser: the request
//! body in, the reply body out. Pure, so they are host-tested with no browser
//! (I3) — the parent module is nothing but `Reflect` calls around these.

use serde_json::{json, Value};

use kernel::ModelError;

type Turn = (String, String);

/// The catalogue entry for a browser in this availability state, or `None`
/// (I15). `unavailable` — and any state this build does not know — means the
/// browser or the machine cannot run the model at all, and an entry for it
/// would be an entry that fails on every turn, so there is none: exactly as
/// `SpeechRecognition::new()` returning `Err` means the Dictate button is never
/// drawn (increment 24). `downloadable` and `downloading` DO advertise — the
/// model is real and the browser will fetch it. What differs is the price, and
/// the note is where it is said.
///
/// `base_url` IS EMPTY, because this entry has no address. The readers that
/// print one, and the composer gate that used to require one, branch on this
/// entry being the on-device one before they reach for a URL (`ui::endpoint`).
pub fn entry_for(state: &str) -> Option<String> {
    let note = match state {
        "available" => {
            "The model is already on this machine. This entry uses no address, no API key and \
             no network: the words of the turn go to your browser's own model and come back \
             from it."
        }
        "downloadable" => {
            "Your browser has not downloaded this model yet. The first turn you send starts a \
             download your browser performs and stores itself, measured in gigabytes — this \
             page does not manage it, cannot show its progress, and the turn does not answer \
             until it finishes. Chrome wants about 22 GB free on the drive holding your \
             profile and removes the model again if free space falls below 10 GB; \
             chrome://on-device-internals shows the current size. After that it is local: no \
             address, no API key, no network."
        }
        "downloading" => {
            "Your browser is downloading this model right now. This page did not start that \
             download and cannot show its progress; a turn sent before it finishes waits for \
             it, or fails with your browser's own words. After that it is local: no address, \
             no API key, no network."
        }
        _ => return None,
    };
    Some(
        json!({"models": {super::NAME: {
            "kind": super::NAME,
            "model": "your browser's own model",
            // NO ADDRESS, BECAUSE THERE IS NO ADDRESS. This carried the string
            // "this device" so that readers gating on a non-empty base URL kept
            // working, and the header pill then printed "at this device" — a
            // sentence sitting in the one field that means an address, in the
            // one widget whose job is naming where a turn goes. The readers
            // branch on `kind` now (`ui::endpoint`), so this can be honest.
            "base_url": "",
            "note": note,
        }}})
        .to_string(),
    )
}

/// Split a chat-completions request body into the SYSTEM turns, which become
/// the session's `initialPrompts`, and the rest, which are prompted.
///
/// Chrome takes a system role only at session creation and never evicts it
/// under context pressure, which is the same guarantee the Document's system
/// section wants. Everything after it is a `{role, content}` the session's
/// `prompt()` accepts directly.
///
/// TOOL CALLS ARE TEXT HERE, and that is checked rather than assumed:
/// `context::openai_request_body` writes `{model, stream, messages}` and no
/// `tools` array, and the affordances an agent may call are prose inside the
/// Document. So there is nothing to translate — a provider tool-call API is not
/// in play on either side of this call.
pub fn split_turns(body_json: &str) -> Result<(Vec<Turn>, Vec<Turn>), ModelError> {
    let v: Value = serde_json::from_str(body_json).map_err(|e| refuse(&e.to_string()))?;
    let messages = v
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| refuse("this turn carried no messages"))?;
    let mut turns: Vec<Turn> = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(Value::as_str).unwrap_or("user");
        turns.push((role.to_string(), text_of(m.get("content"))?));
    }
    if turns.is_empty() {
        return Err(refuse("this turn carried no messages"));
    }
    let split = turns.iter().take_while(|(r, _)| r == "system").count();
    let rest = turns.split_off(split);
    match rest.is_empty() {
        // A session with only a system prompt has nothing to answer. Rather
        // than prompt with an empty string, the last system turn is asked.
        true => Ok((Vec::new(), turns)),
        false => Ok((turns, rest)),
    }
}

/// One message's content as text. An image, an audio clip or a file is REFUSED
/// rather than silently dropped: Chrome's model can take them, this build has
/// never sent one, and answering a turn while quietly discarding its attachment
/// is the failure mode this codebase refuses everywhere else.
fn text_of(content: Option<&Value>) -> Result<String, ModelError> {
    match content {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(Value::Array(parts)) => {
            let mut out = String::new();
            for p in parts {
                match p.get("type").and_then(Value::as_str) {
                    Some("text") => out.push_str(p.get("text").and_then(Value::as_str).unwrap_or("")),
                    other => {
                        return Err(refuse(&format!(
                            "this turn includes {} content, and this build sends only text to \
                             your browser's own model",
                            other.unwrap_or("attached")
                        )))
                    }
                }
            }
            Ok(out)
        }
        _ => Ok(String::new()),
    }
}

fn refuse(detail: &str) -> ModelError {
    ModelError::OnDevice {
        detail: detail.to_string(),
    }
}

/// The answer, in the shape the OpenAI path produces — `context::openai_reply_text`
/// reads `choices[0].message.content` and must not learn a second layout (I13).
/// No `usage` block: this model reported no token counts, and an invented zero
/// would be a claim that the turn was free.
pub fn reply_body(text: &str) -> String {
    json!({
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "finish_reason": "stop",
            "message": {"role": "assistant", "content": text}
        }]
    })
    .to_string()
}
