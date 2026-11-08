use crate::api::{engine_paths, kinds, layout, save_layout, Layout};
use crate::components::Pane;
use dioxus::prelude::*;

/// Layout: dashboard columns, engine order, hidden element kinds. Saved to data/layout.json.
#[component]
pub fn LayoutView() -> Element {
    let mut l = use_signal(Layout::default);
    let mut paths = use_signal(Vec::<String>::new);
    let mut all_kinds = use_signal(Vec::<String>::new);
    let mut status = use_signal(String::new);
    use_future(move || async move {
        let saved = layout().await.unwrap_or_default();
        let mut p = engine_paths().await.unwrap_or_default();
        p.sort_by_key(|x| saved.order.iter().position(|o| o == x).unwrap_or(usize::MAX));
        paths.set(p);
        all_kinds.set(kinds().await.unwrap_or_default().into_iter().map(|k| k.kind).collect());
        l.set(saved);
    });
    let mut swap = move |i: usize, j: usize| {
        let mut p = paths.write();
        if j < p.len() {
            p.swap(i, j);
        }
    };
    rsx! {
        Pane { class: "stack",
            h2 { "Layout" }
            div { class: "row",
                span { class: "grow", "Dashboard columns" }
                select { value: "{l().columns}", onchange: move |e| l.write().columns = e.value().parse().unwrap_or(0),
                    for n in 0..5u8 { option { value: "{n}", if n == 0 { "1 per row" } else { "{n}" } } }
                }
            }
            h3 { "Engine order" }
            for (i, p) in paths().into_iter().enumerate() {
                div { class: "row", key: "{p}",
                    span { class: "grow", "{p}" }
                    button { class: "btn", disabled: i == 0, onclick: move |_| swap(i - 1, i), "↑" }
                    button { class: "btn", onclick: move |_| swap(i, i + 1), "↓" }
                }
            }
            h3 { "Shown element kinds" }
            div { class: "chips",
                for k in all_kinds() {
                    label { class: "chip", key: "{k}",
                        input { r#type: "checkbox", checked: !l().hidden.contains(&k),
                            onchange: { let k = k.clone(); move |e: FormEvent| {
                                let mut lw = l.write();
                                lw.hidden.retain(|h| *h != k);
                                if !e.checked() { lw.hidden.push(k.clone()); }
                            } } }
                        " {k}"
                    }
                }
            }
            div { class: "row",
                button { class: "btn primary", onclick: move |_| async move {
                    let mut next = l();
                    next.order = paths();
                    status.set(match save_layout(next).await { Ok(()) => "Saved.".into(), Err(e) => e.to_string() });
                }, "Save" }
                span { class: "dim", "{status}" }
            }
        }
    }
}
