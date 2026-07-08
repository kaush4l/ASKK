//! Settings drawer: the one provider profile (BYOK). Mounted fresh on each
//! open, so the fields initialize from the current profile; Save hands the
//! whole form back to the facade.

use dioxus::prelude::*;

use crate::host::boot::ProviderProfileForm;

#[component]
pub fn SettingsDrawer(
    profile: ProviderProfileForm,
    on_save: EventHandler<ProviderProfileForm>,
    on_close: EventHandler<()>,
) -> Element {
    let mut base_url = use_signal(|| profile.base_url.clone());
    let mut model = use_signal(|| profile.model.clone());
    let mut api_key = use_signal(|| profile.api_key.clone());
    let mut temperature = use_signal(|| {
        profile
            .temperature
            .map(|t| t.to_string())
            .unwrap_or_default()
    });

    rsx! {
        aside { class: "drawer",
            div { class: "drawer-head",
                h2 { "Provider" }
                button { class: "ghost", onclick: move |_| on_close.call(()), "Close" }
            }
            label { class: "field",
                span { "Base URL" }
                input {
                    value: "{base_url}",
                    placeholder: "http://localhost:1234/v1",
                    oninput: move |e| base_url.set(e.value()),
                }
            }
            label { class: "field",
                span { "Model" }
                input {
                    value: "{model}",
                    placeholder: "gpt-4o-mini",
                    oninput: move |e| model.set(e.value()),
                }
            }
            label { class: "field",
                span { "API key" }
                input {
                    r#type: "password",
                    value: "{api_key}",
                    oninput: move |e| api_key.set(e.value()),
                }
            }
            label { class: "field",
                span { "Temperature (blank = provider default)" }
                input {
                    value: "{temperature}",
                    placeholder: "0.7",
                    oninput: move |e| temperature.set(e.value()),
                }
            }
            p { class: "muted note",
                "Bring your own key: it stays in this browser's private storage (OPFS) and is sent only to the base URL above."
            }
            button {
                class: "primary",
                onclick: move |_| {
                    on_save.call(ProviderProfileForm {
                        base_url: base_url().trim().to_string(),
                        model: model().trim().to_string(),
                        api_key: api_key().trim().to_string(),
                        temperature: temperature().trim().parse::<f32>().ok(),
                    });
                },
                "Save"
            }
        }
    }
}
