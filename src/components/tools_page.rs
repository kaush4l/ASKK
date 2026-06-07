use super::save_snapshot;
use super::shared::set_status;
use crate::state::{AppSnapshot, SearchBackend, WebSearchProvider};
use crate::tools::web_search_with_config;
use dioxus::prelude::*;
use serde_json::json;
use wasm_bindgen_futures::spawn_local;

#[component]
pub fn ToolsPage(mut snapshot: Signal<AppSnapshot>) -> Element {
    let current = snapshot.read().clone();
    let config = current.tool_config.web_search;
    let mut test_query = use_signal(|| "latest technology news".to_string());
    let mut test_result = use_signal(String::new);

    rsx! {
        section { class: "panel page-panel tools-page",
            div { class: "page-heading",
                div {
                    h2 { "Tools" }
                }
                div { class: "button-row",
                    button {
                        onclick: move |_| {
                            let save_data = snapshot.read().clone();
                            let mut snapshot = snapshot;
                            spawn_local(async move {
                                let status = save_snapshot(save_data).await;
                                set_status(&mut snapshot, status);
                            });
                        },
                        "Save"
                    }
                }
            }

            article { class: "tool-config-card",
                div { class: "tool-card-head",
                    h3 { "web_search" }
                    span { class: "source-path", "active" }
                }
                div { class: "tool-config-grid",
                    label {
                        "Backend"
                        select {
                            value: "{config.backend.as_form_value()}",
                            onchange: move |event| {
                                snapshot.write().tool_config.web_search.backend =
                                    SearchBackend::from_form_value(&event.value());
                            },
                            option { value: "browser", "Browser (no bridge, works hosted)" }
                            option { value: "bridge", "Bridge (local, richer providers)" }
                        }
                    }
                    label {
                        "Bridge URL"
                        input {
                            value: "{config.bridge_tools_url}",
                            oninput: move |event| {
                                snapshot.write().tool_config.web_search.bridge_tools_url = event.value();
                            }
                        }
                    }
                    label {
                        "Provider"
                        select {
                            value: "{config.provider.as_form_value()}",
                            onchange: move |event| {
                                snapshot.write().tool_config.web_search.provider =
                                    WebSearchProvider::from_form_value(&event.value());
                            },
                            option { value: "auto", "Auto" }
                            option { value: "duckduckgo", "DuckDuckGo" }
                            option { value: "searxng", "SearXNG" }
                            option { value: "brave", "Brave" }
                            option { value: "tavily", "Tavily" }
                        }
                    }
                    label {
                        "Default Count"
                        input {
                            class: "number-input",
                            r#type: "number",
                            min: "1",
                            max: "10",
                            value: "{config.default_count}",
                            oninput: move |event| {
                                if let Ok(value) = event.value().parse::<u32>() {
                                    snapshot.write().tool_config.web_search.default_count = value.clamp(1, 10);
                                }
                            }
                        }
                    }
                    label {
                        "Country"
                        input {
                            value: "{config.country}",
                            placeholder: "US",
                            oninput: move |event| {
                                snapshot.write().tool_config.web_search.country = event.value();
                            }
                        }
                    }
                    label {
                        "Language"
                        input {
                            value: "{config.language}",
                            placeholder: "en",
                            oninput: move |event| {
                                snapshot.write().tool_config.web_search.language = event.value();
                            }
                        }
                    }
                    label {
                        "Freshness"
                        input {
                            value: "{config.freshness}",
                            placeholder: "day, week, month",
                            oninput: move |event| {
                                snapshot.write().tool_config.web_search.freshness = event.value();
                            }
                        }
                    }
                    label {
                        "SearXNG URL"
                        input {
                            value: "{config.searxng_url}",
                            placeholder: "http://127.0.0.1:8080",
                            oninput: move |event| {
                                snapshot.write().tool_config.web_search.searxng_url = event.value();
                            }
                        }
                    }
                    label {
                        "Brave API Key"
                        input {
                            r#type: "password",
                            value: "{config.brave_api_key}",
                            oninput: move |event| {
                                snapshot.write().tool_config.web_search.brave_api_key = event.value();
                            }
                        }
                    }
                    label {
                        "Tavily API Key"
                        input {
                            r#type: "password",
                            value: "{config.tavily_api_key}",
                            oninput: move |event| {
                                snapshot.write().tool_config.web_search.tavily_api_key = event.value();
                            }
                        }
                    }
                }
                label { class: "checkbox-line",
                    input {
                        r#type: "checkbox",
                        checked: config.persist_api_keys,
                        onchange: move |event| {
                            snapshot.write().tool_config.web_search.persist_api_keys = event.checked();
                        }
                    }
                    "Persist web-search API keys"
                }
            }

            article { class: "tool-config-card",
                div { class: "tool-card-head",
                    h3 { "Test Search" }
                    button {
                        onclick: move |_| {
                            let query = test_query.read().trim().to_string();
                            if query.is_empty() {
                                test_result.set("Enter a test query.".to_string());
                                return;
                            }
                            let config = snapshot.read().tool_config.web_search.clone();
                            let mut test_result = test_result;
                            spawn_local(async move {
                                test_result.set("Searching...".to_string());
                                let args = json!({
                                    "query": query,
                                    "count": config.default_count,
                                });
                                match web_search_with_config(&args, &config).await {
                                    Ok(result) => test_result.set(result),
                                    Err(err) => test_result.set(err),
                                }
                            });
                        },
                        "Test Search"
                    }
                }
                label {
                    "Query"
                    input {
                        value: "{test_query.read()}",
                        oninput: move |event| test_query.set(event.value())
                    }
                }
                if !test_result.read().trim().is_empty() {
                    pre { class: "tool-test-output", "{test_result.read()}" }
                }
            }
        }
    }
}
