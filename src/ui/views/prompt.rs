use crate::api::{engine_budget, engine_prompt};
use crate::ui::components::{Icon, Pane};
use dioxus::prelude::*;

/// The prompt an engine would send now (for `input`): one colour per section kind, a token bar
/// scaled to the input budget, and the exact render sequence (or the whole text). Live.
#[component]
pub fn PromptView(path: ReadSignal<String>, input: ReadSignal<String>, #[props(default)] class: String) -> Element {
    let mut full = use_signal(|| false);
    let budget = use_resource(move || async move { engine_budget(path()).await });
    let m = super::live::use_manifest();
    let live = super::live::use_live(move || m.engine(&path()));
    let prompt = use_resource(move || {
        let _ = live();
        engine_prompt(path(), input())
    });
    let sections = prompt.read().as_ref().and_then(|r| r.as_ref().ok()).cloned().unwrap_or_default();
    let total: usize = sections.iter().map(|s| crate::core::tokens(&s.body)).sum();
    // The bar is scaled to the input budget (context − reply cap); unknown budget = the prompt itself.
    let cap = budget.read().as_ref().and_then(|r| r.as_ref().ok()).copied().unwrap_or(0);
    let scale = if cap > 0 { cap.max(total) } else { total.max(1) };
    let pct = |n: usize| n as f64 * 100.0 / scale as f64;
    let used = if cap > 0 { format!("~{} of {} tokens ({:.1}%) · refocus at 90%", kilo(total), kilo(cap), total as f64 * 100.0 / cap as f64) } else { format!("~{} tokens · budget unknown", kilo(total)) };
    rsx! {
        Pane { class: "prompt {class}",
            div { class: "row",
                h2 { class: "grow", "Prompt" }
                span { class: "dim", "{sections.len()} sections · {used}" }
                button { class: "btn", onclick: move |_| full.toggle(), if full() { "Sections" } else { "Full text" } }
            }
            div { class: "bar budget",
                for s in sections.iter() {
                    span { class: "k-{s.kind} k-{s.name}", style: "width:{pct(crate::core::tokens(&s.body))}%", title: "{s.name} · {kilo(crate::core::tokens(&s.body))}" }
                }
                if cap > 0 { i { class: "refocus-mark", style: "left:{pct(cap * 9 / 10)}%", title: "refocus at 90%" } }
            }
            div { class: "legend",
                for s in sections.iter() {
                    span { class: "chip k-{s.kind} k-{s.name}", "{s.name} · {crate::core::tokens(&s.body)}" }
                }
            }
            if full() {
                pre { class: "rendered",
                    for s in sections.iter() {
                        span { class: "k-{s.kind} k-{s.name}", "## {s.name}\n{s.body}\n\n" }
                    }
                }
            } else {
                // The exact render sequence: the order the model reads, each chunk as sent
                // (`## name` + body), with its tokens, share and where it starts.
                ol { class: "sequence",
                    for (i, s) in sections.iter().enumerate() {
                        {
                            let t = crate::core::tokens(&s.body);
                            let at: usize = sections[..i].iter().map(|x| crate::core::tokens(&x.body)).sum();
                            let share = if total > 0 { t as f64 * 100.0 / total as f64 } else { 0.0 };
                            rsx! {
                                li { class: "seq k-{s.kind} k-{s.name}",
                                    details { open: true,
                                        summary { class: "seq-head",
                                            span { class: "seq-n", "{i + 1}" }
                                            b { "{s.name}" }
                                            span { class: "dim", "{s.kind}" }
                                            span { class: "seq-tok", "{kilo(t)} · {share:.0}% · @{kilo(at)}" }
                                        }
                                        pre { class: "seq-body", "## {s.name}\n{s.body}" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// A side panel over the view with one engine's prompt; closes on the button or Escape.
#[component]
pub fn PromptPanel(path: String, on_close: EventHandler<()>) -> Element {
    rsx! {
        aside { class: "side-panel glass", role: "dialog", "aria-label": "Prompt of {path}", tabindex: "-1",
            onkeydown: move |e| { if e.key() == Key::Escape { on_close.call(()); } },
            div { class: "row side-panel-head",
                b { class: "grow mono", "{path}" }
                Link { class: "link", to: format!("/e/{path}"), "Open engine" }
                button { class: "icon-btn", title: "Close", "aria-label": "Close", onclick: move |_| on_close.call(()), Icon { name: "close", size: 18 } }
            }
            PromptView { key: "{path}", path: path.clone(), input: String::new(), class: "side-panel-body" }
        }
    }
}

/// Is a click on this element (its `class` attribute) a click on an engine card's empty area,
/// not on one of its elements? The card itself, its body and its meta are empty area.
pub fn empty_hit(class: &str) -> bool {
    let has = |c: &str| class.split_whitespace().any(|x| x == c);
    has("obj-body") || has("engine-card") || has("canvas-frame") || has("map-card") || (has("obj") && has("size-medium"))
}

/// The class of the element under a click (client coordinates), read in the browser.
pub async fn class_at(x: f64, y: f64) -> String {
    let js = format!("const el = document.elementFromPoint({x}, {y}); return el ? String(el.getAttribute('class') || '') : '';");
    document::eval(&js).await.ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

/// Token counts the short way: 950, 2.9k, 262k, 2.1M.
pub fn kilo(n: usize) -> String {
    let f = n as f64;
    match n {
        0..=999 => n.to_string(),
        1_000..=9_999 => format!("{:.1}k", f / 1e3).replace(".0k", "k"),
        10_000..=999_999 => format!("{:.0}k", f / 1e3),
        _ => format!("{:.1}M", f / 1e6).replace(".0M", "M"),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn token_counts_read_in_k() {
        let k = super::kilo;
        assert_eq!([k(950), k(2000), k(2901), k(262_144), k(2_065_152), k(1_000_000)], ["950", "2k", "2.9k", "262k", "2.1M", "1M"]);
    }

    #[test]
    fn only_empty_card_area_opens_the_prompt() {
        let e = super::empty_hit;
        assert!(e("obj-body"));
        assert!(e("obj size-medium act-idle"));
        assert!(e("canvas-frame"));
        assert!(!e("obj size-small"));
        assert!(!e("btn"));
        assert!(!e("tile"));
        assert!(!e(""));
    }
}
