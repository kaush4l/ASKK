use super::agents_page::AgentsPage;
use super::capabilities_page::CapabilitiesPage;
use super::chat_panel::ChatPanel;
use super::compiled_prompt_panel::CompiledPromptPanel;
use super::event_log::EventLogPanel;
use super::fleet::FleetPanel;
use super::inspector::InspectorPanel;
use super::mcp_page::McpPage;
use super::provider_settings::ProviderSettings;
use super::soul_page::SoulPage;
use super::tools_page::ToolsPage;
use super::ui::StatusDot;
use super::v86_page::V86Page;
use super::workspace_page::WorkspacePage;
use super::{FAVICON, MAIN_CSS, UI_CSS};
#[cfg(target_arch = "wasm32")]
use crate::scheduler::start_scheduler;
use crate::state::AppSnapshot;
#[cfg(target_arch = "wasm32")]
use crate::storage::{IndexedDbStorage, StorageAdapter};
#[cfg(target_arch = "wasm32")]
use crate::tools::google::auth::{current_origin, handle_oauth_callback};
use dioxus::prelude::*;

/// Shell-chrome stylesheet — refines the topbar, security banner, left nav,
/// page-surface frame, and the two right-hand panels over main.css. Loaded
/// alongside MAIN_CSS/UI_CSS below.
const SHELL_CSS: Asset = asset!("/assets/pages/shell.css");

#[derive(Clone, Copy, PartialEq, Eq)]
enum DashboardPage {
    Chat,
    Fleet,
    Workspace,
    Vm,
    Capabilities,
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
            Self::Fleet => "Fleet",
            Self::Workspace => "Workspace",
            Self::Vm => "VM",
            Self::Capabilities => "Capabilities",
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

    // Start the in-tab scheduler on first mount.
    {
        #[allow(unused_variables)]
        let snap_sched = snapshot;
        use_effect(move || {
            #[cfg(target_arch = "wasm32")]
            start_scheduler(snap_sched);
        });
    }

    // Handle Google OAuth redirect callback on page load.
    {
        #[allow(unused_variables, unused_mut)]
        let mut snap_oauth = snapshot;
        use_effect(move || {
            #[cfg(target_arch = "wasm32")]
            {
                let mut sig = snap_oauth;
                wasm_bindgen_futures::spawn_local(async move {
                    let client_id = sig.read().tool_config.google.client_id.clone();
                    if client_id.is_empty() {
                        return;
                    }
                    let redirect_uri = current_origin();
                    if let Some((token, expiry)) =
                        handle_oauth_callback(&client_id, &redirect_uri).await
                    {
                        let mut next = sig.read().clone();
                        next.tool_config.google.access_token = token;
                        next.tool_config.google.token_expiry_ms = expiry;
                        if let Ok(storage) = IndexedDbStorage::open().await {
                            let _ = storage.save_snapshot(&next).await;
                        }
                        sig.set(next);
                    }
                });
            }
        });
    }
    let mut active_page = use_signal(|| DashboardPage::Chat);
    let mut nav_collapsed = use_signal(|| false);
    let mut show_security = use_signal(|| true);
    // Workspace, the VM console and the Fleet own their full width; Chat shows
    // the compiled-prompt panel on the right; other pages show the event log.
    let full_width = matches!(
        active_page(),
        DashboardPage::Workspace | DashboardPage::Vm | DashboardPage::Fleet
    );
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
        DashboardPage::Fleet,
        DashboardPage::Workspace,
        DashboardPage::Vm,
        DashboardPage::Capabilities,
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
        document::Stylesheet { href: UI_CSS }
        document::Stylesheet { href: SHELL_CSS }
        document::Link { rel: "manifest", href: "/assets/manifest.json" }

