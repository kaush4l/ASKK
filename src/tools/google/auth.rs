//! Google OAuth PKCE helpers.
//!
//! Pure helpers (base64url, query parsing, token validity) are always compiled
//! and unit-testable on the host. WASM-specific helpers (SubtleCrypto,
//! sessionStorage, fetch) are behind `#[cfg(target_arch = "wasm32")]`.
//!
//! The constants and pure functions below are called from WASM paths only;
//! `#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]` suppresses
//! the lint on host builds while keeping them available to tests.

// ── Constants ────────────────────────────────────────────────────────────

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const SESSION_VERIFIER_KEY: &str = "askk_pkce_verifier";
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const SESSION_STATE_KEY: &str = "askk_oauth_state";
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const GOOGLE_SCOPES: &str = "https://www.googleapis.com/auth/gmail.readonly \
     https://www.googleapis.com/auth/calendar.readonly";

// ── Pure helpers (host-testable) ──────────────────────────────────────────

/// Base64url-encode `input` with no padding (RFC 4648 §5).
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn base64url_encode(input: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() * 4).div_ceil(3));
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[((b0 & 3) << 4 | b1 >> 4) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((b1 & 0xf) << 2 | b2 >> 6) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0x3f) as usize] as char);
        }
    }
    out.replace('+', "-").replace('/', "_")
}

/// True if `token` is non-empty and does not expire within the next 5 minutes.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn is_token_valid(token: &str, token_expiry_ms: u64, now_ms: u64) -> bool {
    !token.is_empty()
        && token_expiry_ms > 0
        && now_ms < token_expiry_ms.saturating_sub(5 * 60 * 1000)
}

/// Extract a single query-parameter value from a `?k=v&...` string.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn parse_query_param(search: &str, key: &str) -> Option<String> {
    for pair in search.trim_start_matches('?').split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some(key) {
            return parts.next().map(percent_decode);
        }
    }
    None
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(n) = u8::from_str_radix(hex, 16) {
                out.push(n as char);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            out.push(' ');
            i += 1;
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

// ── WASM-only helpers ─────────────────────────────────────────────────────

#[cfg(target_arch = "wasm32")]
pub fn current_time_ms() -> u64 {
    js_sys::Date::now() as u64
}

/// Returns the app's current origin (e.g. "http://localhost:8080").
#[cfg(target_arch = "wasm32")]
pub fn current_origin() -> String {
    web_sys::window()
        .and_then(|w| w.location().origin().ok())
        .unwrap_or_else(|| "http://localhost:8080".into())
}

/// Generate a 64-byte random PKCE code verifier using the browser's CSPRNG.
#[cfg(target_arch = "wasm32")]
pub async fn generate_verifier() -> Result<String, String> {
    use js_sys::Uint8Array;
    use wasm_bindgen::JsCast;
    let win = web_sys::window().ok_or("no window")?;
    let crypto = win.crypto().map_err(|e| format!("no crypto: {e:?}"))?;
    let array = Uint8Array::new_with_length(64);
    crypto
        .get_random_values_with_array_buffer_view(array.unchecked_ref())
        .map_err(|e| format!("getRandomValues: {e:?}"))?;
    Ok(base64url_encode(&array.to_vec()))
}

/// Derive PKCE code challenge: SHA-256(verifier) → base64url.
#[cfg(target_arch = "wasm32")]
pub async fn derive_challenge(verifier: &str) -> Result<String, String> {
    use js_sys::Uint8Array;
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::JsFuture;
    let win = web_sys::window().ok_or("no window")?;
    let subtle = win.crypto().map_err(|_| "no crypto")?.subtle();
    let data = Uint8Array::from(verifier.as_bytes());
    let promise = subtle
        .digest_with_str_and_buffer_source("SHA-256", data.unchecked_ref())
        .map_err(|e| format!("digest: {e:?}"))?;
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| format!("digest await: {e:?}"))?;
    Ok(base64url_encode(&Uint8Array::new(&result).to_vec()))
}

