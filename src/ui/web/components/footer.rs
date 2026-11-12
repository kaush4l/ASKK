use crate::api::UiConfig;
use dioxus::prelude::*;

/// Site footer from the `contact` entry of `ui.json`. Renders nothing while no field has a value.
#[component]
pub fn Footer() -> Element {
    let items = use_context::<UiConfig>().contact_items();
    if items.is_empty() {
        return rsx! {};
    }
    rsx! {
        footer { class: "site-footer",
            for (k, v) in items {
                span { key: "{k}", class: "site-footer-item",
                    span { class: "site-footer-key", "{k}" }
                    span { class: "site-footer-val", "{v}" }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::api::UiConfig;

    #[test]
    fn footer_items_drop_empty_and_blank_values() {
        let mut cfg = UiConfig::default();
        assert!(cfg.contact_items().is_empty());
        for (k, v) in [("a", "x"), ("b", ""), ("c", "   "), ("d", " y ")] {
            cfg.contact.insert(k.into(), v.into());
        }
        assert_eq!(cfg.contact_items(), vec![("a".to_string(), "x".to_string()), ("d".to_string(), "y".to_string())]);
    }

    #[test]
    fn footer_defaults_ship_no_contact_details() {
        let cfg: UiConfig = serde_json::from_str(include_str!("../../../../defaults/ui.json")).unwrap();
        assert!(cfg.contact.values().all(|v| v.trim().is_empty()));
        assert!(cfg.contact_items().is_empty());
    }

    #[test]
    fn footer_is_in_the_shared_layout() {
        let shell = include_str!("../views/shell.rs");
        assert!(shell.contains("Footer {}"));
        assert!(shell.find("div { class: \"page\"").unwrap() < shell.find("Footer {}").unwrap());
    }
}
