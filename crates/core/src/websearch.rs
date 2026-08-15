//! `web_search`, run. `agent::search` declares the name, writes the query and
//! reads the answer; this file is the single place the `NetPort` is called for
//! it, exactly as `workspace.rs` is for the Linux and `tools.rs` for the local
//! table.
//!
//! THE GATE IS THE ALLOWLIST AND IT IS NOT HERE (ADR-006, I6). The core names
//! an endpoint — `search`, symbolic, no URL anywhere in this crate — and the
//! adapter either has an address for that name or refuses. So this file cannot
//! reach anywhere the user did not put on the list, and does not have to be
//! trusted not to.
//!
//! Every ending is a RESULT, never an error return: a refusal, a 403 and a
//! body that was not JSON are all things a model can read and act on, and the
//! act it takes is usually the right one — rewording the query, or telling the
//! person that the endpoint they configured will not answer.

use std::cell::RefCell;
use std::rc::Rc;

use kernel::{BrokeredRequest, EndpointName, EventKind, NetError, ToolId, SEARCH_ENDPOINT};

use crate::app::App;

/// What the model is told when nothing is configured. It names the setting AND
/// the fact that no code path can turn this on for you: an agent that reads
/// "not configured" and retries has learned nothing.
const UNSET: &str = "No search endpoint is configured in this browser, so nothing was searched. \
                     A person sets one under Settings → Web search; nothing on this page can \
                     turn it on for you, and retrying will refuse again.";

/// Run `web_search`, or `None` if this is not it (the caller then tries the
/// local table). Total, like every tool.
pub(crate) async fn run(
    app: &Rc<RefCell<App>>,
    tool: &ToolId,
    args_json: &str,
) -> Option<EventKind> {
    if tool.0 != agent::WEB_SEARCH {
        return None;
    }
    let query = serde_json::from_str::<serde_json::Value>(args_json)
        .ok()
        .and_then(|v| Some(v.get("query")?.as_str()?.to_string()))
        .unwrap_or_default();
    let outcome = match query.trim().is_empty() {
        // The `read_agent` discipline: an unreadable argument is refused in the
        // words that name the fix, never delivered as an empty search.
        true => Err("no query given. Call it as web_search({\"query\": \"<what to look up>\"})"
            .to_string()),
        false => {
            let port = Rc::clone(&app.borrow().ports.net);
            let req = BrokeredRequest {
                method: "GET".into(),
                path: agent::search_path(&query),
                body: None,
            };
            answered(port.fetch(&EndpointName(SEARCH_ENDPOINT.into()), req).await)
        }
    };
    let (ok, output) = match outcome {
        Ok(found) => (true, found),
        Err(refusal) => (false, refusal),
    };
    Some(EventKind::ToolInvoked {
        tool: tool.clone(),
        args: args_json.to_string(),
        ok,
        output,
    })
}

/// The port's outcome in words. `Denied` is the unconfigured case and nothing
/// else: the allowlist is built from the setting, so an empty setting is an
/// empty list and a denial is what an empty list produces.
fn answered(reply: Result<kernel::BrokeredResponse, NetError>) -> Result<String, String> {
    match reply {
        Ok(res) if (200..300).contains(&res.status) => {
            agent::search_results(&String::from_utf8_lossy(&res.body))
        }
        // The status, plainly. 403 and 429 are the two a public SearXNG
        // instance actually sends — one refuses strangers, the other refuses
        // you for a while — and both are the endpoint's answer, not ours.
        Ok(res) => Err(format!(
            "The search endpoint answered {}, so there are no results. A public instance \
             refusing strangers (403) or rate-limiting (429) is the usual cause.",
            res.status
        )),
        Err(NetError::Denied { .. }) => Err(UNSET.into()),
        Err(NetError::Status { status }) => {
            Err(format!("The search endpoint answered {status}."))
        }
        Err(NetError::Transport { message }) => Err(format!(
            "The search endpoint could not be reached: {message}"
        )),
    }
}
