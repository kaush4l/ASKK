//! WHERE you are — the seven views the left panel navigates between, and the
//! nav that lists them (VIEWS.md, plus the Dashboard the product goal adds).
//!
//! The left panel used to be a list of five AGENTS with a "Setup" tab bolted on
//! the end, which spent the most valuable navigation real estate in the layout
//! on one of the eight nouns the app actually has, and crammed three more into
//! that one tab. Agents is not the navigation; agents is one view. Switching
//! agent is a TAB inside Chat (`tabs.rs`), because DESIGN.md §9 names it as one
//! of the two interactions that must feel good and a route change is heavier
//! than a tab.
//!
//! `DesignSystem` is deliberately NOT in the list. It stays exactly what
//! DESIGN.md §8 says it is — a stage surface reached from the header switch and
//! from `#design-system` in the URL at boot — because a critic opens it that
//! way and nothing about this increment gets to regress that.
//!
//! These are BUTTONS carrying `aria-current="page"`, not tabs carrying
//! `aria-selected`: this is navigation between views, and the ARIA tabs pattern
//! belongs to the one strip that really is a tablist. Each item carries `title`
//! and `aria-label` as well as its label, because at the icon-rail breakpoint
//! (768–1099) `.nav-label` is `display: none` and the accessible name has to
//! survive the label going away.

use dioxus::prelude::*;

use crate::ui::Button;

/// WHICH surface the centre stage shows. It replaces the two booleans the
/// stage routed on (`deck`, `design`); the MECHANISM is unchanged — every
/// region stays mounted and one is `hidden` — because unmounting the chat pane
/// would drop the poller following a turn in flight.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum View {
    /// WHERE YOU LAND. VIEWS.md made Chat the default and named no dashboard at
    /// all; the product's own goal overrules it — "the dashboard will be the
    /// initial side of the application". It earns the slot on the same test
    /// every other view had to pass: it is the only surface that answers "what
    /// is this thing doing right now" across all agents at once, and every
    /// other view answers it for exactly one.
    Dashboard,
    Chat,
    Agents,
    /// The machine itself: the folder the agents build in, with a shell beside
    /// it. VIEWS.md put the terminal in the rail — "a tool you use while doing
    /// something else" — and that is still true of the terminal. This view is
    /// not the terminal; it is the WORKSPACE, and a real x86 Linux with files
    /// in it that no screen shows is the product's one categorical advantage,
    /// unsold.
    Workspace,
    Memory,
    Trace,
    Settings,
    DesignSystem,
}

/// The nav list, in order. Seven. `DesignSystem` is not among them.
pub(crate) const NAV: [View; 7] = [
    View::Dashboard,
    View::Chat,
    View::Agents,
    View::Workspace,
    View::Memory,
    View::Trace,
    View::Settings,
];

impl View {
    /// The id fragment: `view-chat`, and the region it routes to, `chat-view`.
    pub(crate) fn slug(self) -> &'static str {
        match self {
            View::Dashboard => "dashboard",
            View::Chat => "chat",
            View::Agents => "agents",
            View::Workspace => "workspace",
            View::Memory => "memory",
            View::Trace => "trace",
            View::Settings => "settings",
            View::DesignSystem => "design-system",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            View::Dashboard => "Dashboard",
            View::Chat => "Chat",
            View::Agents => "Agents",
            View::Workspace => "Workspace",
            View::Memory => "Memory",
            View::Trace => "Trace",
            View::Settings => "Settings",
            View::DesignSystem => "Design system",
        }
    }

    /// One glyph, and it is decorative: the label and `aria-label` carry the
    /// name in words at every width, so a font that has none of these renders a
    /// box beside a name rather than a nav nobody can read.
    fn glyph(self) -> &'static str {
        match self {
            View::Dashboard => "▦",
            View::Chat => "▣",
            View::Agents => "◆",
            View::Workspace => "▥",
            View::Memory => "▤",
            View::Trace => "◈",
            View::Settings => "⚙",
            View::DesignSystem => "◎",
        }
    }

    /// Whether the rail has anything to say here (VIEWS.md §5). On Memory and
    /// Settings it folds: the rail is the answer to "what else do I need while
    /// I am doing this", and on those two the answer is nothing.
    pub(crate) fn rail(self) -> bool {
        matches!(self, View::Chat | View::Agents | View::Workspace | View::Trace)
    }
}

/// The header switch that reaches the design system and comes back.
///
/// It stays a switch in the header rather than a seventh nav entry for the
/// reason DESIGN.md §8 gives: it is a surface for a critic and a maintainer,
/// not a place a person doing work goes. Coming back lands on the Dashboard,
/// which is where the page starts.
#[component]
pub(crate) fn DesignSwitch(view: Signal<View>) -> Element {
    let open = view() == View::DesignSystem;
    rsx! {
        Button {
            class: if open { "panel-toggle open" } else { "panel-toggle" },
            aria_expanded: if open { "true" } else { "false" },
            aria_controls: "design-system",
            onclick: move |_| {
                let mut view = view;
                view.set(if open { View::Dashboard } else { View::DesignSystem });
            },
            span { aria_hidden: "true", if open { "▾ " } else { "▸ " } }
            "Design system"
        }
    }
}

/// The left panel. Seven views, one `<button>` each.
#[component]
pub(crate) fn ViewNav(view: Signal<View>) -> Element {
    let here = view();
    rsx! {
        div { class: "view-list",
            for entry in NAV {
                Button {
                    key: "{entry.slug()}",
                    // The same painting every other secondary control has: one
                    // button in this product, with all five of its states.
                    variant: "secondary",
                    id: "view-{entry.slug()}",
                    class: if entry == here { "view-item current" } else { "view-item" },
                    // NOT aria-selected. This is navigation.
                    aria_current: (entry == here).then_some("page"),
                    // Both, because the label is `display: none` on the icon
                    // rail and a nameless icon button is not a control.
                    title: "{entry.label()}",
                    aria_label: "{entry.label()}",
                    onclick: move |_| {
                        let mut view = view;
                        view.set(entry);
                    },
                    span { class: "nav-icon", aria_hidden: "true", "{entry.glyph()}" }
                    span { class: "nav-label", "{entry.label()}" }
                }
            }
        }
    }
}
