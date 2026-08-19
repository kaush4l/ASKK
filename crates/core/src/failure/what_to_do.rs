//! WHICH FAILURE THIS WAS, AND WHAT TO DO ABOUT IT. `agents/card.rs` owns the
//! disclosure and the recording; the two sentences inside it are chosen here.
//!
//! One rule, and R12-2 is the reason it is written down. A remedy is chosen on
//! the TYPED variant and it may name only what that variant actually knows. A
//! `fetch` that never came back rejects identically whether the host refused
//! the connection or our own budget fired; classifying both as `Transport`
//! produced "the endpoint was unreachable — check CORS, and Chrome asks
//! permission for a local address" over a request the network log showed
//! answering 200. Two facts, two variants, two remedies.

/// Which failure this was, in two or three words — the disclosure's name.
pub(crate) fn failure_kind(payload_json: &str) -> &'static str {
    use kernel::ModelError::{
        EndpointUnknown, ModelMissing, NoKey, OnDevice, Provider, Timeout, Transport, Unsupported,
    };
    match serde_json::from_str::<crate::error::CoreError>(payload_json) {
        Ok(crate::error::CoreError::Model(EndpointUnknown { .. })) => "no endpoint configured",
        Ok(crate::error::CoreError::Model(OnDevice { .. })) => "the browser's own model refused",
        Ok(crate::error::CoreError::Model(Transport { .. })) => "the endpoint was unreachable",
        // A TIMEOUT IS NOT UNREACHABILITY (R12-2a). Same rejection at the
        // fetch, two different facts about the world, and only one of them is
        // about the endpoint being wrong.
        Ok(crate::error::CoreError::Model(Timeout { .. })) => "the model ran out of time",
        Ok(crate::error::CoreError::Model(Unsupported { .. })) => "unsupported wire protocol",
        Ok(crate::error::CoreError::Model(Provider { .. })) => "the provider refused",
        Ok(crate::error::CoreError::Model(NoKey { .. })) => "no API key was sent",
        Ok(crate::error::CoreError::Model(ModelMissing { .. })) => NO_SUCH_MODEL,
        Ok(crate::error::CoreError::StaleAssets { .. }) => "stale cached assets",
        _ => "raw error",
    }
}

/// THE ONE PLACE A HOST'S OWN WORDING BECOMES A VARIANT (R13-P0-3).
///
/// A Worker that cannot `import()` this build's fingerprinted bundle rejects
/// with the browser's exception text, and that text was written straight into
/// the agent's status: three cards and the header's banner read `Failed to
/// fetch dynamically imported module: http://…/ui-f0314cbb.js`, the one
/// sentence in this product nobody wrote. Recognising it HERE rather than in
/// `adapters_web` is what puts it under `cargo test` on the host (I3) and what
/// keeps every reporter of a lifecycle failure — the boot report, the failed
/// construction, the missing-bundle case — on one path.
///
/// Recognition is by the browser's words because that is all a rejected
/// dynamic import gives; everything downstream matches on the TYPE, which is
/// the rule `failure_kind` and `failure_line` keep.
pub(crate) fn recognise(message: &str) -> Option<crate::error::CoreError> {
    let import_refused = ["dynamically imported module", "Importing a module script failed"]
        .iter()
        .any(|mark| message.contains(mark));
    import_refused.then(|| crate::error::CoreError::StaleAssets {
        url: url_in(message),
    })
}

/// The address the browser named, if it named one.
fn url_in(message: &str) -> String {
    message
        .split_whitespace()
        .find(|word| word.starts_with("http://") || word.starts_with("https://"))
        .unwrap_or_default()
        .to_string()
}

/// Whether this string is a typed failure payload at all — the test
/// `report_agent` makes before it reads a lifecycle detail as one.
pub(crate) fn typed(payload_json: &str) -> bool {
    serde_json::from_str::<crate::error::CoreError>(payload_json).is_ok()
}

