//! Cross-tab signal bus (ADR-031): every stamped signal is mirrored to the
//! other tabs of this origin over a `BroadcastChannel`; received foreign
//! signals join the live buffer, so foreign runs render exactly like
//! delegate runs observed mid-drive, and the notify refold re-reads the
//! shared OPFS board/artifacts. Mirror, not control — a tab owns only the
//! runs it submitted.

#[cfg(any(target_arch = "wasm32", test))]
use askk_core::Signal;

/// Wire envelope (pure, host-testable): `{tab, signal}` as one JSON string.
#[cfg(any(target_arch = "wasm32", test))]
pub fn encode(tab: &str, signal: &Signal) -> Option<String> {
    serde_json::to_string(&serde_json::json!({ "tab": tab, "signal": signal })).ok()
}

/// Decodes an envelope, dropping echoes from `own_tab` and anything
/// malformed (a foreign tab on a newer build must not wedge this one).
#[cfg(any(target_arch = "wasm32", test))]
pub fn decode(text: &str, own_tab: &str) -> Option<Signal> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    if v.get("tab")?.as_str()? == own_tab {
        return None;
    }
    serde_json::from_value(v.get("signal")?.clone()).ok()
}

#[cfg(target_arch = "wasm32")]
pub use imp::wire;

#[cfg(target_arch = "wasm32")]
mod imp {
    use std::cell::RefCell;
    use std::rc::Rc;

    use askk_core::Signal;
    use wasm_bindgen::prelude::*;
    use wasm_bindgen::JsCast;

    /// Boot glue: returns `(tap, notify)` for `BrowserHost` — the tap
    /// broadcasts local signals (and owns the Bus); foreign signals join
    /// `buffer` + fire `notify`. Bus unavailable → a no-op tap (solo tab).
    #[allow(clippy::type_complexity)]
    pub fn wire(
        buffer: Rc<RefCell<Vec<Signal>>>,
        notify: Box<dyn Fn()>,
    ) -> (Box<dyn Fn(&Signal)>, Box<dyn Fn()>) {
        let notify: Rc<dyn Fn()> = Rc::from(notify);
        let bus = {
            let buffer = buffer.clone();
            let notify = notify.clone();
            Bus::new(Box::new(move |signal| {
                buffer.borrow_mut().push(signal);
                notify();
            }))
        };
        let tap: Box<dyn Fn(&Signal)> = match bus {
            Some(bus) => Box::new(move |s: &Signal| bus.publish(s)),
            None => Box::new(|_| {}),
        };
        (tap, Box::new(move || notify()))
    }

    const CHANNEL: &str = "askk-signals";

    pub struct Bus {
        channel: web_sys::BroadcastChannel,
        tab: String,
        // Keeps the onmessage closure alive for the Bus's lifetime.
        _onmessage: Closure<dyn FnMut(web_sys::MessageEvent)>,
    }

    impl Bus {
        /// `deliver` receives every foreign signal (echoes already dropped).
        /// None when BroadcastChannel is unavailable — the app runs solo.
        pub fn new(deliver: Box<dyn Fn(Signal)>) -> Option<Bus> {
            let channel = web_sys::BroadcastChannel::new(CHANNEL).ok()?;
            let tab = format!(
                "tab-{:08x}",
                (js_sys::Math::random() * f64::from(u32::MAX)) as u32
            );
            let own = tab.clone();
            let onmessage = Closure::wrap(Box::new(move |ev: web_sys::MessageEvent| {
                if let Some(text) = ev.data().as_string() {
                    if let Some(signal) = super::decode(&text, &own) {
                        deliver(signal);
                    }
                }
            }) as Box<dyn FnMut(web_sys::MessageEvent)>);
            channel.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));
            Some(Bus {
                channel,
                tab,
                _onmessage: onmessage,
            })
        }

        pub fn publish(&self, signal: &Signal) {
            if let Some(text) = super::encode(&self.tab, signal) {
                let _ = self.channel.post_message(&JsValue::from_str(&text));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use askk_core::{Signal, SignalKind};

    use super::*;

    fn signal() -> Signal {
        Signal {
            seq: 3,
            run_id: askk_core::RunId("run-9".into()),
            ts_ms: 7,
            kind: SignalKind::LlmRequest,
        }
    }

    #[test]
    fn envelope_round_trips_and_drops_echoes() {
        let text = encode("tab-a", &signal()).unwrap();
        // Echo from the same tab is swallowed.
        assert!(decode(&text, "tab-a").is_none());
        // A foreign tab gets the signal back intact.
        let got = decode(&text, "tab-b").unwrap();
        assert_eq!(got.run_id.0, "run-9");
        assert_eq!(got.seq, 3);
    }

    #[test]
    fn malformed_envelopes_are_ignored() {
        assert!(decode("not json", "tab-a").is_none());
        assert!(decode("{\"tab\": 3}", "tab-a").is_none());
        assert!(decode("{\"tab\": \"x\", \"signal\": {\"nope\": 1}}", "tab-a").is_none());
    }
}
