//! The view manifest — what the middle stage can show (ported from kiln
//! `views/manifest.js`). The left "Components" rail is this DATA; adding a
//! stage = one `Stage` variant + one `COMPONENTS` row + a case in
//! `app.rs`'s stage switch.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Stage {
    #[default]
    Chat,
    Fleet,
    Agents,
    Dashboard,
    Artifacts,
    Vm,
    Features,
    Settings,
}

impl Stage {
    pub fn key(self) -> &'static str {
        match self {
            Stage::Chat => "Chat",
            Stage::Fleet => "Fleet",
            Stage::Agents => "Agents",
            Stage::Dashboard => "Dashboard",
            Stage::Artifacts => "Artifacts",
            Stage::Vm => "VM",
            Stage::Features => "Features",
            Stage::Settings => "Settings",
        }
    }

    /// Case-insensitive so hand-typed deep links (`#/dashboard`) land too.
    pub fn from_key(key: &str) -> Option<Stage> {
        COMPONENTS
            .iter()
            .map(|c| c.stage)
            .find(|s| s.key().eq_ignore_ascii_case(key))
    }
}

/// One left-rail row: colored dot, name, mono meta chip.
pub struct Component {
    pub stage: Stage,
    pub dot: &'static str,
    pub meta: &'static str,
}

pub const COMPONENTS: &[Component] = &[
    Component {
        stage: Stage::Chat,
        dot: "var(--blue)",
        meta: "agent",
    },
    Component {
        stage: Stage::Fleet,
        dot: "var(--cyan, #23b3d1)",
        meta: "loops",
    },
    Component {
        stage: Stage::Agents,
        dot: "var(--green)",
        meta: "trace",
    },
    Component {
        stage: Stage::Dashboard,
        dot: "var(--blue-ink, #2f367e)",
        meta: "wall",
    },
    Component {
        stage: Stage::Artifacts,
        dot: "var(--gray)",
        meta: "docs",
    },
    Component {
        stage: Stage::Vm,
        dot: "var(--purple, #c678dd)",
        meta: "x86",
    },
    Component {
        stage: Stage::Features,
        dot: "var(--cyan, #23b3d1)",
        meta: "lab",
    },
    Component {
        stage: Stage::Settings,
        dot: "var(--orange)",
        meta: "cfg",
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_and_unknown_is_none() {
        for c in COMPONENTS {
            assert_eq!(Stage::from_key(c.stage.key()), Some(c.stage));
        }
        assert_eq!(Stage::from_key("Nope"), None);
    }

    #[test]
    fn from_key_ignores_case_for_deep_links() {
        assert_eq!(Stage::from_key("dashboard"), Some(Stage::Dashboard));
        assert_eq!(Stage::from_key("vm"), Some(Stage::Vm));
    }
}
