//! The view manifest — what the middle stage can show (ported from kiln
//! `views/manifest.js`). The left "Components" rail is this DATA; adding a
//! stage = one `Stage` variant + one `COMPONENTS` row + a case in
//! `app.rs`'s stage switch.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Stage {
    #[default]
    Chat,
    Agents,
    Vm,
    Settings,
}

impl Stage {
    pub fn key(self) -> &'static str {
        match self {
            Stage::Chat => "Chat",
            Stage::Agents => "Agents",
            Stage::Vm => "VM",
            Stage::Settings => "Settings",
        }
    }

    pub fn from_key(key: &str) -> Option<Stage> {
        COMPONENTS.iter().map(|c| c.stage).find(|s| s.key() == key)
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
        stage: Stage::Agents,
        dot: "var(--green)",
        meta: "trace",
    },
    Component {
        stage: Stage::Vm,
        dot: "var(--purple, #c678dd)",
        meta: "x86",
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
}
