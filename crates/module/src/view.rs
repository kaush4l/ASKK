//! View primitives (ARCHITECTURE §1b): centralize the PRIMITIVES, not the
//! templates. Every template — built-in or forged — is composed from these,
//! so the XSS audit surface is this file, and escaping is by construction:
//! there is no public way to put unescaped text into a Fragment.

/// A piece of swap-ready HTML that could only have been built through the
/// escaping builder. The inner string is private — THAT privacy is the
/// security property (I5's rendering half).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fragment {
    html: String,
}

impl Fragment {
    /// Unwrap for the transport/Response body — the one exit, at the seam.
    pub fn into_html(self) -> String {
        todo!("G4")
    }
}

/// Builder for one element and its children. Consuming-`self` chain so a
/// half-built fragment cannot escape; `hx_*` methods exist so htmx attributes
/// are spelled in one audited place, not scattered as string literals.
#[derive(Debug)]
pub struct FragmentBuilder {
    html: String,
}

impl FragmentBuilder {
    /// Start an element ("div", "span", …). Tag names are caller code, not
    /// user data — modules choose tags, users never do.
    pub fn new(tag: &str) -> FragmentBuilder {
        let _ = tag;
        todo!("G4")
    }

    /// Set the element id (escaped; htmx targets address it).
    pub fn id(self, id: &str) -> FragmentBuilder {
        let _ = id;
        todo!("G4")
    }

    /// Add a class attribute (escaped).
    pub fn class(self, class: &str) -> FragmentBuilder {
        let _ = class;
        todo!("G4")
    }

    /// `hx-get` — the fragment will fetch this app route through the seam.
    pub fn hx_get(self, path: &str) -> FragmentBuilder {
        let _ = path;
        todo!("G4")
    }

    /// `hx-post` — form-shaped seam round-trip.
    pub fn hx_post(self, path: &str) -> FragmentBuilder {
        let _ = path;
        todo!("G4")
    }

    /// `hx-trigger` — when the element fires (ADR-002 streaming chains use
    /// `load delay:…` here; the spelling lives in core logic, not JS).
    pub fn hx_trigger(self, spec: &str) -> FragmentBuilder {
        let _ = spec;
        todo!("G4")
    }

    /// `hx-swap` — how the response replaces content.
    pub fn hx_swap(self, spec: &str) -> FragmentBuilder {
        let _ = spec;
        todo!("G4")
    }

    /// `hx-target` — which element receives the swap.
    pub fn hx_target(self, selector: &str) -> FragmentBuilder {
        let _ = selector;
        todo!("G4")
    }

    /// Append text content, HTML-escaped — the ONLY way user/model/module
    /// data enters markup (Spike A's escape lesson, made unavoidable).
    pub fn text(self, s: &str) -> FragmentBuilder {
        let _ = s;
        todo!("G4")
    }

    /// Nest a finished fragment (composition — the dashboard is exactly this).
    pub fn child(self, fragment: Fragment) -> FragmentBuilder {
        let _ = fragment;
        todo!("G4")
    }

    /// Close the element and seal it as a Fragment.
    pub fn build(self) -> Fragment {
        todo!("G4")
    }
}

/// The one full-page shell (title + root element + htmx wiring), for the
/// initial document load; everything after it is fragments. Lives here so
/// `web/index.html` stays the §11 promise: htmx, a root element, nothing else.
pub fn page_shell(title: &str, body: Fragment) -> String {
    let _ = (title, body);
    todo!("G4")
}
