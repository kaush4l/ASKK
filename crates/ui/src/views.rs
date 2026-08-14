//! WHERE you are — the seven views the left panel navigates between (VIEWS.md,
//! plus the Dashboard the product goal adds).
//!
//! ONE PANEL, ONE HOME (R15-IA). Six nav entries held about four panels,
//! re-shuffled per view, and nobody can infer a map like that. The rule: every
//! panel appears on exactly one view, the centre column is what the nav entry
//! names, the rail beside it is the live state of that same thing, and every
//! other mention of a panel is a LINK to its home rather than a second copy.
//!
//! A VIEW IS NAMED AFTER THE PANEL YOU ACT IN, AND ITS RAIL IS THE LIVE STATE
//! OF WHAT THAT PANEL DID (R17-IA, amending R15-IA) — so `Commands` keeps its
//! name, and the folder, processes and finished files beside it are what those
//! commands run in and leave behind, not a second place called Workspace.
//!
//! Round 17 asked for the rename to `Workspace`, not knowing R15 had moved this
//! view the other way one round earlier and R16 had since settled `workspace`
//! to mean the Linux folder and nothing else: naming a VIEW after it puts the
//! word back on two things, and the panel here — `Commands · main` — would then
//! disagree with its own nav entry again, which is the bug R15 fixed. What the
//! critique measured is that `Commands` does not PREDICT the other three
//! panels; that is answered under the eyebrow (`stage.rs`), where the name is
//! read, rather than by moving the view a third time.
//!
//! A VIEW HAS ONE CONTROL FOR ITS OWN SUBJECT (R19-IA, holding R15-IA): where
//! the panel a view is named after already lists the agents — Chat's thread
//! list, one row each — that list IS the picker and no strip is rendered beside
//! it (`stage.rs`, §7). Two controls for "which conversation" is what R15 bans.
//!
//! Agents is not the navigation; agents is one view, and switching agent is a
//! strip in the stage's head (`tabs.rs`, R5-6) — on the views without a list.
//!
//! `DesignSystem` is deliberately NOT in the list and since R3-11 not linked
//! from the product at all: an internal gallery citing DESIGN.md sections. It
//! is reached by URL — `#/design-system` — and carries a crumb back.
//!
//! These are BUTTONS carrying `aria-current="page"`, not tabs: this is
//! navigation. Each carries `title` and `aria-label` too, because `.nav-label`
//! is `display: none` at the icon-rail breakpoint.

use dioxus::prelude::*;

use crate::ui::Button;

/// WHICH surface the centre stage shows. The chat pane stays mounted and
/// `hidden` off its route: unmounting it drops the poller of a turn in flight.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum View {
    /// WHERE YOU LAND: the only surface answering "what is this thing doing
    /// right now" across all agents — launcher, board, shared-space tile.
    Dashboard,
    Chat,
    Agents,
    /// THE SHELL. A real x86 Linux the agent builds in, with its folder,
    /// processes and shelf in the rail. Labelled `Commands` since R15-IA.
    Workspace,
    Trace,
    Settings,
    DesignSystem,
}

/// The nav list, in order. SIX. `DesignSystem` is not among them, and neither
/// is the shared space (R5-22): a destination byte-identical to a tile the
/// Dashboard already renders is a duplicate, not navigation.
pub(crate) const NAV: [View; 6] = [
    View::Dashboard,
    View::Chat,
    View::Agents,
    View::Workspace,
    View::Trace,
    View::Settings,
];

