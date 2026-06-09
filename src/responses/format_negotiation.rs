//! Requested-format negotiation: a tiny pure mechanism that tracks *consecutive*
//! response-parse failures and escalates the format the model is ASKED for from the
//! default TOON to JSON once TOON has failed too many times in a row.
//!
//! This is distinct from the lenient parse cascade in
//! [`from_raw`](super::StructuredResponse::from_raw), which always yields *some*
//! [`ReActResponse`]. Here a "failure" is narrower: the reply did not cleanly parse in
//! the format the model was *requested* to use (see
//! [`ParseOutcome::honors`](super::ParseOutcome::honors)). After
//! [`MAX_TOON_FAILURES`] such failures in a row, the requested format flips to JSON;
//! one clean parse resets the streak so the loop settles back to its TOON default.
//!
//! The mechanism is platform-free pure logic: no I/O, no `web-sys`/`gloo`, fully
//! unit-testable on the host. The engine owns *when* to feed it outcomes; this module
//! only owns the escalation rule.

use super::ResponseFormat;

/// Consecutive requested-format parse failures tolerated before the requested format
/// escalates from TOON to JSON.
pub const MAX_TOON_FAILURES: u32 = 3;

/// Pure escalation rule: given the `current` requested format and the number of
/// `consecutive_failures` observed so far, return the format to request next.
///
/// TOON is the default. Once `consecutive_failures` reaches [`MAX_TOON_FAILURES`] the
/// requested format becomes [`ResponseFormat::Json`]. A caller that resets the counter
/// on a successful parse (as [`FormatNegotiator`] does) therefore settles back to TOON.
/// JSON never escalates further — it is the terminal, most-explicit format — so a
/// `current` of JSON is returned unchanged.
pub fn next_format_after_failures(
    current: ResponseFormat,
    consecutive_failures: u32,
) -> ResponseFormat {
    match current {
        // JSON is the most explicit format and the end of the escalation chain.
        ResponseFormat::Json => ResponseFormat::Json,
        ResponseFormat::Toon => {
            if consecutive_failures >= MAX_TOON_FAILURES {
                ResponseFormat::Json
            } else {
                ResponseFormat::Toon
            }
        }
    }
}

/// Stateful counterpart to [`next_format_after_failures`]: holds the consecutive
/// failure counter and derives the [`ResponseFormat`] to request for the next turn.
///
/// Drive it from the loop: call [`record_success`](Self::record_success) when a reply
/// cleanly parsed in the requested format, [`record_failure`](Self::record_failure)
/// when it did not, then read [`format`](Self::format) to learn what to ask for next.
/// Starts at TOON with a zeroed streak.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FormatNegotiator {
    base: ResponseFormat,
    consecutive_failures: u32,
}

impl Default for FormatNegotiator {
    fn default() -> Self {
        Self::new(ResponseFormat::Toon)
    }
}

impl FormatNegotiator {
    /// Start a negotiator at `base` (the agent's configured default) with no failures.
    pub fn new(base: ResponseFormat) -> Self {
        Self {
            base,
            consecutive_failures: 0,
        }
    }

    /// The format to request on the next turn, derived from the failure streak.
    pub fn format(&self) -> ResponseFormat {
        next_format_after_failures(self.base, self.consecutive_failures)
    }

