//! WHERE you are — and since the ADE round (docs/ADE-DESIGN.md §3) that is one
//! of THREE places, not seven.
//!
//! WHAT WAS WRONG, AND IT WAS NOT THE STYLING. Eight rounds moved type and
//! spacing across an information architecture nobody had questioned, and the
//! owner's verdict on all eight was that they "uplifted nothing".
//! UPLIFT-FINDINGS F8 is the diagnosis: watching an agent work was split across
//! THREE SIBLING DESTINATIONS — Chat, Tool trace and Debug — while the run is
//! one continuous event, and the nav ranked two builder instruments level with
//! the screens a user needs.
//!
//! So the run is one surface. `Work` holds a turn from the sentence you typed
//! to the verdict it ends on: the transcript, the stage walk, the tool calls,
//! the shell and the folder, in one scroller, without moving. `Agents` is where
//! agents are written. `Setup` is where turns are addressed. Nothing else is a
//! destination, and the two views that were instruments for the person building
//! this product are reached from the run they are about.
//!
//! THE OLD NAMES STILL RESOLVE. `#/dashboard`, `#/chat/main`, `#/trace`,
//! `#/debug`, `#/commands` and `#/settings` are all links somebody may already
//! have; `from_slug` lands each on the view that absorbed it and `slug()`
//! writes the canonical spelling back, so the address bar corrects itself
//! rather than a copied URL breaking.
//!
//! A VIEW IS NAMED AFTER THE PANEL YOU ACT IN, AND ITS RAIL IS THE LIVE STATE
//! OF WHAT THAT PANEL DID (R17-IA, held): Work's rail is the folder its
//! commands ran in and the files they left behind.
//!
//! `DesignSystem` is deliberately NOT in the list and not linked from the
//! product: an internal gallery citing DESIGN.md sections, reached by URL —
//! `#/design-system` — carrying a crumb back.
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
    /// THE RUN, AND THE WHOLE OF IT. One agent, one folder, watched: the
    /// transcript you type into, the loop's walk, every tool call with its
    /// arguments and output, the shell, and what the turn left on disk. This is
    /// where the application opens and it absorbed four of the seven views it
    /// replaced (ADE-DESIGN.md §3, "WATCH").
    Work,
    /// WHAT AGENTS EXIST, and the surface for writing another. The ADE's
    /// "SHAPE": you edit what the agent IS, and Work shows you the effect.
    Agents,
    /// WHERE TURNS ARE SENT, and what this browser is holding. Named `Setup`
    /// rather than `Settings` because it is the address of a model server and
    /// not a page of preferences; the appearance controls live here too.
    Setup,
    DesignSystem,
}

/// The nav list, in order. THREE. ADE-DESIGN.md §6 E5 asserts this number, and
/// it is asserted rather than stated because the count is the whole claim: a map
/// a person can hold is the difference between this round and the eight before.
pub(crate) const NAV: [View; 3] = [View::Work, View::Agents, View::Setup];

impl View {
    /// The id fragment `view-work`, and the region it routes to, `work-view`.
    pub(crate) fn slug(self) -> &'static str {
        match self {
            View::Work => "work",
            View::Agents => "agents",
            View::Setup => "setup",
            View::DesignSystem => "design-system",
        }
    }

    /// The slug back to the view (F13). Unknown means Work, which is where the
    /// application opens.
    ///
    /// EVERY NAME THIS PRODUCT HAS EVER SHIPPED RESOLVES. The four views Work
    /// absorbed are listed by hand rather than folded into the fallback,
    /// because a redirect and a misroute are different events: `#/trace` is a
    /// link that used to work and now lands on the surface that holds the
    /// trace, while `#/wharrgarbl` named nothing and the header says so
    /// (`misroute::note`, 31-walk F4).
    pub(crate) fn from_slug(slug: &str) -> Option<View> {
        if matches!(slug, "dashboard" | "chat" | "trace" | "debug" | "commands" | "workspace") {
            return Some(View::Work);
        }
        if slug == "settings" {
            return Some(View::Setup);
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
            View::Work => "Work",
            View::Agents => "Agents",
            View::Setup => "Setup",
            View::DesignSystem => "Design system",
        }
    }

    /// Whether the rail has anything to say here (VIEWS.md §5). Elsewhere the
    /// switch is NOT RENDERED (R2-12) rather than rendered disabled. WORK ONLY:
    /// the folder is the receipt of what the run on this screen just did, and
    /// nowhere else is about a run.
    pub(crate) fn rail(self) -> bool {
        matches!(self, View::Work)
    }

    /// Whether this view is about ONE agent (R5-6). Agents and Setup are about
    /// the fleet and the browser, so they get no picker, not an inert one.
    pub(crate) fn scoped(self) -> bool {
        matches!(self, View::Work)
    }

    /// WHAT IS IN THE RAIL HERE (R8-7). It said `Side panel · main` — a region
    /// named after itself. This names the CONTENTS, never the geometry.
    pub(crate) fn rail_noun(self) -> &'static str {
        "folder"
    }

    // `picker()` IS GONE. It named the region the agent strip re-pointed and
    // the sentence a screen reader heard for it (R4-10); the strip was deleted
    // with this round, because the run absorbed Chat and the thread list is
    // the picker on the one agent-scoped view there is (R19-IA). A method with
    // no caller is a claim the product no longer makes.
}

#[cfg(test)]
mod tests {
    use super::View;

    /// ADE-DESIGN.md §6 E5. The count IS the claim — F8's diagnosis is that
    /// seven equal entries, two of them instruments for the person building the
    /// product, is a map nobody can hold. A gate that cannot fail on the number
    /// would let the next round add an eighth back one view at a time (I17).
    #[test]
    fn the_map_is_three_destinations() {
        assert_eq!(super::NAV.len(), 3, "the nav grew back: {:?}", super::NAV.map(View::label));
    }

    /// …AND EVERY URL THE PRODUCT HAS EVER SHIPPED STILL LANDS SOMEWHERE REAL.
    /// Six of these named a destination that no longer exists; a link already
    /// sent must not land on a misroute banner because the architecture changed.
    #[test]
    fn the_names_the_run_absorbed_still_resolve() {
        for old in ["dashboard", "chat", "trace", "debug", "commands", "workspace"] {
            assert!(
                matches!(View::from_slug(old), Some(View::Work)),
                "`#/{old}` no longer reaches the run it was folded into"
            );
        }
        assert!(matches!(View::from_slug("settings"), Some(View::Setup)));
        assert!(View::from_slug("wharrgarbl").is_none(), "a name nobody shipped resolved");
    }
}
