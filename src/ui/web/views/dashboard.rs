use super::canvas_math::parents;
use super::chat::ChatView;
use super::prompt::PromptPanel;
use crate::api::{engine_cards, CardView};
use crate::ui::web::components::{Icon, Pane};
use dioxus::prelude::*;

/// Sub-engines per row on the map.
pub const PER_ROW: usize = 3;

/// What the side panel shows for one engine.
#[derive(Clone, PartialEq)]
enum Panel {
    Prompt(String),
    Chat(String),
}

/// Dashboard: first what is running now, then the engines as a map of big cards — each top
/// engine's card on top, its sub-engines below (three per row). A sub-engine's own engines
/// stay folded behind a count until asked for, or until one of them is at work or has a new
/// message, so Home shows a handful of cards and not every engine there is. Each card shows
/// the live status, current phase and the last step summary (handoff). Click a card's empty
/// area for its prompt, "Chat" for the chat, "Open" for the engine page. Live.
#[component]
pub fn Dashboard() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let m = super::live::use_manifest();
    let cards = super::live::use_live_server(move || m.engines.clone(), engine_cards)?;
    let mut panel = use_signal(|| None::<Panel>);
    let cs = cards.read();
    let Some(cs) = cs.as_ref() else {
        return rsx! { Pane { p { class: "dim", "{ui.t(\"loading\")}" } } };
    };
    let cs = cs.clone();
    let ps: Vec<String> = cs.iter().map(|c| c.path.clone()).collect();
    let (roots, kids) = tree(&ps);
    let open = move |p: Panel| panel.set(Some(p));
    rsx! {
        div { class: "map-app fill",
            if cs.is_empty() { Pane { p { class: "dim", "{ui.t(\"no-engines\")}" } } }
            div { class: "map big",
                super::loops::NowStrip {}
                for r in roots {
                    MapNode { key: "{ps[r]}", cards: cs.clone(), kids: kids.clone(), at: r, depth: 0, on_open: open }
                }
            }
            match panel() {
                Some(Panel::Prompt(p)) => rsx! { PromptPanel { path: p, on_close: move |_| panel.set(None) } },
                Some(Panel::Chat(p)) => rsx! { ChatPanel { key: "{p}", path: p, on_close: move |_| panel.set(None) } },
                None => rsx! {},
            }
        }
    }
}

