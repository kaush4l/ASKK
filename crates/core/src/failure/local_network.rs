//! WHAT A LOCAL ADDRESS COSTS A PAGE THAT IS NOT LOCAL. `what_to_do` picks the
//! variant; the two sentences that turn on WHERE the endpoint lives are written
//! here, because they are the ones with a second browser in them and they had
//! outgrown the file that chose them (I12).

/// The endpoint could not be reached, and what to check depends on where it is.
pub(crate) fn unreachable_line(url: &str) -> String {
    match kernel::is_loopback(url) {
        true => "The model endpoint could not be reached. Check the endpoint in \
                 Settings: it is an address on THIS machine, so the server must be \
                 running, it must send CORS headers, and Chrome 142+ asks permission \
                 before a page may call a local address."
            .to_string(),
        false => "The model endpoint could not be reached. Check the base URL in \
                  Settings: the host must resolve and answer from this browser, and it \
                  must send CORS headers allowing this page's origin."
            .to_string(),
    }
}

/// OUR OWN DEFAULT, TOLD THE TRUTH (28). `main` ships `model: local` and the
/// catalogue points `local` at `127.0.0.1`, so the very first turn a person
/// takes on the hosted page is a cross-address-space call. Until now it failed
/// as `Transport` and said "the server must be running" about a server that
/// was.
///
/// The sentence names both engines and does not ask which one is reading it.
/// Nothing in this codebase sniffs a user agent — the only "can this browser do
/// X" mechanisms here are feature probes (I15) — and there is no probe for this
/// one: the fetch that would answer the question IS the failure. So it states
/// both truths and lets the reader recognise their own, which costs one clause
/// and buys a claim that is never wrong.
pub(crate) fn local_network(url: &str, origin: &str) -> String {
    format!(
        "This page is served from {origin} and this turn called {url}, an address on the \
         machine in front of you. A page on the web reaching a local address is governed by \
         Local Network Access, and the two engines answer it differently. Chrome 142+ asks \
         permission first, and the call goes through only if it is granted — a prompt that was \
         denied or dismissed then fails exactly as a closed port does, which is why nothing \
         appeared to happen at all. Safari has never allowed a page on the web to call a local \
         address and does not ask, so from {origin} this endpoint cannot work there. Two things \
         fix it: open this page from localhost, where the page and the server are the same \
         address space and no permission is involved on any browser, or point Settings at an \
         endpoint reachable from the web. One limit either way — a delegated sub-agent runs in \
         a Worker, and a Worker never has the user activation a permission prompt requires, so \
         a sub-agent's own call can never answer one even after you have granted the page's."
    )
}
