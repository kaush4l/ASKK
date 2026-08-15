//! Web search, declared and READ. `core::websearch` is the one place a search
//! actually goes out — this file owns the two halves that are pure: the query
//! a SearXNG instance is asked, and the turning of its answer into the few
//! lines a model can hold (I3: both test on the host, no browser, no network).
//!
//! The answer is a JSON document of unbounded size — a single `format=json`
//! reply is routinely 200 KB of engine metadata, positions, parsed URLs and
//! categories. Handing that to a model is not a search result, it is the
//! window spent. Five rows, each a title, a URL and one line, is what a person
//! reading a results page actually uses, and it is what this returns.

use serde_json::Value;

/// The tool's name, in one place: the descriptor, the executor's match arm and
/// the refusal all read it from here (the `is_workspace_tool` discipline).
pub const WEB_SEARCH: &str = "web_search";

/// How many results a model gets. Five, because the sixth has never changed an
/// answer and every row costs the window it is written into.
const RESULTS: usize = 5;
/// Hard caps per row. A title is a headline and a snippet is one line; both
/// arrive from a stranger's server, so neither is trusted to be short.
const TITLE: usize = 120;
const SNIPPET: usize = 180;

/// The path under the configured endpoint's base URL. SearXNG's JSON API is
/// `/search?q=…&format=json` — the shape the Settings copy names, so the value
/// a person types (an origin) and the value this appends cannot drift apart.
pub fn search_path(query: &str) -> String {
    format!("/search?q={}&format=json", encoded(query))
}

/// Percent-encoding, by hand and only for a query value. A dependency for
/// this would be 30 lines of crate to save 8 of code; the rule is RFC 3986's
/// unreserved set, and everything else — space, `&`, `#`, every non-ASCII
/// byte — is escaped, so a query can never end the parameter it is inside.
fn encoded(query: &str) -> String {
    let mut out = String::new();
    for byte in query.trim().as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// One field of a result, trimmed to one line and capped. Newlines are the
/// reason for the trim, not tidiness: a snippet that carries them turns the
/// numbered list into something the model reads as several results.
fn line(value: Option<&Value>, cap: usize) -> String {
    let text = value.and_then(Value::as_str).unwrap_or_default();
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match flat.char_indices().nth(cap) {
        Some((at, _)) => format!("{}…", &flat[..at]),
        None => flat,
    }
}

/// The reply, as the model reads it. `Err` is reserved for a body that is not
/// a search answer at all: an instance that refuses cross-origin JSON tends to
/// send an HTML page with a 200 on it, and "no results" would be a lie about
/// what happened.
pub fn results(body: &str) -> Result<String, String> {
    let Ok(doc) = serde_json::from_str::<Value>(body) else {
        return Err("the search endpoint did not answer with JSON. Most SearXNG instances \
                    serve HTML only and refuse cross-origin JSON; the endpoint has to be one \
                    that allows it."
            .into());
    };
    let Some(rows) = doc.get("results").and_then(Value::as_array) else {
        return Err("that JSON is not a search answer: it has no 'results'.".into());
    };
    let found: Vec<String> = rows
        .iter()
        .filter(|row| !line(row.get("url"), usize::MAX).is_empty())
        .take(RESULTS)
        .enumerate()
        .map(|(i, row)| {
            let url = line(row.get("url"), usize::MAX);
            // A result with no title is still a result: the URL is the thing
            // the model needs, and dropping the row for a missing headline
            // would lose the answer to keep the formatting.
            let title = match line(row.get("title"), TITLE) {
                empty if empty.is_empty() => url.clone(),
                titled => titled,
            };
            match line(row.get("content"), SNIPPET) {
                blank if blank.is_empty() => format!("{}. {title} — {url}", i + 1),
                snippet => format!("{}. {title} — {url}\n   {snippet}", i + 1),
            }
        })
        .collect();
    match found.is_empty() {
        true => Ok("The search ran and found nothing.".into()),
        false => Ok(found.join("\n")),
    }
}
