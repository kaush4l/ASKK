use super::save_snapshot;
use super::shared::set_status;
use crate::state::{AppSnapshot, SearchBackend, WebSearchProvider};
use crate::tools::google::auth::is_token_valid;
#[cfg(target_arch = "wasm32")]
use crate::tools::google::auth::{build_auth_url, current_origin};
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
                p { class: "muted",
                    "Browser backend: it tries the configured SearXNG instance first (a real general-web metasearch, no key). Browser-direct SearXNG needs an instance with format=json + CORS enabled; the shipped public default can rate-limit, so for full reliability and privacy point the SearXNG URL at your own instance. It then falls back to a Tavily API key (full web + current news from the page, free tier at tavily.com) and finally to key-free public sources (DuckDuckGo, GDELT news [rate-limited], Hacker News, Stack Overflow, Wikipedia). For heavy or parallel use, the Bridge backend with Brave/Tavily/SearXNG is the most reliable."
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
                            placeholder: "https://search.example (needs format=json + CORS)",
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
        // ── Notifications ─────────────────────────────────────────────
        article { class: "tool-config-card",
            div { class: "tool-card-head",
                h3 { "Notifications" }
            }
            p { class: "muted",
                "Allow notifications so the scheduler can alert you when the tab is open."
            }
            button {
                onclick: move |_| {
                    #[cfg(target_arch = "wasm32")]
                    spawn_local(async {
                        if let Ok(promise) = web_sys::Notification::request_permission() {
                            let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
                        }
                    });
                },
                "Allow notifications"
            }
        }

        // ── Google (Gmail + Calendar) ──────────────────────────────────
        article { class: "tool-config-card",
            div { class: "tool-card-head",
                h3 { "Google (Gmail + Calendar)" }
            }
            p { class: "muted",
                "Create a Web Application OAuth 2.0 client in Google Cloud Console, "
                "add this page's origin as an authorised redirect URI, and add your email "
                "as a test user. Scopes: gmail.readonly + calendar.readonly."
            }
            div { class: "tool-config-grid",
                label {
                    "Client ID"
                    input {
                        r#type: "text",
                        placeholder: "1234.apps.googleusercontent.com",
                        value: "{snapshot.read().tool_config.google.client_id}",
                        oninput: move |e| {
                            snapshot.write().tool_config.google.client_id = e.value();
                        }
                    }
                }
                {
                    let tok    = snapshot.read().tool_config.google.access_token.clone();
                    let expiry = snapshot.read().tool_config.google.token_expiry_ms;
                    let now_ms = {
                        #[cfg(target_arch = "wasm32")]
                        { js_sys::Date::now() as u64 }
                        #[cfg(not(target_arch = "wasm32"))]
                        { 0u64 }
                    };
                    if tok.is_empty() {
                        rsx! { p { class: "muted", "Not connected" } }
                    } else if is_token_valid(&tok, expiry, now_ms) {
                        rsx! { p { class: "muted", "Connected (token valid)" } }
                    } else {
                        rsx! { p { class: "muted", "Token expired — click Connect to refresh" } }
                    }
                }
                button {
                    onclick: move |_| {
                        let client_id = snapshot.read().tool_config.google.client_id.clone();
                        if !client_id.is_empty() {
                        #[cfg(target_arch = "wasm32")]
                        spawn_local(async move {
                            let redirect_uri = current_origin();
                            match build_auth_url(&client_id, &redirect_uri).await {
                                Ok(url) => {
                                    if let Some(w) = web_sys::window() {
                                        let _ = w.location().set_href(&url);
                                    }
                                }
                                Err(e) => web_sys::console::error_1(&e.into()),
                            }
                        });
                        } // end !client_id.is_empty()
                    },
                    "Connect Google"
                }
                label { class: "checkbox-line",
                    input {
                        r#type: "checkbox",
                        checked: snapshot.read().tool_config.google.persist_tokens,
                        onchange: move |e| {
                            snapshot.write().tool_config.google.persist_tokens = e.checked();
                        }
                    }
                    " Persist token to IndexedDB (less re-auth, less secure)"
                }
            }
        }

        // ── Telegram ──────────────────────────────────────────────────
        article { class: "tool-config-card",
            div { class: "tool-card-head",
                h3 { "Telegram" }
            }
            p { class: "muted",
                "Create a bot via @BotFather, paste the token below. "
                "For chat ID, send a message to your bot then get the ID from @userinfobot."
            }
            div { class: "tool-config-grid",
                label {
                    "Bot token"
                    input {
                        r#type: "password",
                        placeholder: "123456789:ABCdef...",
                        value: "{snapshot.read().tool_config.telegram.bot_token}",
                        oninput: move |e| {
                            snapshot.write().tool_config.telegram.bot_token = e.value();
                        }
                    }
                }
                label {
                    "Chat ID"
                    input {
                        r#type: "text",
                        placeholder: "123456789",
                        value: "{snapshot.read().tool_config.telegram.chat_id}",
                        oninput: move |e| {
                            snapshot.write().tool_config.telegram.chat_id = e.value();
                        }
                    }
                }
                label { class: "checkbox-line",
                    input {
                        r#type: "checkbox",
                        checked: snapshot.read().tool_config.telegram.persist_token,
                        onchange: move |e| {
                            snapshot.write().tool_config.telegram.persist_token = e.checked();
                        }
                    }
                    " Persist token to IndexedDB"
                }
            }
        }

        }
    }
}