impl View {
    /// The id fragment `view-chat`, and the region it routes to, `chat-view`.
    pub(crate) fn slug(self) -> &'static str {
        match self {
            View::Dashboard => "dashboard",
            View::Chat => "chat",
            View::Agents => "agents",
            // Nav, eyebrow and centre card all read `Commands` (R15-IA, held
            // by R17-IA above); "workspace" means one thing — the folder.
            View::Workspace => "commands",
            View::Trace => "trace",
            View::Settings => "settings",
            View::DesignSystem => "design-system",
        }
    }

    /// The slug back to the view (F13). Unknown means the Dashboard. The name
    /// this view shipped under still resolves: a link already sent must not
    /// land on the Dashboard because the label changed, and `slug()` writes the
    /// canonical spelling back, so the address bar corrects itself.
    pub(crate) fn from_slug(slug: &str) -> Option<View> {
        if slug == "workspace" {
            return Some(View::Workspace);
        }
        NAV.iter()
            .chain([View::DesignSystem].iter())
            .copied()
            .find(|v| v.slug() == slug)
    }

    /// Also the destination's heading: "Trace" landed on "Tools" (F6).
    pub(crate) fn label(self) -> &'static str {
        match self {
            View::Dashboard => "Dashboard",
            View::Chat => "Chat",
            View::Agents => "Agents",
            View::Workspace => "Commands",
            View::Trace => "Tool trace",
            View::Settings => "Settings",
            View::DesignSystem => "Design system",
        }
    }

    /// Whether the rail has anything to say here (VIEWS.md §5). Elsewhere the
    /// switch is NOT RENDERED (R2-12) rather than rendered disabled. COMMANDS
    /// ONLY (R15-IA): the Chat rail carried the board and the trace, each the
    /// subject of a view of its own.
    pub(crate) fn rail(self) -> bool {
        matches!(self, View::Workspace)
    }

    /// Whether this view is about ONE agent (R5-6). Agents and Settings are
    /// about the fleet and the browser, so they get no picker, not an inert one.
    pub(crate) fn scoped(self) -> bool {
        matches!(self, View::Dashboard | View::Chat | View::Workspace | View::Trace)
    }

    /// WHAT IS IN THE RAIL HERE (R8-7). It said `Side panel · main` — a region
    /// named after itself. This names the CONTENTS, never the geometry; one
    /// rail, one noun, since `rail()` narrowed to Commands (R15-IA).
    ///
    /// The header switch this feeds appears on this view only, which round 17
    /// read as a control coming and going at random. It is KEPT (R17-P1-9): one
    /// view has a rail, and the alternative was measured — a permanent `Hide
    /// workspace files` with `aria-expanded="true"` over a `#rail` that was 0x0
    /// (R12-6, `rail::instruments`), a dead control lying about its own state.
    pub(crate) fn rail_noun(self) -> &'static str {
        "folder"
    }

    /// What the strip re-points HERE (R4-10): one name for two jobs told a
    /// screen-reader user the wrong thing on one of them.
    pub(crate) fn picker(self) -> (&'static str, &'static str) {
        match self {
            View::Dashboard => ("task-field", "Which agent runs the task"),
            _ => ("content", "Which agent this view is about"),
        }
    }
}

/// The left panel. One `<button>` per view.
#[component]
pub(crate) fn ViewNav(
    view: Signal<View>,
    /// Whether the panel this list is in is shown. Below the three-column
    /// breakpoint it is a SHEET over the content (R3-9), so choosing a view
    /// puts it away rather than standing on top of what you just picked.
    nav: Signal<bool>,
) -> Element {
    let here = view();
    rsx! {
        // THE WAY OUT OF THE DRAWER (R5-8). Below 1100px this list is a sheet
        // over the page and had no close control. `display:none` above it.
        Button {
            class: "nav-close",
            variant: "ghost",
            onclick: move |_| {
                let mut nav = nav;
                nav.set(false);
            },
            "✕ Close"
        }
        div { class: "view-list",
            for entry in NAV {
                Button {
                    key: "{entry.slug()}",
                    // NO VARIANT (R4-17): with `secondary` the nav entries and
                    // the form actions computed to the same everything.
                    id: "view-{entry.slug()}",
                    class: if entry == here { "view-item current" } else { "view-item" },
                    // NOT aria-selected. This is navigation.
                    aria_current: (entry == here).then_some("page"),
                    // Both: `.nav-label` is `display:none` on the icon rail.
                    title: "{entry.label()}",
                    aria_label: "{entry.label()}",
                    onclick: move |_| {
                        let (mut view, mut nav) = (view, nav);
                        view.set(entry);
                        if !crate::dash::wide() {
                            nav.set(false);
                        }
                    },
                    span { class: "nav-label", "{entry.label()}" } // no glyph (F8)
                }
            }
        }
    }
}