        main { class: "app-shell",
            header { class: "topbar",
                div { class: "brand-block",
                    h1 { "ASKK" }
                    p { "Agentic dashboard for browser-hosted model runs." }
                }
                div { class: "shell-status",
                    StatusDot {
                        tone: status_tone(&current.status).to_string(),
                        label: current.status.clone(),
                    }
                }
            }

            if show_security() {
                section { class: "security-note",
                    div { class: "note-body",
                        strong { "Prototype key warning: " }
                        span { "provider keys entered here are visible to browser code. Hosted pages can call local providers only when CORS allows this page origin." }
                    }
                    button {
                        class: "note-dismiss",
                        aria_label: "Dismiss warning",
                        onclick: move |_| show_security.set(false),
                        "✕"
                    }
                }
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
                                rsx! {
                            button {
                                key: "{label}",
                                class: if active_page() == page { "nav-item active" } else { "nav-item" },
                                onclick: move |_| active_page.set(page),
                                span { class: "nav-glyph", {nav_icon(page)} }
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
                        DashboardPage::Fleet => rsx! {
                            FleetPanel { snapshot }
                        },
                        DashboardPage::Workspace => rsx! {
                            WorkspacePage { snapshot, goal }
                        },
                        DashboardPage::Vm => rsx! {
                            V86Page {}
                        },
                        DashboardPage::Capabilities => rsx! {
                            CapabilitiesPage {}
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

/// Map the free-form status line to a StatusDot tone: errors red, completions
/// green, anything else a neutral info dot. Keyword match on the (lowercased)
/// text — the status is a human string, not an enum.
fn status_tone(status: &str) -> &'static str {
    let s = status.to_ascii_lowercase();
    if s.contains("fail") || s.contains("error") {
        "error"
    } else if s.contains("done") || s.contains("complete") || s.contains("saved") {
        "success"
    } else {
        "info"
    }
}

/// A line icon per page, drawn with `currentColor` so the nav's hover/active
/// states recolor it. Replaces the old single-letter glyphs.
fn nav_icon(page: DashboardPage) -> Element {
    let inner = match page {
        DashboardPage::Chat => rsx! {
            path { d: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4z" }
        },
        DashboardPage::Fleet => rsx! {
            // A small supervision tree: one root branching to three instance slots.
            circle { cx: "12", cy: "5", r: "2" }
            circle { cx: "5", cy: "19", r: "2" }
            circle { cx: "12", cy: "19", r: "2" }
            circle { cx: "19", cy: "19", r: "2" }
            path { d: "M12 7v4M12 11H5v6M12 11v6M12 11h7v6" }
        },
        DashboardPage::Workspace => rsx! {
            polyline { points: "9 8 5 12 9 16" }
            polyline { points: "15 8 19 12 15 16" }
        },
        DashboardPage::Vm => rsx! {
            // A console window: a framed screen with a shell prompt caret.
            rect { x: "3", y: "4", width: "18", height: "14", rx: "1.5" }
            polyline { points: "7 9 10 12 7 15" }
            line { x1: "12", y1: "15", x2: "16", y2: "15" }
        },
        DashboardPage::Capabilities => rsx! {
            rect { x: "3", y: "3", width: "7", height: "7", rx: "1.5" }
            rect { x: "14", y: "3", width: "7", height: "7", rx: "1.5" }
            rect { x: "3", y: "14", width: "7", height: "7", rx: "1.5" }
            rect { x: "14", y: "14", width: "7", height: "7", rx: "1.5" }
        },
        DashboardPage::Agents => rsx! {
            circle { cx: "9", cy: "8", r: "3" }
            path { d: "M3.5 19a5.5 5.5 0 0 1 11 0" }
            path { d: "M16 5.6a3 3 0 0 1 0 5.8" }
            path { d: "M20.5 19a5.5 5.5 0 0 0-3.8-5.2" }
        },
        DashboardPage::Soul => rsx! {
            path { d: "M12 3c2.2 2.6 4 4.4 4 7a4 4 0 0 1-8 0c0-1.2.5-2.2 1.2-3 .4 1 .8 1.4 1.6 1.8C10.6 7.6 11 5.4 12 3z" }
        },
        DashboardPage::Tools => rsx! {
            path { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" }
        },
        DashboardPage::Mcp => rsx! {
            rect { x: "3.5", y: "4", width: "17", height: "6", rx: "1.5" }
            rect { x: "3.5", y: "14", width: "17", height: "6", rx: "1.5" }
            line { x1: "7", y1: "7", x2: "7.01", y2: "7" }
            line { x1: "7", y1: "17", x2: "7.01", y2: "17" }
        },
        DashboardPage::Provider => rsx! {
            circle { cx: "8", cy: "15", r: "4" }
            path { d: "M10.8 12.2 20 3" }
            path { d: "M17 6l2 2" }
            path { d: "M14.5 8.5l2 2" }
        },
        DashboardPage::Inspector => rsx! {
            circle { cx: "11", cy: "11", r: "6" }
            line { x1: "20", y1: "20", x2: "15.6", y2: "15.6" }
        },
    };
    rsx! {
        svg {
            view_box: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            stroke_width: "1.7",
            stroke_linecap: "round",
            stroke_linejoin: "round",
            {inner}
        }
    }
}
