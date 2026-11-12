//! # Service: is this still the askk I was talking to?
//!
//! A window lives longer than one run of the service: the service is restarted, or built
//! again, while the window stays open. Each time a window has been away (its question got
//! no answer, or the change feed started over) it asks `hello` and holds the answer against
//! the one it had ([`seen`]). What it must then do is the same for every UI ([`Seen::todo`]):
//!
//! | seen | means | the window |
//! | --- | --- | --- |
//! | [`Seen::Same`] | the same run of the service | goes on |
//! | [`Seen::Restarted`] | the service ended and began again | asks for everything again; nothing it shows can be trusted |
//! | [`Seen::Rebuilt`] | the program was made again | loads itself again: it was made for the old program (a page: reload; a terminal: say so) |
//! | [`Seen::Gone`] | nothing answers | keeps what it shows, says the service is away, tries again |
//!
//! `askk status` is said here too ([`lines`]), so a page can show the same words.
// A page asks `seen` and `made_for` (ui/web/views/live.rs); the lines of `askk status` are
// only said where there is a command line, so a browser build leaves them unused.
#![allow(dead_code)]
use crate::core::run::took;
use crate::core::service::{Hello, Status};

/// What a window finds when it holds a new hello against the one it had.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Seen {
    Same,
    Restarted,
    Rebuilt,
    Gone,
}

/// Hold the hello a window had (`before`; none on its first ask) against what answers `now`
/// (none: nothing answered).
pub fn seen(before: Option<&Hello>, now: Option<&Hello>) -> Seen {
    match (before, now) {
        (_, None) => Seen::Gone,
        (None, Some(_)) => Seen::Same,
        (Some(b), Some(n)) if b.build != n.build => Seen::Rebuilt,
        (Some(b), Some(n)) if b.started != n.started || b.pid != n.pid => Seen::Restarted,
        _ => Seen::Same,
    }
}

/// Whether a window made from the source named `build` fits the service that answers. A
/// page checks this on its very first hello: a browser may have kept an old page.
pub fn made_for(build: &str, service: &Hello) -> bool {
    build == service.build
}

impl Seen {
    /// What the window does next, in words a person can be shown.
    pub fn todo(self) -> &'static str {
        match self {
            Seen::Same => "",
            Seen::Restarted => "askk was restarted: everything shown is asked for again",
            Seen::Rebuilt => "askk was built again: this window loads itself again to match it",
            Seen::Gone => "askk does not answer: what is shown is kept, and it is tried again",
        }
    }
}

/// A moment (milliseconds since 1970) as a date and time anyone reads: `2026-11-11 10:02:11 UTC`.
pub fn when(ms: u64) -> String {
    let secs = ms / 1000;
    let (days, rest) = (secs / 86_400, secs % 86_400);
    // Days since 1970 as a calendar date (the usual civil-calendar arithmetic).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let (day, month) = (doy - (153 * mp + 2) / 5 + 1, if mp < 10 { mp + 3 } else { mp - 9 });
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// The answer to `askk status` (and to start, stop, restart) as lines: the sentence first,
/// then, for a running service, what is known about it. `now` is the present moment.
pub fn lines(s: &Status, now: u64) -> Vec<String> {
    let mut out = vec![s.said.clone()];
    let Some(r) = s.record.as_ref().filter(|_| s.running) else { return out };
    out.push(format!("  since    {} ({} ago)", when(r.started), took(now.saturating_sub(r.started))));
    out.push(format!("  version  {}, build {}", r.version, r.build));
    out.push(format!("  process  {}", r.pid));
    out.push(format!("  data     {}", r.data));
    out.push(format!("  log      {}", if r.log.is_empty() { "the terminal it was started in" } else { &r.log }));
    out.push(format!("  engines  {}", if s.engines.is_empty() { "none booted".to_string() } else { s.engines.join(", ") }));
    let can: Vec<&str> = s.caps.iter().filter(|c| c.here).map(|c| c.name.as_str()).collect();
    out.push(format!("  can do   {}", can.join(", ")));
    for c in s.caps.iter().filter(|c| !c.here) {
        out.push(format!("  cannot   {}: {}", c.name, c.note));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::caps::Cap;
    use crate::core::service::Record;

    fn hello(build: &str, started: u64, pid: u32) -> Hello {
        Hello { version: "0.1.0".into(), build: build.into(), started, pid }
    }

    #[test]
    fn a_window_tells_the_same_service_from_a_restarted_a_rebuilt_and_a_silent_one() {
        let a = hello("aaaa", 100, 7);
        assert_eq!(seen(None, Some(&a)), Seen::Same, "a first hello has nothing to differ from");
        assert_eq!(seen(Some(&a), Some(&a.clone())), Seen::Same);
        assert_eq!(seen(Some(&a), Some(&hello("aaaa", 200, 8))), Seen::Restarted);
        assert_eq!(seen(Some(&a), Some(&hello("aaaa", 100, 8))), Seen::Restarted, "another process is another run, even in the same moment");
        assert_eq!(seen(Some(&a), Some(&hello("bbbb", 200, 8))), Seen::Rebuilt, "a new build matters more than a new start");
        assert_eq!(seen(Some(&a), None), Seen::Gone);
        assert_eq!(seen(None, None), Seen::Gone);
        assert!(made_for("aaaa", &a) && !made_for("old", &a));
        assert!(Seen::Same.todo().is_empty() && [Seen::Restarted, Seen::Rebuilt, Seen::Gone].iter().all(|s| !s.todo().is_empty()));
    }

    #[test]
    fn a_moment_reads_as_a_date_and_a_status_as_lines() {
        assert_eq!(when(0), "1970-01-01 00:00:00 UTC");
        assert_eq!(when(1_794_391_331_000), "2026-11-11 10:02:11 UTC");
        assert_eq!(when(1_709_251_199_000), "2024-02-29 23:59:59 UTC", "a leap day");
        let stopped = Status { said: "askk is not running".into(), ..Default::default() };
        assert_eq!(lines(&stopped, 0), ["askk is not running"]);
        let r = Record { address: "http://127.0.0.1:8090".into(), pid: 7, version: "0.1.0".into(), build: "aaaa".into(), started: 1_794_391_331_000, data: "/home/data".into(), log: String::new() };
        let caps = vec![Cap { name: "store".into(), here: true, note: "a folder".into() }, Cap { name: "code".into(), here: false, note: "an engine cannot run a program it wrote".into() }];
        let running = Status { running: true, said: "askk is running at http://127.0.0.1:8090".into(), record: Some(r), engines: vec!["askk".into(), "askk/coder".into()], caps };
        let l = lines(&running, 1_794_391_331_000 + 184_000);
        assert_eq!(l[1], "  since    2026-11-11 10:02:11 UTC (3m 04s ago)");
        assert_eq!(l[5], "  log      the terminal it was started in");
        assert_eq!(l[6], "  engines  askk, askk/coder");
        assert_eq!((l[7].as_str(), l[8].as_str()), ("  can do   store", "  cannot   code: an engine cannot run a program it wrote"));
    }
}