/// The actionable sentence, chosen on the typed variant — not by grepping the
/// payload. Each names its own fix; the fallback admits it has none.
pub(crate) fn failure_line(payload_json: &str) -> String {
    use kernel::ModelError::{
        EndpointUnknown, ModelMissing, NoKey, OnDevice, Provider, Timeout, Transport, Unsupported,
    };
    match serde_json::from_str::<crate::error::CoreError>(payload_json) {
        // …AND THE BROWSER'S OWN MODEL HAS NEITHER A URL NOR A KEY TO CORRECT.
        Ok(crate::error::CoreError::Model(OnDevice { detail })) => return on_device(&detail),
        // The Local Network Access prompt is about LOOPBACK, and this sentence
        // named it while calling `https://198.51.100.7/v1` (increment 06). The
        // ADDRESS chooses which of the two real causes to name.
        Ok(crate::error::CoreError::Model(Transport { url, .. })) => return unreachable_line(&url),
        // …AND IT IS NOT SAID AT ALL ABOUT A TIMEOUT (R12-2c). The remedy above
        // sends a person to Settings to check an address that answered.
        Ok(crate::error::CoreError::Model(Timeout { seconds, .. })) => return timed_out(seconds),
        // …AND A MISSING MODEL IS NOT AN AUTH PROBLEM (R18-P1-7). Same 404,
        // same `Provider` variant until now, and the remedy sent a person to
        // check a base URL and an API key that were both correct.
        Ok(crate::error::CoreError::Model(ModelMissing { model, available })) => {
            return no_such_model(&model, &available)
        }
        _ => {}
    }
    match serde_json::from_str::<crate::error::CoreError>(payload_json) {
        Ok(crate::error::CoreError::Model(EndpointUnknown { .. })) => {
            "No model endpoint is set yet. Add one in Settings below — a local \
             OpenAI-compatible server, or a provider's base URL and API key."
        }
        Ok(crate::error::CoreError::Model(Unsupported { .. })) => {
            "That model catalogue entry speaks a wire protocol this build does not. \
             Pick an OpenAI-compatible entry in Settings below — the detail names \
             which protocol the entry asked for."
        }
        Ok(crate::error::CoreError::Model(Provider { .. })) => {
            "The model endpoint answered, but refused the request. Check the base URL \
             and API key in Settings — the provider's own words are below."
        }
        // …AND A REFUSAL OF NOTHING IS NOT A WRONG CREDENTIAL (22). This page
        // sent no `authorization` header at all, which it knows for certain,
        // so it says the one thing to do instead of listing two.
        Ok(crate::error::CoreError::Model(NoKey { .. })) => {
            "This endpoint needs an API key and none is set, so the request went out \
             without one and was refused. Add the key in Settings — the provider's own \
             words are below."
        }
        // THE BOOT SCREEN'S OWN REMEDY, IN THE BOOT SCREEN'S OWN WORDS (R13-P0-3).
        // The second sentence is a claim about `web/sw.js` and only says what
        // that file does: a navigation is network-first, and `activate` deletes
        // every cache but the current build's and the Linux runtime's. It
        // promises nothing about the deploy that has not happened yet.
        Ok(crate::error::CoreError::StaleAssets { .. }) => {
            "An older copy of this page's own code is still being served from this browser's \
             cache, so its agents asked for a file this build does not have. Reload once: the \
             page always fetches its shell from the network, and the worker that arrives with \
             the newer build deletes every cache but its own as it takes over. If it is still \
             here after that reload, open this page in a private window to confirm, then clear \
             this site's data."
        }
        _ => "The turn failed before it produced an answer.",
    }
    .to_string()
}

fn on_device(detail: &str) -> String {
    format!(
        "This turn asked for the model built into your browser, and the browser refused it: \
         {detail}. Nothing was sent over the network — that endpoint has no address and takes \
         no API key, so there is nothing in Settings to correct about it. Pick a different \
         endpoint in Settings if you need this turn now."
    )
}
/// The endpoint could not be reached, and what to check depends on where it is.
fn unreachable_line(url: &str) -> String {
    match is_loopback(url) {
        true => "The model endpoint could not be reached. Check the endpoint in \
                 Settings: it is an address on THIS machine, so the server must be \
                 running, it must send CORS headers, and Chrome 142+ asks permission \
                 before a page may call a local address."
            .to_string(),
        false => "The model endpoint could not be reached. Check the base URL in \
                  Settings: the host must resolve and answer from this browser, and it \
                  must send CORS headers allowing this page's origin."
            .to_string(),
    }
}

/// A SLOW OR STUCK MODEL, said as one (R12-2c). Nothing here sends a person to
/// Settings: the address was right, the server took the request, and the only
/// fact this page has is that no answer came back inside the budget.
fn timed_out(seconds: u32) -> String {
    let waited = match seconds % 60 {
        0 => format!("{} minutes", seconds / 60),
        _ => format!("{seconds} seconds"),
    };
    format!(
        "The model endpoint took the request and had not answered {waited} later, so the page \
         stopped waiting. Nothing here says the endpoint is wrong — a call to a wrong address \
         fails in a moment, not in {waited}. A model that is large for this machine, or asked \
         for a long answer, runs past it: ask for less, or point Settings at a faster model. If \
         the server is yours, its own log says what it was doing."
    )
}

/// The disclosure's name for it, and the one word the board row carries.
pub(crate) const NO_SUCH_MODEL: &str = "no model of that name";

/// WHAT TO CHANGE, AND WHERE. Not Settings: the address answered and the key
/// was accepted. The `model:` line of one agent's file is the whole of it.
fn no_such_model(model: &str, available: &[String]) -> String {
    let offers = match available.is_empty() {
        true => "It did not say which models it does have.".to_string(),
        false => format!("It has: {}.", available.join(", ")),
    };
    format!(
        "This agent's file asks for a model called '{model}', and the endpoint answered that it \
         has no such model. {offers} Open this agent's file and change its `model:` line to one \
         the endpoint offers, or clear that line to take the endpoint's default. Nothing here \
         says the address or the key is wrong — the endpoint answered."
    )
}

/// Whether that URL is this machine. The one definition, so the transcript,
/// the board and Settings cannot disagree about what "local" means.
pub(crate) fn is_loopback(url: &str) -> bool {
    ["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]
        .iter()
        .any(|host| url.contains(host))
}
