//! The CONTEXT clock (Python `Engine.context`: "a cached clock is a wrong
//! clock"). The environment section is rebuilt from the INJECTED timestamp on
//! every single model call, so nothing stale can survive into a later turn —
//! and because the timestamp is injected (I7), the block is still deterministic
//! and golden-testable (I14).
//!
//! ponytail: civil-from-days is fifteen lines of Howard Hinnant's algorithm,
//! and a date crate is a dependency tree to print one line. UTC only —
//! `Timestamp` is epoch milliseconds and carries no zone.

use kernel::Timestamp;

/// Days since 1970-01-01 → (year, month, day). Hinnant's `civil_from_days`.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (y + i64::from(m <= 2), m, d)
}

const DAYS: [&str; 7] = [
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
];

/// The environment block for THIS call: what time it is, what day, and the
/// shared space as of right now. The Python's context keys, in the order it
/// writes them — the space merged into the same block by `Engine.context`,
/// and for the same reason the clock is here: a peer on another Worker may
/// have written to it since the last turn.
pub fn environment(at: Timestamp, space: Option<&crate::space::Space>) -> String {
    let ms = at.0;
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000) / 1000;
    let (y, m, d) = civil(days);
    let (hh, mm, ss) = (rest / 3600, (rest % 3600) / 60, rest % 60);
    let day = DAYS[days.rem_euclid(7) as usize];
    let mut block = format!(
        "current time: {y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02} UTC\nday: {day}\n\
         device: a browser tab."
    );
    if let Some(space) = space {
        block.push('\n');
        block.push_str(&space.context());
    }
    block
}
