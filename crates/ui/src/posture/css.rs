//! THE READER the posture tests measure with: the sheets the page links, and a
//! CSS parser small enough to be obviously right.
//!
//! Split out of `posture/mod.rs` in ROADMAP #7 because that file sat at exactly
//! the 200-line ceiling (I12) and `web/flow.css` is an eleventh sheet. The
//! split is the shape `docs/DESIGN-SYSTEM.md §9` named in advance: the reader
//! here, the claims next door. Nothing in it changed in the move.

/// Every stylesheet the page links, in `web/index.html` order. TWELVE since
/// the editorial round added `editorial.css`; a sheet missing from this list
/// is a sheet the posture tests cannot see, which is how an ungated hover
/// would ship green.
pub(super) const SHEETS: [(&str, &str); 12] = [
    ("tokens.css", include_str!("../../../../web/tokens.css")),
    ("base.css", include_str!("../../../../web/base.css")),
    ("glass.css", include_str!("../../../../web/glass.css")),
    ("layout.css", include_str!("../../../../web/layout.css")),
    ("chrome.css", include_str!("../../../../web/chrome.css")),
    ("strip.css", include_str!("../../../../web/strip.css")),
    ("surfaces.css", include_str!("../../../../web/surfaces.css")),
    ("controls.css", include_str!("../../../../web/controls.css")),
    ("workspace.css", include_str!("../../../../web/workspace.css")),
    ("mission.css", include_str!("../../../../web/mission.css")),
    ("flow.css", include_str!("../../../../web/flow.css")),
    ("editorial.css", include_str!("../../../../web/editorial.css")),
];

/// The sheet named, so a test that is ABOUT one file says which by name rather
/// than by an index that moves the next time a sheet is added.
pub(super) fn sheet(name: &str) -> &'static str {
    SHEETS.iter().find(|(n, _)| *n == name).expect("a sheet this tree links").1
}

/// A comment can hold a selector; three in this tree do, one falsely.
pub(super) fn uncommented(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(i) = rest.find("/*") {
        out.push_str(&rest[..i]);
        rest = match rest[i + 2..].find("*/") {
            Some(j) => &rest[i + 2 + j + 2..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// Every block as (enclosing preludes, own declarations). For a rule inside
/// `@media X { .a:hover { … } }` the stack is `["@media X", ".a:hover"]`, which
/// is the whole question this module asks. THE DECLARATIONS ARE HALF OF IT: the
/// first draft returned preludes only, so the reduced-motion test looked for
/// `animation:` in a SELECTOR and passed over an empty loop — caught by its
/// positive control (T59).
pub(super) fn blocks(css: &str) -> Vec<(Vec<String>, String)> {
    let (mut stack, mut buf) = (Vec::new(), String::new());
    let (mut out, mut open) = (Vec::<(Vec<String>, String)>::new(), Vec::new());
    let flat = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    for c in uncommented(css).chars() {
        match c {
            '{' => {
                stack.push(flat(&buf));
                open.push(out.len());
                out.push((stack.clone(), String::new()));
                buf.clear();
            }
            '}' => {
                if let Some(i) = open.pop() {
                    out[i].1 = flat(&buf);
                }
                stack.pop();
                buf.clear();
            }
            _ => buf.push(c),
        }
    }
    out
}

/// A `:hover` beside its own hover-less twin in one selector list paints the
/// resting fill, so it does nothing under a finger. One in the tree.
pub(super) fn is_no_op_hover(sel: &str) -> bool {
    sel.split(',').any(|one| {
        let one = one.trim();
        one.ends_with(":hover") && sel.split(',').any(|t| t.trim() == &one[..one.len() - 6])
    })
}
