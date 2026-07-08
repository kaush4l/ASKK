//! RunHost: the shell seam (ADR-009/011). The runtime asks the host for
//! time, sleep, interrupt state, and hands it every stamped signal as the
//! live delta sink. The log write happens in the session, not here.

use std::cell::{Cell, RefCell};

use askk_core::Signal;

use crate::actions::PendingActions;
use crate::state::LocalBoxFuture;

pub trait RunHost {
    /// Polled at every owned wait (turn start). True = stop the run.
    fn interrupted(&self) -> bool;

    /// Called when a run parks on a confirmation — the UI's cue to surface
    /// the pending action. Default: nothing to do.
    fn confirm_ready(&self, _pending: &PendingActions) {}

    /// Live sink for UI deltas; every stamped signal passes through here.
    fn on_signal(&self, signal: &Signal);

    fn now_ms(&self) -> u64;

    /// Retry backoff. Hosts own the wait (ADR-011); tests return ready.
    fn sleep(&self, ms: u64) -> LocalBoxFuture<'_, ()>;
}

/// Deterministic host for workflow tests: records signals, sleeps are
/// instant, the clock ticks by 1ms per read, interrupts fire on a script.
#[derive(Default)]
pub struct TestHost {
    signals: RefCell<Vec<Signal>>,
    slept_ms: RefCell<Vec<u64>>,
    /// `Some(n)`: `interrupted()` returns false for the first n calls, then true.
    interrupt_after: Cell<Option<u32>>,
    checks: Cell<u32>,
    confirms: Cell<u32>,
    now: Cell<u64>,
}

impl TestHost {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn interrupt_after(&self, checks: u32) {
        self.interrupt_after.set(Some(checks));
    }

    pub fn signals(&self) -> Vec<Signal> {
        self.signals.borrow().clone()
    }

    pub fn slept_ms(&self) -> Vec<u64> {
        self.slept_ms.borrow().clone()
    }

    pub fn confirm_calls(&self) -> u32 {
        self.confirms.get()
    }
}

impl RunHost for TestHost {
    fn interrupted(&self) -> bool {
        let seen = self.checks.get();
        self.checks.set(seen + 1);
        match self.interrupt_after.get() {
            Some(after) => seen >= after,
            None => false,
        }
    }

    fn confirm_ready(&self, _pending: &PendingActions) {
        self.confirms.set(self.confirms.get() + 1);
    }

    fn on_signal(&self, signal: &Signal) {
        self.signals.borrow_mut().push(signal.clone());
    }

    fn now_ms(&self) -> u64 {
        let now = self.now.get() + 1;
        self.now.set(now);
        now
    }

    fn sleep(&self, ms: u64) -> LocalBoxFuture<'_, ()> {
        self.slept_ms.borrow_mut().push(ms);
        Box::pin(async {})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::block_on;
    use askk_core::SignalKind;

    #[test]
    fn interrupt_script_fires_after_n_checks() {
        let host = TestHost::new();
        assert!(!host.interrupted());
        assert!(!host.interrupted());
        host.interrupt_after(3);
        assert!(!host.interrupted()); // third check
        assert!(host.interrupted()); // fourth: past the script
        assert!(host.interrupted()); // sticky
    }

    #[test]
    fn records_signals_sleeps_and_ticks() {
        let host = TestHost::new();
        host.on_signal(&Signal::unstamped(SignalKind::LlmRequest));
        assert_eq!(host.signals().len(), 1);
        block_on(host.sleep(250));
        assert_eq!(host.slept_ms(), vec![250]);
        assert!(host.now_ms() < host.now_ms()); // monotonic ticking clock
    }
}
