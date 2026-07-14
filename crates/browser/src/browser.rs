//! `BrowserHost`: the wasm `RunHost` (ADR-009/011). Time = `Date.now`,
//! sleep = a hand-rolled `setTimeout` future, and every stamped signal is
//! cloned into a shared buffer + a notify callback (the UI bumps a Dioxus
//! signal counter there and refolds).

#[cfg(target_arch = "wasm32")]
pub use imp::BrowserHost;

#[cfg(target_arch = "wasm32")]
mod imp {
    use std::cell::RefCell;
    use std::rc::Rc;

    use askk_core::Signal;
    use askk_engine::run::RunHost;
    use askk_engine::state::LocalBoxFuture;
    use wasm_bindgen_futures::JsFuture;

    pub struct BrowserHost {
        signals: Rc<RefCell<Vec<Signal>>>,
        notify: Box<dyn Fn()>,
        /// Cross-tab mirror (ADR-031): every stamped signal is also handed
        /// here; the bus broadcasts it to the other tabs of this origin.
        tap: Box<dyn Fn(&Signal)>,
    }

    impl BrowserHost {
        /// `signals` is shared with the facade (the UI's live fold source);
        /// `notify` is called after every push (bump a Dioxus counter);
        /// `tap` sees each stamped signal (cross-tab publish).
        pub fn new(
            signals: Rc<RefCell<Vec<Signal>>>,
            notify: Box<dyn Fn()>,
            tap: Box<dyn Fn(&Signal)>,
        ) -> Self {
            Self {
                signals,
                notify,
                tap,
            }
        }
    }

    impl RunHost for BrowserHost {
        fn interrupted(&self) -> bool {
            // ponytail: no UI interrupt source yet; cancel is session-level.
            false
        }

        fn on_signal(&self, signal: &Signal) {
            self.signals.borrow_mut().push(signal.clone());
            (self.tap)(signal);
            (self.notify)();
        }

        fn now_ms(&self) -> u64 {
            js_sys::Date::now() as u64
        }

        fn sleep(&self, ms: u64) -> LocalBoxFuture<'_, ()> {
            Box::pin(async move {
                let promise = js_sys::Promise::new(&mut |resolve, _reject| {
                    if let Some(window) = web_sys::window() {
                        let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
                            &resolve,
                            i32::try_from(ms).unwrap_or(i32::MAX),
                        );
                    }
                });
                let _ = JsFuture::from(promise).await;
            })
        }
    }
}
