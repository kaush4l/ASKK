use crate::ui::components::Pane;
use crate::api::models as infer;
use crate::core::models::{Found, Model, Models};
use dioxus::prelude::*;

/// Models view: list, add (by name or discovered), set default, delete, save to models.json, test.
#[component]
pub fn ModelsView() -> Element {
    let ui = use_context::<crate::api::UiConfig>();
    let mut models = use_signal(Models::default);
    let mut status = use_signal(String::new);
    let mut method = use_signal(|| infer::METHODS[0].to_string());
    let mut base_url = use_signal(String::new);
    let mut command = use_signal(String::new);
    let mut token_env = use_signal(String::new);
    let mut name = use_signal(String::new);
    let mut found = use_signal(Vec::<Found>::new);
    let mut max_tokens = use_signal(|| infer::MAX_TOKENS.to_string());
    let mut context = use_signal(String::new);
    let mut prompt = use_signal(String::new);
    let mut test_model = use_signal(String::new);
    let mut reply = use_signal(String::new);

    use_future(move || async move {
        match infer::list_models().await {
            Ok(m) => models.set(m),
            Err(e) => status.set(format!("load failed: {e}")),
        }
    });

    let mut add = move |n: String, found_context: u32| {
        if n.is_empty() || models.read().models.iter().any(|m| m.name == n) {
            return;
        }
        let m = Model {
            name: n,
            method: method(),
            base_url: base_url(),
            token_env: token_env(),
            command: command().split_whitespace().map(String::from).collect(),
            max_tokens: max_tokens().parse().unwrap_or(infer::MAX_TOKENS),
            context: context().parse().unwrap_or(found_context),
            input: String::new(),
        };
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
                    span { class: "dim", "{m.method} {m.base_url} {m.command.join(\" \")}" }
                    if !m.token_env.is_empty() { span { class: "dim", "token: ${m.token_env}" } }
                    span { class: "badge", "out {crate::ui::views::prompt::kilo(m.max_tokens as usize)}" }
                    span { class: "badge", if m.context > 0 { "ctx {crate::ui::views::prompt::kilo(m.context as usize)}" } else { "ctx from server" } }
                    button { class: "btn quiet-danger", onclick: { let n = m.name.clone(); move |_| {
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
                select { value: "{method}", onchange: move |e| method.set(e.value()),
                    for c in infer::METHODS { option { value: "{c}", "{c}" } }
                }
                if method() == "openai" { input { placeholder: "Base URL", title: "Blank = {infer::OPENAI_URL}", "aria-label": "Base URL", value: "{base_url}", oninput: move |e| base_url.set(e.value()) } }
                if method() == "cli" { input { placeholder: "Command", title: "e.g. copilot -p {{prompt}}", "aria-label": "Command", value: "{command}", oninput: move |e| command.set(e.value()) } }
                input { placeholder: "Token env var", title: "Optional, e.g. OPENAI_API_KEY", "aria-label": "Token env var", value: "{token_env}", oninput: move |e| token_env.set(e.value()) }
                input { class: "num", placeholder: "Max out", title: "Max reply tokens", "aria-label": "Max reply tokens", value: "{max_tokens}", oninput: move |e| max_tokens.set(e.value()) }
                input { class: "num", placeholder: "Context", title: "Blank = from server", "aria-label": "Context", value: "{context}", oninput: move |e| context.set(e.value()) }
                button { class: "btn", onclick: move |_| async move {
                    match infer::discover_models(method(), base_url(), token_env()).await {
                        Ok(v) => { status.set(format!("{} found", v.len())); found.set(v) }
                        Err(e) => status.set(format!("find failed: {e}")),
                    }
                }, {ui.t("find-models")} }
            }
            if !found.read().is_empty() {
                div { class: "chips",
                    for f in found() {
                        button { class: "chip", onclick: { let f = f.clone(); move |_| add(f.name.clone(), f.context) },
                            "+ {f.name}"
                            if f.context > 0 { span { class: "dim", " {crate::ui::views::prompt::kilo(f.context as usize)}" } }
                        }
                    }
                }
            }
            div { class: "row",
                input { placeholder: "or type a model name", value: "{name}", oninput: move |e| name.set(e.value()) }
                button { class: "btn", onclick: move |_| { add(name(), 0); name.set(String::new()); }, {ui.t("add")} }
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
