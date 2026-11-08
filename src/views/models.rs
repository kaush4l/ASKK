use crate::components::Pane;
use crate::infer::{self, Model, Models};
use dioxus::prelude::*;

/// Models view: list, add (by name or discovered), set default, delete, save to models.json, test.
#[component]
pub fn ModelsView() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let mut models = use_signal(Models::default);
    let mut status = use_signal(String::new);
    let mut connector = use_signal(String::new);
    let mut runtimes = use_signal(Vec::<String>::new);
    use_future(move || async move {
        let r = infer::connectors().await.unwrap_or_default();
        if connector.read().is_empty() { connector.set(r.first().cloned().unwrap_or_default()); }
        runtimes.set(r);
    });
    let mut base_url = use_signal(String::new);
    let mut command = use_signal(String::new);
    let mut key_env = use_signal(String::new);
    let mut name = use_signal(String::new);
    let mut found = use_signal(Vec::<String>::new);
    let mut prompt = use_signal(String::new);
    let mut test_model = use_signal(String::new);
    let mut reply = use_signal(String::new);

    use_future(move || async move {
        match infer::list_models().await {
            Ok(m) => models.set(m),
            Err(e) => status.set(format!("load failed: {e}")),
        }
    });

    let mut add = move |n: String| {
        if n.is_empty() || models.read().models.iter().any(|m| m.name == n) {
            return;
        }
        let m = Model { name: n, connector: connector(), base_url: base_url(), key_env: key_env(), command: command().split_whitespace().map(String::from).collect() };
        let mut all = models.write();
        if all.default.is_empty() {
            all.default = m.name.clone();
        }
        all.models.push(m);
    };

    rsx! {
        Pane { class: "stack",
            h2 { {ui.t("models")} }
            p { class: "dim", {ui.t("saved-in-data-models")} }
            if models.read().models.is_empty() { p { class: "dim", "{ui.t(\"no-models\")}" } }
            for m in models.read().models.clone() {
                div { class: "row", key: "{m.name}",
                    input { r#type: "radio", name: "default", checked: models.read().default == m.name,
                        onchange: { let n = m.name.clone(); move |_| models.write().default = n.clone() } }
                    strong { "{m.name}" }
                    span { class: "dim", "{m.connector} {m.base_url} {m.command.join(\" \")}" }
                    if !m.key_env.is_empty() { span { class: "dim", "key: ${m.key_env}" } }
                    button { class: "btn", onclick: { let n = m.name.clone(); move |_| {
                        let mut all = models.write();
                        all.models.retain(|x| x.name != n);
                        if all.default == n { all.default = all.models.first().map(|x| x.name.clone()).unwrap_or_default(); }
                    } }, {ui.t("remove")} }
                }
            }
            div { class: "row",
                button { class: "btn primary", onclick: move |_| async move {
                    status.set(match infer::save_models(models()).await { Ok(()) => consume_context::<crate::api::UiConfig>().t("saved"), Err(e) => format!("save failed: {e}") });
                }, {ui.t("save")} }
                span { class: "dim", "{status}" }
            }
        }
        Pane { class: "stack",
            h3 { {ui.t("add-a-model")} }
            div { class: "row",
                select { value: "{connector}", onchange: move |e| connector.set(e.value()),
                    for c in runtimes() { option { value: "{c}", "{c}" } }
                }
                input { placeholder: "base url", value: "{base_url}", oninput: move |e| base_url.set(e.value()) }
                if connector() == "cli" { input { placeholder: "command, e.g. copilot -p {prompt}", value: "{command}", oninput: move |e| command.set(e.value()) } }
                input { placeholder: "key env var (optional)", value: "{key_env}", oninput: move |e| key_env.set(e.value()) }
                button { class: "btn", onclick: move |_| async move {
                    match infer::discover_models(connector(), base_url(), key_env()).await {
                        Ok(v) => { status.set(format!("{} found", v.len())); found.set(v) }
                        Err(e) => status.set(format!("find failed: {e}")),
                    }
                }, {ui.t("find-models")} }
            }
            if !found.read().is_empty() {
                div { class: "chips",
                    for n in found() {
                        button { class: "chip", onclick: { let n = n.clone(); move |_| add(n.clone()) }, "+ {n}" }
                    }
                }
            }
            div { class: "row",
                input { placeholder: "or type a model name", value: "{name}", oninput: move |e| name.set(e.value()) }
                button { class: "btn", onclick: move |_| { add(name()); name.set(String::new()); }, {ui.t("add")} }
            }
        }
        Pane { class: "stack",
            h3 { {ui.t("try-inference")} }
            div { class: "row",
                select { value: "{test_model}", onchange: move |e| test_model.set(e.value()),
                    option { value: "", "default ({models.read().default})" }
                    for m in models.read().models.clone() { option { value: "{m.name}", "{m.name}" } }
                }
                input { class: "grow", placeholder: "prompt", value: "{prompt}", oninput: move |e| prompt.set(e.value()) }
                button { class: "btn", onclick: move |_| async move {
                    reply.set("…".into());
                    reply.set(match infer::infer(test_model(), prompt()).await { Ok(t) => t, Err(e) => format!("error: {e}") });
                }, {ui.t("send")} }
            }
            if !reply.read().is_empty() { pre { class: "reply", "{reply}" } }
        }
    }
}
