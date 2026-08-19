//! The Settings pane's door to the credential broker. Deliberately NOT on the
//! seam: `core::handle` records an Event for every request (I8), and an event
//! log is exactly where a credential must never appear (ADR-006, I6).
//! `lib.rs` builds the broker; this is the only file that repoints it.

use crate::{WebApp, WebError};

impl WebApp {
    /// Point the model broker at an endpoint and persist the profile. NOT on
    /// the seam, deliberately: `handle` writes an Event for every request
    /// (I8), and an event log is exactly where a credential must never
    /// appear. The base URL and key go straight from the settings pane to the
    /// broker and to `config/keys/model` in IndexedDB — the core is not told.
    ///
    /// PROVISIONAL (ADR-006 secret storage, Option A): the record is plain in
    /// IndexedDB. Option B (WebCrypto-wrapped at rest) is a HUMAN GATE and is
    /// one adapter file away; the UI states the trust model where keys are
    /// entered.
    /// `api_key: None` means "leave the stored key alone" — the settings field
    /// is write-only, so a blank field must not wipe a saved secret. `entry`
    /// is the catalogue key the user picked; `base_url`/`model` are their
    /// override of it, blank meaning "whatever models.json says".
    pub async fn set_endpoint(
        &self,
        entry: &str,
        base_url: &str,
        api_key: Option<&str>,
        model: &str,
    ) -> Result<(), WebError> {
        self.model.set_endpoint(entry, base_url, api_key, model);
        kernel::StorePort::kv(self.store.as_ref())
            .put(self.model.profile_key(), &self.model.profile_json())
            .await
            .map_err(WebError::Store)
    }

    /// Where `web_search` may go, and the ONLY way this build gets an entry on
    /// the network allowlist (increment 21). Same door as `set_endpoint` and
    /// the same record, so a Worker boots with it; the broker is repointed in
    /// the same breath because a setting that needs a reload to take effect is
    /// a setting the page lies about.
    ///
    /// A blank URL clears it, which takes `search` OFF the allowlist — turning
    /// the capability off has to be as available as turning it on (I10).
    pub async fn set_search_endpoint(&self, base_url: &str) -> Result<(), WebError> {
        self.model.set_search(base_url);
        self.net.allow(kernel::SEARCH_ENDPOINT, &self.model.search_url());
        // A sub-agent was handed this record at boot and cannot learn a new
        // one — the same reason saving an endpoint restarts them.
        self.restart_agents();
        kernel::StorePort::kv(self.store.as_ref())
            .put(self.model.profile_key(), &self.model.profile_json())
            .await
            .map_err(WebError::Store)
    }

    /// What Settings shows in that field: the saved base URL, or empty.
    pub fn search_endpoint(&self) -> String {
        self.model.search_url()
    }

    /// The current entry's base URL, whether a key is set, the model name, and
    /// the env var the Python reads for it — never the key.
    pub fn endpoint_summary(&self) -> (String, bool, String, String) {
        self.model.endpoint_summary()
    }

    /// The catalogue: every entry name, which one is current, and what a named
    /// entry resolves to (so Settings can prefill when the pick changes).
    pub fn catalogue_names(&self) -> Vec<String> {
        self.model.catalogue_names()
    }

    pub fn current_entry(&self) -> String {
        self.model.current_entry()
    }

    pub fn entry_fields(&self, name: &str) -> (String, String, String) {
        self.model.entry_fields(name)
    }

    /// Per-entry facts Settings needs the moment the pick changes: does THIS
    /// entry have a key, and can this build call it at all.
    pub fn entry_has_key(&self, name: &str) -> bool {
        self.model.entry_has_key(name)
    }

    pub fn entry_problem(&self, name: &str) -> Option<String> {
        self.model.entry_problem(name)
    }

    /// What the catalogue says about an entry, and whether it is the browser's
    /// own model: `(note, on_device)`.
    pub fn entry_note(&self, name: &str) -> (String, bool) {
        self.model.entry_note(name)
    }

    /// Back to the shipped catalogue, and persist that. Same door as
    /// `set_endpoint` — the core is not told, because keys are not its business.
    pub async fn reset_endpoint(&self) -> Result<(), WebError> {
        self.model.reset();
        // The search endpoint is in that record too, so forgetting it has to
        // take it off the allowlist as well — a broker still pointing at a
        // destination the record no longer holds is the reset half-done.
        self.net.allow(kernel::SEARCH_ENDPOINT, "");
        kernel::StorePort::kv(self.store.as_ref())
            .put(self.model.profile_key(), &self.model.profile_json())
            .await
            .map_err(WebError::Store)
    }
}
