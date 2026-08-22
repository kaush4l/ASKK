//! The four SMALL browser ports (`crates/adapters_web/src/ports.rs`), executed
//! (I17). Three of them are one-line adapters over a browser API and the fourth
//! is the default-deny allowlist that I2 and I6 are actually made of — and
//! until this file, "an empty list denies everything" was a sentence in a doc
//! comment with nothing behind it.

use adapters_web::{sleep, BrowserClock, BrowserRng, FetchNet};
use kernel::{BrokeredRequest, ClockPort, EndpointName, NetError, NetPort, RngPort};
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_browser);

fn get(path: &str) -> BrokeredRequest {
    BrokeredRequest {
        method: "GET".into(),
        path: path.into(),
        body: None,
    }
}

/// THE ALLOWLIST IS THE GATE, and a name is the only thing a caller can hand
/// it. Port 9 (discard) is the destination for the middle leg: nothing listens
/// there, so the call fails — but it fails as `Transport`, which is the proof
/// that the request LEFT, and that the first and third legs failed for a
/// different reason than "the network is down".
#[wasm_bindgen_test]
async fn a_broker_born_empty_denies_by_name_and_forgets_a_cleared_endpoint() {
    let net = FetchNet::new();
    let search = EndpointName("search".into());

    match net.fetch(&search, get("/q")).await {
        Err(NetError::Denied { endpoint }) => assert_eq!(endpoint, "search"),
        other => panic!("a fresh broker must deny: {other:?}"),
    }

    net.allow("search", "http://127.0.0.1:9");
    match net.fetch(&search, get("/q")).await {
        Err(NetError::Transport { .. }) => {}
        other => panic!("an allowed name is dialled, not denied: {other:?}"),
    }

    // Clearing the setting must take the destination OFF the list, not leave an
    // empty base that every path is appended to (`ports.rs:50-58`).
    net.allow("search", "   ");
    match net.fetch(&search, get("/q")).await {
        Err(NetError::Denied { .. }) => {}
        other => panic!("a cleared endpoint is denied again: {other:?}"),
    }
}

/// The broker sends no request body, and says so instead of dropping it
/// (`ports.rs:88-92`) — a silent drop is a search that quietly asks the wrong
/// question. Checked on an ALLOWED name, so the refusal cannot be the
/// allowlist's.
#[wasm_bindgen_test]
async fn the_broker_refuses_a_request_body_rather_than_dropping_it() {
    let net = FetchNet::new();
    net.allow("search", "http://127.0.0.1:9");
    let with_body = BrokeredRequest {
        method: "POST".into(),
        path: "/q".into(),
        body: Some(b"q=tin".to_vec()),
    };
    match net.fetch(&EndpointName("search".into()), with_body).await {
        Err(NetError::Transport { message }) => {
            assert!(message.contains("no request body"), "{message}")
        }
        other => panic!("{other:?}"),
    }
}

/// `crypto.getRandomValues` is REACHED, not merely called. A `fill` that
/// silently did nothing — no window, a `get_random_values` that threw, the
/// `let _ =` on `ports.rs:172` swallowing it — leaves the caller's buffer as it
/// found it, and every id the system mints becomes the same id.
#[wasm_bindgen_test]
fn the_rng_fills_the_buffer_it_was_given_and_not_with_zeroes() {
    let mut first = [0u8; 32];
    let mut second = [0u8; 32];
    BrowserRng.fill(&mut first);
    BrowserRng.fill(&mut second);

    assert!(first.iter().any(|b| *b != 0), "the buffer came back untouched");
    assert_ne!(first, second, "two draws from a real CSPRNG are not equal");
}

/// The clock reads MILLISECONDS since the epoch, and `sleep` actually waits.
/// Two claims, one test, because neither is checkable without the other: a
/// clock nothing advances past cannot be told from a constant, and a `sleep`
/// that returned immediately would be invisible without a clock to measure it.
#[wasm_bindgen_test]
async fn the_clock_is_epoch_milliseconds_and_sleep_advances_it() {
    let before = BrowserClock.now().0;
    // 2020-01-01 in ms. In SECONDS this is 1.58e9 — the off-by-1000 that makes
    // every timestamp in the log read as 1970.
    assert!(before > 1_577_836_800_000, "not epoch milliseconds: {before}");

    sleep(50).await.expect("sleep resolves");

    let after = BrowserClock.now().0;
    assert!(after - before >= 40, "sleep(50) advanced the clock by {}ms", after - before);
}
