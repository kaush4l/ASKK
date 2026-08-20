//! WHAT A STAGED TURN LEAVES IN THE LOG, and how a view reads it back out.
//!
//! The cursor next door decides; nothing here does. These are a subject of
//! their own because an emitted payload and the projection that parses it are
//! two halves of one wire format (I8), and the way those two drift is being
//! written far apart. `core`'s Trace and stage views read the log through
//! `stage_of` and `route_of` and never through the cursor.

use kernel::EventKind;

use crate::effect::Effect;
use crate::strategy::Route;

/// The fact a stage was entered. Emitted for `verify::VERIFY_NUDGED`'s reason
/// (I8): the machine added a round, and a round nobody can see is a model
/// talking to itself while the token meter charges for it.
pub const STAGE_ENTERED: &str = "core.stage_entered";

/// The fact a route was chosen, and what decided it. The strategy stage spends
/// a call to make a decision the person never sees otherwise; a turn that
/// silently became four calls instead of one is the sort of thing a bill
/// explains and nothing else does.
pub const ROUTE_CHOSEN: &str = "core.route_chosen";

pub(crate) fn entered(stage: &str) -> Effect {
    Effect::Emit {
        kind: EventKind::Custom {
            kind: STAGE_ENTERED.into(),
            payload_json: serde_json::to_string(stage).unwrap_or_else(|_| "\"\"".into()),
        },
    }
}

pub(super) fn chosen(route: Route, reply: &str) -> Effect {
    // The WHY line, if the model wrote one — the difference between "the
    // machine chose project" and "the machine chose project because the
    // message asked for a working script".
    let why = reply
        .lines()
        .find_map(|l| l.trim().strip_prefix("WHY:"))
        .unwrap_or_default()
        .trim();
    Effect::Emit {
        kind: EventKind::Custom {
            kind: ROUTE_CHOSEN.into(),
            payload_json: serde_json::json!({ "route": route.as_str(), "why": why }).to_string(),
        },
    }
}

/// Which stage a `STAGE_ENTERED` fact names, for the projections.
///
/// EVERY ASSERTION ABOUT THE CURSOR IS IN `tests/stages.rs`, through `step` and
/// against the real shipped agent files — what a stage does is a sequence of
/// effects a turn produces, and a unit test of the cursor could pass while the
/// turn it drives ended in the wrong place.
pub fn stage_of(payload_json: &str) -> String {
    serde_json::from_str::<String>(payload_json).unwrap_or_default()
}

/// Which route a `ROUTE_CHOSEN` fact names, and what decided it.
pub fn route_of(payload_json: &str) -> (String, String) {
    let read = |v: &serde_json::Value, k: &str| {
        v.get(k).and_then(|s| s.as_str()).unwrap_or_default().to_string()
    };
    serde_json::from_str::<serde_json::Value>(payload_json)
        .map(|v| (read(&v, "route"), read(&v, "why")))
        .unwrap_or_default()
}