    /// Record that the last reply cleanly honored the requested format: reset the
    /// streak so the requested format relaxes back toward the [`base`](Self::new)
    /// default.
    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
    }

    /// Record that the last reply did NOT cleanly parse in the requested format. The
    /// counter saturates so a very long failure run cannot overflow.
    pub fn record_failure(&mut self) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
    }

    /// Record an outcome expressed as "did the reply honor the requested format":
    /// `true` resets the streak, `false` increments it. Convenience over the two
    /// explicit recorders for call sites that already computed the boolean.
    pub fn record(&mut self, honored_requested_format: bool) {
        if honored_requested_format {
            self.record_success();
        } else {
            self.record_failure();
        }
    }

    /// Current consecutive-failure count, exposed for observability/tests.
    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive_failures
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pure_helper_keeps_toon_below_threshold() {
        // Success and 1–2 consecutive failures all stay on TOON.
        assert_eq!(
            next_format_after_failures(ResponseFormat::Toon, 0),
            ResponseFormat::Toon
        );
        assert_eq!(
            next_format_after_failures(ResponseFormat::Toon, 1),
            ResponseFormat::Toon
        );
        assert_eq!(
            next_format_after_failures(ResponseFormat::Toon, 2),
            ResponseFormat::Toon
        );
    }

    #[test]
    fn pure_helper_escalates_to_json_at_threshold() {
        assert_eq!(
            next_format_after_failures(ResponseFormat::Toon, MAX_TOON_FAILURES),
            ResponseFormat::Json
        );
        assert_eq!(
            next_format_after_failures(ResponseFormat::Toon, MAX_TOON_FAILURES + 5),
            ResponseFormat::Json
        );
    }

    #[test]
    fn pure_helper_json_is_terminal() {
        // JSON never de-escalates back to TOON regardless of the streak.
        assert_eq!(
            next_format_after_failures(ResponseFormat::Json, 0),
            ResponseFormat::Json
        );
        assert_eq!(
            next_format_after_failures(ResponseFormat::Json, MAX_TOON_FAILURES),
            ResponseFormat::Json
        );
    }

    #[test]
    fn negotiator_starts_on_toon() {
        let negotiator = FormatNegotiator::default();
        assert_eq!(negotiator.format(), ResponseFormat::Toon);
        assert_eq!(negotiator.consecutive_failures(), 0);
    }

    #[test]
    fn negotiator_success_keeps_toon() {
        let mut negotiator = FormatNegotiator::default();
        negotiator.record_success();
        assert_eq!(negotiator.format(), ResponseFormat::Toon);
    }

    #[test]
    fn negotiator_one_and_two_failures_keep_toon() {
        let mut negotiator = FormatNegotiator::default();
        negotiator.record_failure();
        assert_eq!(negotiator.format(), ResponseFormat::Toon);
        negotiator.record_failure();
        assert_eq!(negotiator.format(), ResponseFormat::Toon);
    }

    #[test]
    fn negotiator_three_failures_escalate_to_json() {
        let mut negotiator = FormatNegotiator::default();
        negotiator.record_failure();
        negotiator.record_failure();
        negotiator.record_failure();
        assert_eq!(negotiator.format(), ResponseFormat::Json);
    }

    #[test]
    fn negotiator_success_after_failures_resets_to_toon() {
        let mut negotiator = FormatNegotiator::default();
        negotiator.record_failure();
        negotiator.record_failure();
        negotiator.record_failure();
        assert_eq!(negotiator.format(), ResponseFormat::Json);

        // A clean parse resets the streak and relaxes back to the TOON default.
        negotiator.record_success();
        assert_eq!(negotiator.consecutive_failures(), 0);
        assert_eq!(negotiator.format(), ResponseFormat::Toon);
    }

    #[test]
    fn negotiator_record_bool_matches_explicit_recorders() {
        let mut negotiator = FormatNegotiator::default();
        negotiator.record(false);
        negotiator.record(false);
        negotiator.record(false);
        assert_eq!(negotiator.format(), ResponseFormat::Json);
        negotiator.record(true);
        assert_eq!(negotiator.format(), ResponseFormat::Toon);
    }

    #[test]
    fn negotiator_respects_json_base() {
        // An agent configured for JSON stays on JSON; there is nothing to escalate to.
        let mut negotiator = FormatNegotiator::new(ResponseFormat::Json);
        assert_eq!(negotiator.format(), ResponseFormat::Json);
        negotiator.record_failure();
        negotiator.record_failure();
        negotiator.record_failure();
        assert_eq!(negotiator.format(), ResponseFormat::Json);
    }

    #[test]
    fn negotiator_failure_counter_saturates() {
        let mut negotiator = FormatNegotiator::default();
        for _ in 0..10 {
            negotiator.record_failure();
        }
        // Saturated, not overflowed, and still escalated.
        assert!(negotiator.consecutive_failures() >= MAX_TOON_FAILURES);
        assert_eq!(negotiator.format(), ResponseFormat::Json);
    }
}
