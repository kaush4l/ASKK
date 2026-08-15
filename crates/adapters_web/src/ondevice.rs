//! THE MODEL THAT IS ALREADY IN THE BROWSER — Chrome's Prompt API as one more
//! catalogue entry, behind the same `ModelPort` everything else uses.
//!
//! Nothing upstream learns this exists. `core` renders a Document, `context`
//! writes an OpenAI chat-completions body, and this file turns that body into a
//! `LanguageModel` session and the answer back into a body of the same shape
//! (I13, I4). No URL, no `Authorization` header, no `fetch`: the four bytes
//! that make this entry different are `kind: on-device` in the catalogue.
//!
//! The API shape is `LanguageModel.availability()` / `LanguageModel.create()` /
//! `session.prompt()`, confirmed against developer.chrome.com/docs/ai/prompt-api
//! (last updated 2026-05-19). It is reached with `js_sys::Reflect`, not
//! `web-sys` and not a shim in `index.html`: the API is not in any web-sys
//! release, so a typed binding would be a hand-written `extern "C"` block, and
//! reflection off `globalThis` is the same thing with a feature test built in.
//! **There is therefore no JavaScript here and no I5 exception to declare.**
//! The pre-138 spelling (`window.ai.languageModel`, `capabilities()`) is NOT
//! supported: it is a different API, and half-supporting it would advertise a
//! model this code cannot actually prompt.

use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use kernel::{ModelError, ModelReply};

/// The catalogue key AND the `kind`. One string, so `models.json`, the resolver
/// and the UI cannot disagree about what this entry is called.
pub const NAME: &str = "on-device";

/// A prompt is aborted on the same budget as a network call (`model.rs`), for
/// the same reason: a wedged generation must look different from a hung page.
/// The DOWNLOAD is not on a budget — see `create` below.
const PROMPT_TIMEOUT_MS: f64 = crate::model::TIMEOUT_SECS as f64 * 1000.0;

/// One `{role, content}` pair on its way to the session.
type Turn = (String, String);

/// The catalogue overlay to add for this browser, or `None` — I15. `entry_for`
/// holds the rule and the copy, on the host side of this file.
pub async fn probe() -> Option<String> {
    entry_for(&availability().await?)
}

/// One turn against the browser's own model. Same signature shape as the fetch
/// path, same `ModelReply` out: nothing downstream can tell which ran.
pub(crate) async fn call(body_json: &str) -> Result<ModelReply, ModelError> {
    let (system, turns) = split_turns(body_json)?;
    let lm = language_model().ok_or_else(absent)?;
    let session = create(&lm, &system).await?;
    let answer = prompt(&session, &turns).await;
    // Free the session either way: an abandoned one holds the model resident.
    if let Ok(f) = js_sys::Reflect::get(&session, &"destroy".into()) {
        if let Ok(f) = f.dyn_into::<js_sys::Function>() {
            let _ = f.call0(&session);
        }
    }
    Ok(ModelReply {
        // No token counts: the session reports context USAGE, which is not what
        // this turn spent, so the meter says "unreported" rather than a number
        // this page made up.
        usage: None,
        body_json: reply_body(&answer?),
    })
}

/// The refusal when the API is not here — in a Worker (every sub-agent runs in
/// one, and Chrome does not offer the Prompt API there), in Firefox, in Safari.
/// It is `OnDevice`, not `Transport` or `Provider`: nothing was sent anywhere,
/// there is no address to check and no key to correct.
pub(crate) fn absent() -> ModelError {
    ModelError::OnDevice {
        detail: "this browser does not offer its built-in model to this page. Chrome offers it \
                 to a top-level page on a supported machine and not inside a Worker, which is \
                 where every sub-agent's turn runs; Firefox and Safari do not offer it at all"
            .into(),
    }
}

fn refused(what: &str, e: &JsValue) -> ModelError {
    ModelError::OnDevice {
        detail: format!("{what}: {}", crate::wire::js_message(e)),
    }
}

fn language_model() -> Option<js_sys::Object> {
    js_sys::Reflect::get(&js_sys::global(), &"LanguageModel".into())
        .ok()?
        .dyn_into::<js_sys::Object>()
        .ok()
}

/// `LanguageModel.availability()` as a plain string, or `None` if there is no
/// such object here. Any rejection is read as "not available": a probe that
/// throws must cost the entry, never the page (I15).
async fn availability() -> Option<String> {
    let lm = language_model()?;
    let call = js_sys::Reflect::get(&lm, &"availability".into())
        .ok()?
        .dyn_into::<js_sys::Function>()
        .ok()?;
    let promise = call.call0(&lm).ok()?.dyn_into::<js_sys::Promise>().ok()?;
    JsFuture::from(promise).await.ok()?.as_string()
}

/// `LanguageModel.create({initialPrompts})`. NO abort signal: when the model
/// still has to be downloaded this call is the download, and a five-minute
/// budget would cancel a multi-gigabyte fetch the user was told to expect.
async fn create(lm: &js_sys::Object, system: &[Turn]) -> Result<JsValue, ModelError> {
    let opts = js_sys::Object::new();
    if !system.is_empty() {
        let _ = js_sys::Reflect::set(&opts, &"initialPrompts".into(), &turn_array(system));
    }
    let f = js_sys::Reflect::get(lm, &"create".into())
        .and_then(|f| f.dyn_into::<js_sys::Function>())
        .map_err(|e| refused("this browser's LanguageModel.create is not callable", &e))?;
    let promise = f
        .call1(lm, &opts)
        .and_then(|p| p.dyn_into::<js_sys::Promise>())
        .map_err(|e| refused("this browser would not open a session", &e))?;
    JsFuture::from(promise)
        .await
        .map_err(|e| refused("this browser would not open a session", &e))
}

/// `session.prompt(messages, {signal})` → the answer text.
async fn prompt(session: &JsValue, turns: &[Turn]) -> Result<String, ModelError> {
    let opts = js_sys::Object::new();
    let signal = web_sys::AbortSignal::timeout_with_f64(PROMPT_TIMEOUT_MS);
    let _ = js_sys::Reflect::set(&opts, &"signal".into(), &signal);
    let f = js_sys::Reflect::get(session, &"prompt".into())
        .and_then(|f| f.dyn_into::<js_sys::Function>())
        .map_err(|e| refused("this browser's session cannot be prompted", &e))?;
    let promise = f
        .call2(session, &turn_array(turns), &opts)
        .and_then(|p| p.dyn_into::<js_sys::Promise>())
        .map_err(|e| refused("the model refused the prompt", &e))?;
    let out = JsFuture::from(promise)
        .await
        .map_err(|e| match e.dyn_ref::<web_sys::DomException>().map(|d| d.name()) {
            // Ours, on the same budget the wire path uses.
            Some(name) if name == "AbortError" || name == "TimeoutError" => ModelError::Timeout {
                url: String::new(),
                seconds: crate::model::TIMEOUT_SECS,
            },
            _ => refused("the model did not answer", &e),
        })?;
    out.as_string().ok_or_else(|| ModelError::OnDevice {
        detail: "the model answered with something that was not text".into(),
    })
}

fn turn_array(turns: &[Turn]) -> js_sys::Array {
    turns
        .iter()
        .map(|(role, content)| {
            let o = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&o, &"role".into(), &JsValue::from_str(role));
            let _ = js_sys::Reflect::set(&o, &"content".into(), &JsValue::from_str(content));
            o
        })
        .collect()
}

pub use pure::{entry_for, reply_body, split_turns};

mod pure;
