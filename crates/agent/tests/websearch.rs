//! What a search endpoint sends back, read on the host (I3): no browser, no
//! network — the JSON is a fixture, because the shapes that matter are the
//! ones a real instance produces on a bad day.
//!
//! The size test is the increment's whole reason for existing on this side of
//! the seam: a `format=json` reply is a large document with unbounded fields,
//! and the model's window is the thing being protected.

use agent::{builtin_tools, search_path, search_results, WEB_SEARCH};

/// Two results, in the shape SearXNG actually sends (fields it also sends —
/// `engine`, `score`, `parsed_url`, `positions` — are present and ignored).
const REAL: &str = r#"{
  "query": "rust ownership",
  "number_of_results": 2,
  "results": [
    {"url": "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
     "title": "What Is Ownership? - The Rust Programming Language",
     "content": "Ownership is a set of rules that govern how a Rust program manages memory.",
     "engine": "duckduckgo", "score": 3.0, "positions": [1], "category": "general"},
    {"url": "https://rust-lang.github.io/nomicon/ownership.html",
     "title": "Ownership and Lifetimes - The Rustonomicon",
     "content": "Ownership is the thing Rust is most famous for.",
     "engine": "google", "score": 1.5}
  ],
  "answers": [], "suggestions": ["rust borrow checker"], "infoboxes": []
}"#;

#[test]
fn the_tool_is_declared_with_one_argument_and_a_generated_usage_line() {
    let tool = builtin_tools()
        .tools
        .into_iter()
        .find(|t| t.name == WEB_SEARCH)
        .expect("web_search is a built-in");
    assert_eq!(
        tool.usage_args, "{\"query\": \"<query>\"}",
        "generated from the argument name like every other tool (I9)"
    );
    assert!(!tool.agent, "a built-in, not another agent wearing a tool's name");
}

/// The query is percent-encoded into the path the adapter appends to the
/// configured base URL — nothing else in the system builds this string.
#[test]
fn the_query_cannot_escape_the_parameter_it_is_inside() {
    assert_eq!(search_path("rust ownership"), "/search?q=rust%20ownership&format=json");
    // The two that would end the parameter, and one that would start another.
    assert_eq!(search_path("a&format=html"), "/search?q=a%26format%3Dhtml&format=json");
    assert_eq!(search_path(" c++ "), "/search?q=c%2B%2B&format=json", "and it is trimmed");
    // Non-ASCII is bytes, not characters: a UTF-8 query is legal input.
    assert_eq!(search_path("é"), "/search?q=%C3%A9&format=json");
}

#[test]
fn a_real_answer_becomes_five_lines_a_model_can_hold() {
    let read = search_results(REAL).expect("a search answer reads");
    assert_eq!(
        read,
        "1. What Is Ownership? - The Rust Programming Language — \
         https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html\n   \
         Ownership is a set of rules that govern how a Rust program manages memory.\n\
         2. Ownership and Lifetimes - The Rustonomicon — \
         https://rust-lang.github.io/nomicon/ownership.html\n   \
         Ownership is the thing Rust is most famous for."
    );
    assert!(!read.contains("duckduckgo"), "the engine that found it is not the result");
    assert!(!read.contains("suggestions"), "and neither is the rest of the document");
}

/// The bug this cap exists to stop: a 200 KB document arriving in the window.
#[test]
fn a_huge_answer_is_truncated_hard_rather_than_dumped_into_the_window() {
    let row = |i: usize| {
        format!(
            r#"{{"url": "https://example.com/{i}", "title": "{}", "content": "{}"}}"#,
            "T".repeat(4_000),
            "S".repeat(20_000)
        )
    };
    let rows: Vec<String> = (0..40).map(row).collect();
    let huge = format!("{{\"results\": [{}]}}", rows.join(","));
    assert!(huge.len() > 200_000, "the fixture is the size the real thing is");
    let read = search_results(&huge).expect("it still reads");
    assert_eq!(read.lines().count(), 10, "five results, each a line and a snippet");
    assert!(read.len() < 2_000, "and the whole thing fits in a window: {}", read.len());
    assert!(read.contains('…'), "what was cut is marked as cut");
}

/// Three ways an endpoint disappoints, and what each one has to say.
#[test]
fn a_body_that_is_not_a_search_answer_is_never_reported_as_no_results() {
    // The CORS-and-HTML case, which is the common one: a 200 with a page in it.
    let html = search_results("<!doctype html><html><body>results</body></html>")
        .expect_err("HTML is not an answer");
    assert!(html.contains("JSON"), "it names what came back instead: {html}");
    // Valid JSON that is some other API.
    let other = search_results(r#"{"error": "no api key"}"#).expect_err("not a search answer");
    assert!(other.contains("results"), "it names the field it needed: {other}");
    // A search that ran and found nothing is a SUCCESS with nothing in it.
    assert_eq!(
        search_results(r#"{"query": "asdkjhaskjdh", "results": []}"#).unwrap(),
        "The search ran and found nothing."
    );
}

/// Half-filled rows are what a metasearch engine returns when one of its
/// upstreams is terse. A row with a URL is a result; a row without one is not.
#[test]
fn a_result_missing_a_field_keeps_what_it_has_and_one_missing_a_url_is_dropped() {
    let read = search_results(
        r#"{"results": [
             {"url": "https://example.com/a"},
             {"title": "no address here", "content": "…"},
             {"url": "https://example.com/b", "content": "a line, but no headline"}
           ]}"#,
    )
    .unwrap();
    assert_eq!(
        read,
        "1. https://example.com/a — https://example.com/a\n\
         2. https://example.com/b — https://example.com/b\n   a line, but no headline",
        "a titleless row shows its address; a row nobody could open is not a result"
    );
    assert!(!read.contains("no address here"));
}

/// A snippet with newlines in it would print as several numbered results.
#[test]
fn a_snippet_is_one_line_whatever_the_endpoint_sent() {
    let read = search_results(
        "{\"results\": [{\"url\": \"https://e.com\", \"title\": \"a\\nb\", \
         \"content\": \"one\\ntwo\\n\\nthree\"}]}",
    )
    .unwrap();
    assert_eq!(read, "1. a b — https://e.com\n   one two three");
    assert_eq!(read.lines().count(), 2);
}
