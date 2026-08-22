//! WHERE you are — the eight views the left panel navigates between (VIEWS.md,
//! plus the Dashboard the product goal adds and the Debug view that projects the
//! facts the log already held and nothing drew).
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
//! Round 17's rename to `Workspace` was REFUSED: R16 settled that word on the
//! Linux folder alone, so a view named after it would put it back on two things
//! and the panel — `Commands · main` — would disagree with its own nav entry,
//! the bug R15 fixed. What that critique measured, that `Commands` does not
//! predict the three panels beside it, is answered under the eyebrow
//! (`centre/mod.rs`) rather than by moving the view a third time.
//!
//! A VIEW HAS ONE CONTROL FOR ITS OWN SUBJECT (R19-IA, holding R15-IA): where
//! the panel a view is named after already lists the agents — Chat's thread
//! list, one row each — that list IS the picker and no strip is rendered beside
//! it (`centre/mod.rs`, §7). Two controls for "which conversation" is what R15 bans.
//!
//! Agents is not the navigation; agents is one view, and switching agent is a
//! strip in the stage's head (`shell/agent_switcher.rs`, R5-6) — on the views without a list.
//!
//! `DesignSystem` is deliberately NOT in the list and since R3-11 not linked
//! from the product at all: an internal gallery citing DESIGN.md sections. It
//! is reached by URL — `#/design-system` — and carries a crumb back.
//!
//! These are BUTTONS carrying `aria-current="page"`, not tabs: this is
//! navigation. Each carries `title` and `aria-label` too, because `.nav-label`
//! is `display: none` at the icon-rail breakpoint.

/// When the address bar names no view. Beside `from_slug` below, which is the
/// only place that knows a slug matched none.
pub(crate) mod misroute;
/// The list you click. Split out when the Debug view took this file past I12's
/// 200 lines; `ViewNav` is re-exported so every call site is unchanged.
mod nav;
pub(crate) use nav::ViewNav;

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
    /// WHAT IS GOING ON UNDERNEATH — the facts the log already held and nothing
    /// drew; `ui/debug/mod.rs` lists them and says why they were unread.
    Debug,
    Settings,
    DesignSystem,
}

/// The nav list, in order. SEVEN since Debug. `DesignSystem` is not among them,
/// and neither is the shared space (R5-22): a destination byte-identical to a tile the
/// Dashboard already renders is a duplicate, not navigation.
pub(crate) const NAV: [View; 7] = [
    View::Dashboard,
    View::Chat,
    View::Agents,
    View::Workspace,
    View::Trace,
    // After the trace: the last of the "what happened" views, and where to go
    // when the trace does not explain what you just watched.
    View::Debug,
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
            View::Debug => "debug",
            View::Settings => "settings",
            View::DesignSystem => "design-system",
        }
    }

    /// The slug back to the view (F13). Unknown means the Dashboard. The name
    /// this view shipped under still resolves: a link already sent must not
    /// land on the Dashboard because the label changed, and `slug()` writes the
    /// canonical spelling back, so the address bar corrects itself.
    ///
    /// …AND IT SAYS THAT IT DID (31-walk F4). This is the ONE place that knows
    /// a slug named no view, and it used to swallow that: `misroute::note` is
    /// what the header then reads.
    pub(crate) fn from_slug(slug: &str) -> Option<View> {
        if slug == "workspace" {
            return Some(View::Workspace);
        }
        let found =
            NAV.iter().chain([View::DesignSystem].iter()).copied().find(|v| v.slug() == slug);
        if found.is_none() {
            misroute::note(slug); // the header says so; `misroute.rs` says why
        }
        found
    }

    /// Also the destination's heading: "Trace" landed on "Tools" (F6).
    pub(crate) fn label(self) -> &'static str {
        match self {
            View::Dashboard => "Dashboard",
            View::Chat => "Chat",
            View::Agents => "Agents",
            View::Workspace => "Commands",
            View::Trace => "Tool trace",
            View::Debug => "Debug",
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
        matches!(self, View::Dashboard | View::Chat | View::Workspace | View::Trace | View::Debug)
    }

    /// WHAT IS IN THE RAIL HERE (R8-7). It said `Side panel · main` — a region
    /// named after itself. This names the CONTENTS, never the geometry; one
    /// rail, one noun, since `rail()` narrowed to Commands (R15-IA).
    ///
    /// The switch this feeds appears on this view only, which round 17 read as
    /// a control coming and going at random. KEPT (R17-P1-9): the alternative
    /// was measured — a permanent `Hide workspace files` with
    /// `aria-expanded="true"` over a 0x0 `#rail` (R12-6), a dead control.
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
