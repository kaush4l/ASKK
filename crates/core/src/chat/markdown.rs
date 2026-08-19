//! The SMALL markdown subset a reply is allowed to carry (R4-11).
//!
//! Every reply printed its own backticks: `MAIN: I have created a file named
//! \`fruit.md\` in the workspace`. For a product whose agent names a file or a
//! command in almost every sentence that was the most-repeated visible defect
//! on the page.
//!
//! THREE CONSTRUCTS, and the line is drawn on purpose:
//!
//! - a fenced block (```) becomes `<pre><code>`;
//! - an inline span (`code`) becomes `<code>`;
//! - a blank line ends a paragraph; a single newline stays a line break, which
//!   it already was, because `.msg` is `white-space: pre-wrap`.
//!
//! Nothing else. Emphasis, headings, lists, tables and links are where a
//! hand-written parser starts guessing — `*` is a glob and a bullet, `#` is a
//! comment and a heading, and a link is a URL this page would then be inviting
//! somebody to click on model output. The three above are unambiguous, they
//! are what the agent actually emits, and they are the whole of the defect.
//!
//! It is built from `FragmentBuilder` like every other projection, so the text
//! is escaped by construction and there is no raw-HTML path to abuse (I5).

use module::view::{Fragment, FragmentBuilder};

/// What opens and closes a code block. Any line whose first non-space run is
/// this is a fence, info string and all — the info string is dropped, because
/// this build has no highlighter to give it to.
const FENCE: &str = "```";

/// One message's text, as the `.said` span the transcript has always emitted.
///
/// `files` is what the workspace currently holds (`files::rows::names`). An inline
/// span naming one of them becomes a BUTTON rather than a `<code>` (R9-4): the
/// agent said "The file `primes.txt` has 15 lines", the name was inert, and
/// checking the claim meant typing `cat` into the Workspace's command box —
/// which is the direct reason nobody noticed the count was wrong. Empty for
/// every notice this page writes about itself, which names no files.
pub(crate) fn said(text: &str, files: &[String]) -> Fragment {
    blocks(text, files)
        .into_iter()
        .fold(FragmentBuilder::new("span").class("said"), |span, block| {
            span.child(block)
        })
        .build()
}

/// Split the text into paragraphs and fenced blocks, in order.
fn blocks(text: &str, files: &[String]) -> Vec<Fragment> {
    let (mut out, mut prose, mut code) = (Vec::new(), Vec::new(), Vec::new());
    let mut fenced = false;
    for line in text.lines() {
        if line.trim_start().starts_with(FENCE) {
            match fenced {
                true => out.push(code_block(&code.join("\n"))),
                false => flush(&mut prose, &mut out, files),
            }
            code.clear();
            fenced = !fenced;
        } else if fenced {
            code.push(line);
        } else if line.trim().is_empty() {
            flush(&mut prose, &mut out, files);
        } else {
            prose.push(line);
        }
    }
    // An UNTERMINATED fence is the common case mid-stream, and dropping what it
    // held would delete the answer. It closes at the end of the text.
    if fenced {
        out.push(code_block(&code.join("\n")));
    }
    flush(&mut prose, &mut out, files);
    out
}

/// Emit the paragraph built so far, if there is one.
fn flush(prose: &mut Vec<&str>, out: &mut Vec<Fragment>, files: &[String]) {
    if !prose.is_empty() {
        out.push(paragraph(&prose.join("\n"), files));
        prose.clear();
    }
}

/// One inline span: a `<code>`, or the control that OPENS it when it names a
/// file this workspace actually has (R9-4).
///
/// The guard is the listing, not a guess at what looks like a filename. A
/// button that opens nothing is worse than the inert name it replaced, and
/// "does the workspace hold this" is a fact the same log already answers.
fn inline(part: &str, files: &[String]) -> Fragment {
    let found = files
        .iter()
        .find(|path| path.as_str() == part || path.rsplit('/').next() == Some(part));
    match found {
        Some(path) => FragmentBuilder::new("button")
            .attr("type", "button")
            .class("file-ref")
            .attr("data-path", path)
            .attr("title", &format!("Open {path} in Files"))
            .text(part)
            .build(),
        None => FragmentBuilder::new("code").text(part).build(),
    }
}

fn code_block(text: &str) -> Fragment {
    FragmentBuilder::new("pre")
        .class("say-code")
        .child(FragmentBuilder::new("code").text(text).build())
        .build()
}

/// One paragraph, with its inline code spans.
///
/// An ODD number of backticks is not markup — it is a stray character in prose
/// ("the price is 5` an inch"), and pairing it with the end of the paragraph
/// would silently swallow the rest of the sentence into a code span. Odd count,
/// no parsing: the text is shown exactly as it was written.
fn paragraph(text: &str, files: &[String]) -> Fragment {
    let mut p = FragmentBuilder::new("p").class("say");
    if !text.matches('`').count().is_multiple_of(2) {
        return p.text(text).build();
    }
    for (i, part) in text.split('`').enumerate() {
        p = match (i.is_multiple_of(2), part.is_empty()) {
            (true, _) => p.text(part),
            (false, true) => p, // `` — an empty span is nothing at all
            (false, false) => p.child(inline(part, files)),
        };
    }
    p.build()
}

#[cfg(test)]
mod tests {
    use super::said;

    fn html(text: &str) -> String {
        said(text, &[]).into_html()
    }

    /// R9-4. A name the workspace HAS is a control; one it does not is prose.
    #[test]
    fn a_file_the_workspace_holds_is_openable_from_the_sentence() {
        let files = vec!["primes.txt".to_string()];
        let out = said("The file `primes.txt` has 15 lines.", &files).into_html();
        assert!(out.contains(r#"<button type="button" class="file-ref" data-path="primes.txt""#), "{out}");
        let miss = said("I looked in `nowhere.txt`.", &files).into_html();
        assert!(miss.contains("<code>nowhere.txt</code>"), "{miss}");
    }

    #[test]
    fn inline_code_stops_printing_its_own_backticks() {
        let out = html("I created `fruit.md` in the workspace.");
        assert!(out.contains("<code>fruit.md</code>"), "{out}");
        assert!(!out.contains('`'), "{out}");
    }

    #[test]
    fn a_fence_becomes_a_code_block() {
        let out = html("run this:\n```sh\nls -la\n```\ndone");
        let block = "<pre class=\"say-code\"><code>ls -la</code></pre>";
        assert!(out.contains(block), "{out}");
        assert!(out.contains("<p class=\"say\">run this:</p>"), "{out}");
        assert!(out.contains("<p class=\"say\">done</p>"), "{out}");
    }

    #[test]
    fn a_blank_line_ends_a_paragraph() {
        let out = html("one\n\ntwo");
        assert_eq!(
            out,
            "<span class=\"said\"><p class=\"say\">one</p><p class=\"say\">two</p></span>"
        );
    }

    #[test]
    fn an_odd_backtick_is_prose_not_markup() {
        let out = html("the price is 5` an inch and that is that");
        assert!(out.contains("5` an inch and that is that"), "{out}");
        assert!(!out.contains("<code>"), "{out}");
    }

    #[test]
    fn an_unterminated_fence_keeps_its_content() {
        let out = html("here:\n```\nhalf a block");
        assert!(out.contains("<code>half a block</code>"), "{out}");
    }

    #[test]
    fn model_text_is_still_escaped() {
        let out = html("<script>alert(1)</script> and `<b>x</b>`");
        assert!(!out.contains("<script>"), "{out}");
        assert!(out.contains("&lt;b&gt;x&lt;/b&gt;"), "{out}");
    }
}