/// Build the Google authorization URL, storing the PKCE verifier in sessionStorage.
#[cfg(target_arch = "wasm32")]
pub async fn build_auth_url(client_id: &str, redirect_uri: &str) -> Result<String, String> {
    let verifier = generate_verifier().await?;
    let challenge = derive_challenge(&verifier).await?;
    let state = uuid::Uuid::new_v4().to_string();

    let win = web_sys::window().ok_or("no window")?;
    let session = win
        .session_storage()
        .map_err(|_| "no session_storage")?
        .ok_or("session storage unavailable")?;
    session
        .set_item(SESSION_VERIFIER_KEY, &verifier)
        .map_err(|_| "store verifier")?;
    session
        .set_item(SESSION_STATE_KEY, &state)
        .map_err(|_| "store state")?;

    let scopes = GOOGLE_SCOPES.replace(' ', "%20").replace('/', "%2F");
    Ok(format!(
        "{GOOGLE_AUTH_URL}?client_id={client_id}\
         &redirect_uri={redirect_uri}&response_type=code&scope={scopes}\
         &code_challenge={challenge}&code_challenge_method=S256\
         &access_type=online&state={state}"
    ))
}

/// If the current URL contains `?code=`, exchange it for tokens and clean the URL.
/// Returns `(access_token, expiry_ms)` or `None`.
#[cfg(target_arch = "wasm32")]
pub async fn handle_oauth_callback(client_id: &str, redirect_uri: &str) -> Option<(String, u64)> {
    let win = web_sys::window()?;
    let search = win.location().search().ok()?;
    if !search.contains("code=") {
        return None;
    }

    let code = parse_query_param(&search, "code")?;
    let returned_state = parse_query_param(&search, "state");
    let session = win.session_storage().ok()??;
    let stored_state = session.get_item(SESSION_STATE_KEY).ok()??;

    if returned_state.as_deref() != Some(stored_state.as_str()) {
        web_sys::console::error_1(&"Google OAuth: state mismatch".into());
        return None;
    }
    let verifier = session.get_item(SESSION_VERIFIER_KEY).ok()??;
    let _ = session.remove_item(SESSION_VERIFIER_KEY);
    let _ = session.remove_item(SESSION_STATE_KEY);

    // Clean the URL
    if let Ok(history) = win.history() {
        let _ =
            history.replace_state_with_url(&wasm_bindgen::JsValue::NULL, "", Some(redirect_uri));
    }
    exchange_code(client_id, redirect_uri, &code, &verifier).await
}

#[cfg(target_arch = "wasm32")]
async fn exchange_code(
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Option<(String, u64)> {
    use gloo_net::http::Request;
    let body = format!(
        "grant_type=authorization_code&client_id={client_id}\
         &redirect_uri={redirect_uri}&code={code}&code_verifier={verifier}"
    );
    let resp = Request::post(GOOGLE_TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .ok()?
        .send()
        .await
        .ok()?;
    if !resp.ok() {
        web_sys::console::error_1(&format!("Token exchange {}", resp.status()).into());
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    let token = json.get("access_token")?.as_str()?.to_string();
    let expires_in = json.get("expires_in")?.as_u64().unwrap_or(3600);
    Some((token, current_time_ms() + expires_in * 1000))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_encodes_known_value() {
        assert_eq!(base64url_encode(b"Man"), "TWFu");
    }

    #[test]
    fn base64url_no_padding_or_unsafe_chars() {
        let bytes: Vec<u8> = (0u8..=255u8).collect();
        let enc = base64url_encode(&bytes);
        assert!(!enc.contains('+'));
        assert!(!enc.contains('/'));
        assert!(!enc.contains('='));
    }

    #[test]
    fn token_valid_when_not_expired() {
        assert!(is_token_valid("tok", 9_999_999_999_000, 1_000_000_000_000));
    }

    #[test]
    fn token_invalid_when_empty() {
        assert!(!is_token_valid("", 9_999_999_999_000, 1_000_000_000_000));
    }

    #[test]
    fn token_invalid_within_5_min_buffer() {
        let now = 1_000_000_000_000_u64;
        assert!(!is_token_valid("tok", now + 4 * 60 * 1000, now));
    }

    #[test]
    fn parse_query_extracts_code() {
        assert_eq!(
            parse_query_param("?code=AUTH123&state=abc", "code"),
            Some("AUTH123".into())
        );
    }

    #[test]
    fn parse_query_returns_none_for_missing_key() {
        assert!(parse_query_param("?state=abc", "code").is_none());
    }
}
