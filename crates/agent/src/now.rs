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

/// Just the wall-clock time, for a log a person reads (R2-18). UTC, and it
/// says UTC: `Timestamp` carries no zone and this crate has no tz database, so
/// a bare `14:07:02` would be a different lie in every timezone but one.
pub fn clock(at: Timestamp) -> String {
    let rest = at.0.rem_euclid(86_400_000) / 1000;
    let (hh, mm, ss) = (rest / 3600, (rest % 3600) / 60, rest % 60);
    format!("{hh:02}:{mm:02}:{ss:02} UTC")
}

/// The environment block for THIS call: what time it is, what day, and what
/// this is running on. Nothing else.
///
/// The shared space used to be concatenated onto the end of this string, which
/// made a file that is not a component build prompt prose (I13) and fused two
/// blocks with different lifetimes. The space is its own component now
/// (`components::space`), at its own slot, ahead of the clock — and this is
/// back to the one thing that can never be cached, because a cached clock is a
/// wrong clock.
pub fn environment(at: Timestamp) -> String {
    let ms = at.0;
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000) / 1000;
    let (y, m, d) = civil(days);
    let (hh, mm, ss) = (rest / 3600, (rest % 3600) / 60, rest % 60);
    let day = DAYS[days.rem_euclid(7) as usize];
    format!(
        "current time: {y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02} UTC\nday: {day}\n\
         device: a browser tab."
    )
}
