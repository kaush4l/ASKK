//! View primitives (ARCHITECTURE §1b): centralize the PRIMITIVES, not the
//! templates. Every template — built-in or forged — is composed from these,
//! so the XSS audit surface is this file, and escaping is by construction:
//! there is no public way to put unescaped text into a Fragment.

/// HTML-escape text for element content and attribute values. The one
/// escaping function; everything routes through it.
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

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
        self.html
    }
}

/// Builder for one element and its children. Consuming-`self` chain so a
/// half-built fragment cannot escape; `hx_*` methods exist so htmx attributes
/// are spelled in one audited place, not scattered as string literals.
#[derive(Debug)]
pub struct FragmentBuilder {
    tag: String,
    attrs: String,
    children: String,
}

impl FragmentBuilder {
    /// Start an element ("div", "span", …). Tag names are caller code, not
    /// user data — modules choose tags, users never do.
    pub fn new(tag: &str) -> FragmentBuilder {
        FragmentBuilder {
            tag: tag.to_string(),
            attrs: String::new(),
            children: String::new(),
        }
    }

    /// Set any attribute (value escaped). PROVISIONAL addition (G4): the
    /// frozen surface had only id/class/hx_*, which cannot express a form
    /// input's `name`/`type`/`placeholder` — the chat box needed this.
    /// Attribute NAMES are caller code, like tags; values are user data.
    pub fn attr(mut self, name: &str, value: &str) -> FragmentBuilder {
        self.attrs
            .push_str(&format!(" {name}=\"{}\"", escape(value)));
        self
    }

    /// Set the element id (escaped; htmx targets address it).
    pub fn id(self, id: &str) -> FragmentBuilder {
        self.attr("id", id)
    }

    /// Add a class attribute (escaped).
    pub fn class(self, class: &str) -> FragmentBuilder {
        self.attr("class", class)
    }

    /// `hx-get` — the fragment will fetch this app route through the seam.
    pub fn hx_get(self, path: &str) -> FragmentBuilder {
        self.attr("hx-get", path)
    }

    /// `hx-post` — form-shaped seam round-trip.
    pub fn hx_post(self, path: &str) -> FragmentBuilder {
        self.attr("hx-post", path)
    }

    /// `hx-trigger` — when the element fires (ADR-002 streaming chains use
    /// `load delay:…` here; the spelling lives in core logic, not JS).
    pub fn hx_trigger(self, spec: &str) -> FragmentBuilder {
        self.attr("hx-trigger", spec)
    }

    /// `hx-swap` — how the response replaces content.
    pub fn hx_swap(self, spec: &str) -> FragmentBuilder {
        self.attr("hx-swap", spec)
    }

    /// `hx-target` — which element receives the swap.
    pub fn hx_target(self, selector: &str) -> FragmentBuilder {
        self.attr("hx-target", selector)
    }

    /// Append text content, HTML-escaped — the ONLY way user/model/module
    /// data enters markup (Spike A's escape lesson, made unavoidable).
    pub fn text(mut self, s: &str) -> FragmentBuilder {
        self.children.push_str(&escape(s));
        self
    }

    /// Nest a finished fragment (composition — the dashboard is exactly this).
    pub fn child(mut self, fragment: Fragment) -> FragmentBuilder {
        self.children.push_str(&fragment.html);
        self
    }

    /// Close the element and seal it as a Fragment.
    pub fn build(self) -> Fragment {
        Fragment {
            html: format!(
                "<{}{}>{}</{}>",
                self.tag, self.attrs, self.children, self.tag
            ),
        }
    }
}

/// The one full-page shell (title + root element + htmx wiring), for the
/// initial document load; everything after it is fragments. G4 note: unused —
/// `web/index.html` is the static installable shell and pulls the dashboard
/// as a fragment through the seam; this becomes live if the shell ever
/// renders core-side (kept todo rather than pretending).
pub fn page_shell(title: &str, body: Fragment) -> String {
    let _ = (title, body);
    todo!("G5: core-rendered shell")
}
