//! Artifacts stage (wave-15): gallery of published docs (title, kind badge,
//! age) → full-bleed viewer. html renders in a sandboxed iframe (scripts
//! yes, same-origin NO — an artifact must not reach OPFS/storage); url
//! embeds the page with an always-visible open-↗ escape above it (sites
//! sending X-Frame-Options stay blank); markdown goes through
//! `ui::markdown`. Pure data component — `app.rs` re-reads the docs through
//! the host facade on every refold, so a fresh publish appears live.

use dioxus::prelude::*;

use crate::ui::components::markdown;
use askk_browser::artifacts::ArtifactDoc;

/// Compact age chip ("3h" etc); 0 (unstamped) or a future stamp hides it.
pub fn age_label(now_ms: u64, ts_ms: u64) -> String {
    if ts_ms == 0 || now_ms < ts_ms {
        return String::new();
    }
    let s = (now_ms - ts_ms) / 1000;
    match s {
        0..=59 => "now".into(),
        60..=3599 => format!("{}m", s / 60),
        3600..=86_399 => format!("{}h", s / 3600),
        _ => format!("{}d", s / 86_400),
    }
}

#[component]
pub fn ArtifactsStage(docs: Vec<ArtifactDoc>, now_ms: u64) -> Element {
    let mut open = use_signal(|| Option::<String>::None);
    // A vanished slug (blob removed) falls back to the gallery gracefully.
    let selected = open().and_then(|slug| docs.iter().find(|d| d.slug == slug).cloned());
    match selected {
        Some(doc) => rsx! {
            Viewer { doc, on_back: move |_| open.set(None) }
        },
        None => rsx! {
            div { class: "art-wrap",
                div { class: "settings-title", "Artifacts" }
                if docs.is_empty() {
                    p { class: "hint",
                        "agents publish big work here — try: \"write a webpage about X and publish it\" in Chat."
                    }
                }
                div { class: "art-grid",
                    for doc in docs.iter() {
                        button {
                            key: "{doc.slug}",
                            class: "art-card",
                            onclick: {
                                let slug = doc.slug.clone();
                                move |_| open.set(Some(slug.clone()))
                            },
                            div { class: "art-title", "{doc.title}" }
                            div { class: "art-meta",
                                span { class: "meta-tag", "{doc.kind}" }
                                span { class: "art-age", {age_label(now_ms, doc.ts_ms)} }
                            }
                        }
                    }
                }
            }
        },
    }
}

#[component]
fn Viewer(doc: ArtifactDoc, on_back: EventHandler<()>) -> Element {
    rsx! {
        div { class: "art-viewer",
            div { class: "art-head",
                button { class: "art-back", onclick: move |_| on_back.call(()), "← gallery" }
                span { class: "art-head-title", "{doc.title}" }
                span { class: "meta-tag", "{doc.kind}" }
                if doc.kind == "url" {
                    a {
                        class: "art-open",
                        href: "{doc.body}",
                        target: "_blank",
                        rel: "noopener",
                        "open ↗"
                    }
                }
            }
            if doc.kind == "url" {
                p { class: "hint art-hint",
                    "embedded below — sites that refuse embedding stay blank; use open ↗"
                }
            }
            match doc.kind.as_str() {
                "html" => rsx! {
                    iframe {
                        class: "art-frame",
                        "sandbox": "allow-scripts",
                        srcdoc: "{doc.body}",
                        title: "{doc.title}",
                    }
                },
                // ponytail: no sandbox on url embeds — it breaks the native
                // PDF viewer; the open-↗ row above is the escape hatch.
                "url" => rsx! {
                    iframe { class: "art-frame", src: "{doc.body}", title: "{doc.title}" }
                },
                _ => rsx! {
                    div { class: "art-doc", {markdown::render(&doc.body)} }
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn age_label_buckets_and_hides() {
        let now = 10 * 86_400_000;
        assert_eq!(age_label(now, 0), ""); // unstamped
        assert_eq!(age_label(now, now + 5), ""); // future stamp
        assert_eq!(age_label(now, now - 30_000), "now");
        assert_eq!(age_label(now, now - 5 * 60_000), "5m");
        assert_eq!(age_label(now, now - 3 * 3_600_000), "3h");
        assert_eq!(age_label(now, now - 2 * 86_400_000), "2d");
    }
}
