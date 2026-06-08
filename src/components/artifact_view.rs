//! Visual rendering of [`RunArtifact`]s — the surface the agent uses to *show* the
//! user something (an image it generated, an HTML preview, a JSON blob, plain text)
//! rather than only describing it in prose.
//!
//! Security note (invariant 3): artifact `content` is **untrusted data**, never
//! instructions. HTML artifacts are rendered inside a `sandboxed` `<iframe srcdoc>`
//! with *no* `allow-scripts` / `allow-same-origin`, so the content cannot run script,
//! reach the app's DOM/storage, or touch the parent origin. It is inert, isolated
//! markup. Other types are placed in inert elements (`<img>`, `<pre>`) that do not
//! execute their content.

use crate::state::{ArtifactKind, RunArtifact};
use dioxus::prelude::*;

/// Render a list of [`RunArtifact`]s as a captioned gallery. Renders nothing when
/// the list is empty, so callers can drop it inline unconditionally.
#[component]
pub fn ArtifactGallery(artifacts: Vec<RunArtifact>, heading: String) -> Element {
    if artifacts.is_empty() {
        return rsx! {};
    }
    rsx! {
        section { class: "artifact-gallery",
            div { class: "artifact-gallery-head",
                h3 { "{heading}" }
                span { class: "event-count", "{artifacts.len()}" }
            }
            div { class: "artifact-list",
                for artifact in artifacts.iter() {
                    ArtifactCard { key: "{artifact.id}", artifact: artifact.clone() }
                }
            }
        }
    }
}

/// Render a single [`RunArtifact`] as a captioned card, dispatching on
/// `artifact_type`. Always shows the artifact `name` as a caption. Malformed or
/// empty content degrades to an error/empty caption rather than panicking.
#[component]
pub fn ArtifactCard(artifact: RunArtifact) -> Element {
    let kind = artifact.artifact_type;
    let kind_label = kind.as_str();
    rsx! {
        figure { class: "artifact-card",
            div { class: "artifact-body",
                {render_body(kind, &artifact.content)}
            }
            figcaption { class: "artifact-caption",
                span { class: "artifact-name", "{artifact.name}" }
                span { class: "artifact-type", "{kind_label}" }
            }
        }
    }
}

/// Dispatch the artifact body by [`ArtifactKind`]. The match is exhaustive so a new
/// kind forces a rendering decision here; `Text` is the inert plain-text fallback.
fn render_body(kind: ArtifactKind, content: &str) -> Element {
    match kind {
        ArtifactKind::Image => render_image(content),
        ArtifactKind::Html => render_html(content),
        ArtifactKind::Json => render_json(content),
        ArtifactKind::Text => render_text(content),
    }
}

/// Render an image artifact. Accepts either an already-`data:`-prefixed URL or bare
/// base64 (in which case we wrap it as `image/png` by default — the common case for
/// model-generated PNGs). Empty content shows an error caption rather than a broken
/// image. The `content` is only ever used as an `<img src>`, which the browser
/// treats as image data, never as executable markup.
fn render_image(content: &str) -> Element {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return render_error("Image artifact has no content.");
    }
    let src = if trimmed.starts_with("data:") {
        trimmed.to_string()
    } else {
        // Bare base64 payload — default to PNG, the typical model image output.
        format!("data:image/png;base64,{trimmed}")
    };
    rsx! {
        img { class: "artifact-image", src: "{src}", alt: "rendered image artifact" }
    }
}

/// Render an HTML artifact inside a fully sandboxed `<iframe srcdoc>`. The sandbox
/// has no token list at all, so scripts, forms, popups, same-origin access and
/// top-navigation are *all* denied: the markup renders but is completely inert and
/// isolated from the app. This is the safe choice for untrusted HTML (invariant 3).
fn render_html(content: &str) -> Element {
    if content.trim().is_empty() {
        return render_error("HTML artifact has no content.");
    }
    rsx! {
        iframe {
            class: "artifact-frame",
            // Empty sandbox token list: scripts, forms, popups, same-origin access
            // and top-navigation are all denied. `sandbox` is not a typed dioxus
            // iframe attribute, so it is passed through as a raw HTML attribute.
            "sandbox": "",
            srcdoc: "{content}",
            title: "rendered html artifact",
        }
    }
}

/// Render a JSON artifact pretty-printed inside an inert `<pre>`. If the content is
/// not valid JSON we show it verbatim rather than failing — the user still sees the
/// payload, just unformatted.
fn render_json(content: &str) -> Element {
    let pretty = serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|value| serde_json::to_string_pretty(&value).ok())
        .unwrap_or_else(|| content.to_string());
    rsx! {
        pre { class: "artifact-text", "{pretty}" }
    }
}

/// Render plain text (or any unknown type) inside an inert `<pre>`.
fn render_text(content: &str) -> Element {
    rsx! {
        pre { class: "artifact-text", "{content}" }
    }
}

/// A small inline error caption for artifacts that cannot be rendered.
fn render_error(message: &str) -> Element {
    rsx! {
        p { class: "artifact-error", "{message}" }
    }
}