/// One engine on the map and, below it, its sub-engines in rows of [`PER_ROW`].
#[component]
fn MapNode(cards: Vec<CardView>, kids: Vec<Vec<usize>>, at: usize, depth: usize, on_open: EventHandler<Panel>) -> Element {
    let mut asked = use_signal(|| false);
    let below = inside(&kids, at);
    // Something below needs a look: an engine at work, or one with a new message.
    let lively = below.iter().any(|i| crate::core::engine::working(&cards[*i].status) || cards[*i].new_msgs > 0);
    let folded = depth > 0 && !below.is_empty() && !asked() && !lively;
    let rows = if folded { vec![] } else { grid_rows(&kids[at], PER_ROW) };
    rsx! {
        div { class: "map-node",
            BigCard { card: cards[at].clone(), on_open }
            if depth > 0 && !below.is_empty() && !lively {
                button { class: "chip map-fold", r#type: "button", "aria-expanded": if folded { "false" } else { "true" }, onclick: move |_| asked.toggle(),
                    if folded { "▸ {below.len()} engines inside" } else { "▾ hide {below.len()} engines" }
                }
            }
            if !rows.is_empty() {
                div { class: "map-kids",
                    for (n, row) in rows.into_iter().map(|r| (r.len(), r)).enumerate() {
                        div { key: "{n}", class: "map-row n-{row.0}",
                            for k in row.1 {
                                MapNode { key: "{cards[k].path}", cards: cards.clone(), kids: kids.clone(), at: k, depth: depth + 1, on_open }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// A big engine card: icon + name, status, phase, last step summary, new messages.
#[component]
fn BigCard(card: CardView, on_open: EventHandler<Panel>) -> Element {
    let c = card;
    let (p1, p2, p3) = (c.path.clone(), c.path.clone(), c.path.clone());
    // An icon name (letters, digits, dashes) draws the SVG icon; anything else is an emoji.
    let named = !c.icon.is_empty() && c.icon.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-');
    let status = if c.detail.is_empty() { c.status.clone() } else { format!("{} · {}", c.status, c.detail) };
    rsx! {
        div { class: "big-card glass act-{c.status}", role: "button", tabindex: "0", title: "Show prompt",
            onclick: move |_| on_open.call(Panel::Prompt(p1.clone())),
            div { class: "big-head",
                span { class: "big-icon",
                    if named { Icon { name: c.icon.clone(), size: 22 } }
                    else if c.icon.is_empty() { Icon { name: "engine", size: 22 } }
                    else { "{c.icon}" }
                }
                b { class: "grow big-name", "{c.name}" }
                if c.new_msgs > 0 { span { class: "chip big-new", title: "new messages", "{c.new_msgs} new" } }
            }
            div { class: "big-meta",
                span { class: "big-status", i { class: "orb" } "{status}" }
                if !c.phase.is_empty() { span { class: "chip big-phase", "{c.phase}" } }
            }
            p { class: if c.summary.is_empty() { "big-summary dim" } else { "big-summary" },
                if c.summary.is_empty() { "No step summary yet" } else { "{c.summary}" }
            }
            div { class: "big-actions",
                button { class: "btn", onclick: move |e| { e.stop_propagation(); on_open.call(Panel::Chat(p2.clone())); }, "Chat" }
                Link { class: "btn", to: format!("/e/{p3}"), onclick: move |e: MouseEvent| e.stop_propagation(), "Open" }
            }
        }
    }
}

/// The chat with one engine in the side panel.
#[component]
fn ChatPanel(path: String, on_close: EventHandler<()>) -> Element {
    let p = path.clone();
    use_context_provider(move || crate::core::routes::Params([("path".to_string(), p.clone())].into_iter().collect()));
    rsx! {
        aside { class: "side-panel glass", role: "dialog", "aria-label": "Chat with {path}", tabindex: "-1",
            onkeydown: move |e| { if e.key() == Key::Escape { on_close.call(()); } },
            div { class: "row side-panel-head",
                b { class: "grow mono", "{path}" }
                button { class: "icon-btn", title: "Close", "aria-label": "Close", onclick: move |_| on_close.call(()), Icon { name: "close", size: 18 } }
            }
            div { class: "side-panel-body", ChatView {} }
        }
    }
}

/// The engine tree from paths: the roots and each engine's direct sub-engines (by index).
pub fn tree(paths: &[String]) -> (Vec<usize>, Vec<Vec<usize>>) {
    let up = parents(paths);
    let mut kids = vec![vec![]; paths.len()];
    let mut roots = vec![];
    for (i, p) in up.iter().enumerate() {
        match p {
            Some(a) => kids[*a].push(i),
            None => roots.push(i),
        }
    }
    (roots, kids)
}

/// Every engine below `at`, at any depth (by index).
pub fn inside(kids: &[Vec<usize>], at: usize) -> Vec<usize> {
    let mut out = vec![];
    for k in &kids[at] {
        out.push(*k);
        out.extend(inside(kids, *k));
    }
    out
}

/// Items split into rows of at most `per` (the last row may be shorter).
pub fn grid_rows(items: &[usize], per: usize) -> Vec<Vec<usize>> {
    items.chunks(per.max(1)).map(|c| c.to_vec()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_wrap_at_three() {
        assert_eq!(grid_rows(&[1, 2, 3, 4, 5, 6, 7], 3), vec![vec![1, 2, 3], vec![4, 5, 6], vec![7]]);
        assert!(grid_rows(&[], 3).is_empty());
        assert_eq!(grid_rows(&[1, 2], 0), vec![vec![1], vec![2]]);
    }

    #[test]
    fn tree_groups_sub_engines_under_parents() {
        let ps: Vec<String> = ["a", "a/x", "a/y", "b", "a/x/z"].iter().map(|s| s.to_string()).collect();
        let (roots, kids) = tree(&ps);
        assert_eq!(roots, vec![0, 3]);
        assert_eq!(kids[0], vec![1, 2]);
        assert_eq!(kids[1], vec![4]);
        assert!(kids[3].is_empty());
        assert_eq!(inside(&kids, 0), vec![1, 4, 2], "everything below, at any depth");
        assert!(inside(&kids, 3).is_empty());
    }
}
