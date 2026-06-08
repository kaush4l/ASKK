use super::agents_page::AgentsPage;
use super::chat_panel::ChatPanel;
use super::compiled_prompt_panel::CompiledPromptPanel;
use super::event_log::EventLogPanel;
use super::inspector::InspectorPanel;
use super::mcp_page::McpPage;
use super::provider_settings::ProviderSettings;
use super::soul_page::SoulPage;
use super::tools_page::ToolsPage;
use super::workspace_page::WorkspacePage;
use super::{FAVICON, MAIN_CSS};
use crate::state::AppSnapshot;
use dioxus::prelude::*;

#[derive(Clone, Copy, PartialEq, Eq)]
enum DashboardPage {
    Chat,
    Workspace,
    Agents,
    Soul,
    Tools,
    Mcp,
    Provider,
    Inspector,
}

impl DashboardPage {
    fn label(self) -> &'static str {
        match self {
            Self::Chat => "Chat",
            Self::Workspace => "Workspace",
            Self::Agents => "Agents",
            Self::Soul => "Soul",
            Self::Tools => "Tools",
            Self::Mcp => "MCP",
            Self::Provider => "Provider",
            Self::Inspector => "Inspector",
        }
    }
}

#[component]
pub fn AppShell(
    snapshot: Signal<AppSnapshot>,
    goal: Signal<String>,
    new_agent_name: Signal<String>,
    new_agent_role: Signal<String>,
    provider_models: Signal<Vec<String>>,
) -> Element {
    let current = snapshot.read().clone();
    let mut active_page = use_signal(|| DashboardPage::Chat);
    let mut nav_collapsed = use_signal(|| false);
    // Workspace owns its full width; Chat shows the compiled-prompt panel on the
    // right; other pages show the event log.
    let full_width = matches!(active_page(), DashboardPage::Workspace);
    // On Chat, cap the frame to the viewport so the conversation and prompt panels
    // scroll internally and the composer stays a visible footer (no page scroll to
    // reach the input). Only Chat opts in: both its columns scroll internally, so
    // other pages keep their content-driven page growth.
    let chat_active = matches!(active_page(), DashboardPage::Chat);
    let base_frame_class = match (nav_collapsed(), full_width) {
        (true, true) => "dashboard-frame nav-collapsed no-log",
        (true, false) => "dashboard-frame nav-collapsed",
        (false, true) => "dashboard-frame no-log",
        (false, false) => "dashboard-frame",
    };
    let frame_class = if chat_active {
        format!("{base_frame_class} chat-active")
    } else {
        base_frame_class.to_string()
    };
    let left_nav_class = if nav_collapsed() {
        "left-nav collapsed"
    } else {
        "left-nav"
    };
    let pages = [
        DashboardPage::Chat,
        DashboardPage::Workspace,
        DashboardPage::Agents,
        DashboardPage::Soul,
        DashboardPage::Tools,
        DashboardPage::Mcp,
        DashboardPage::Provider,
        DashboardPage::Inspector,
    ];

    rsx! {
        document::Link { rel: "icon", href: FAVICON }
        document::Link { rel: "stylesheet", href: MAIN_CSS }

        main { class: "app-shell",
            header { class: "topbar",
                div { class: "brand-block",
                    h1 { "ASKK" }
                    p { "Agentic dashboard for browser-hosted model runs." }
                }
                div { class: "status-pill", "{current.status}" }
            }

            section { class: "security-note",
                strong { "Prototype key warning: " }
                span { "provider keys entered here are visible to browser code. Hosted pages can call local providers only when CORS allows this page origin." }
            }

            div { class: "{frame_class}",
                aside { class: "{left_nav_class}",
                    div { class: "left-nav-head",
                        span { class: "nav-title", "Dashboard" }
                        button {
                            class: "icon-button",
                            onclick: move |_| nav_collapsed.set(!nav_collapsed()),
                            if nav_collapsed() { ">" } else { "<" }
                        }
                    }
                    nav { class: "nav-list",
                        for page in pages {
                            {
                                let label = page.label();
                                let glyph = nav_glyph(page);
                                rsx! {
                            button {
                                key: "{label}",
                                class: if active_page() == page { "nav-item active" } else { "nav-item" },
                                onclick: move |_| active_page.set(page),
                                span { class: "nav-glyph", "{glyph}" }
                                span { class: "nav-text", "{label}" }
                            }
                                }
                            }
                        }
                    }
                }

                section { class: "page-surface",
                    {match active_page() {
                        DashboardPage::Chat => rsx! {
                            ChatPanel { snapshot, goal }
                        },
                        DashboardPage::Workspace => rsx! {
                            WorkspacePage { snapshot, goal }
                        },
                        DashboardPage::Agents => rsx! {
                            AgentsPage {
                                snapshot,
                                new_agent_name,
                                new_agent_role,
                            }
                        },
                        DashboardPage::Soul => rsx! {
                            SoulPage { snapshot }
                        },
                        DashboardPage::Tools => rsx! {
                            ToolsPage { snapshot }
                        },
                        DashboardPage::Mcp => rsx! {
                            McpPage { snapshot }
                        },
                        DashboardPage::Provider => rsx! {
                            ProviderSettings { snapshot, provider_models }
                        },
                        DashboardPage::Inspector => rsx! {
                            InspectorPanel { snapshot }
                        },
                    }}
                }

                if active_page() == DashboardPage::Chat {
                    CompiledPromptPanel { snapshot }
                } else if !full_width {
                    EventLogPanel { snapshot }
                }
            }
        }
    }
}

fn nav_glyph(page: DashboardPage) -> &'static str {
    match page {
        DashboardPage::Chat => "C",
        DashboardPage::Workspace => "W",
        DashboardPage::Agents => "A",
        DashboardPage::Soul => "S",
        DashboardPage::Tools => "T",
        DashboardPage::Mcp => "M",
        DashboardPage::Provider => "P",
        DashboardPage::Inspector => "I",
    }
}
