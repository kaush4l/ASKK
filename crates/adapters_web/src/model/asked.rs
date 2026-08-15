//! WHAT SETTINGS ASKS THE BROKER — every question and every instruction about
//! the CHOICE of endpoint, as against `model.rs`, which puts bytes on the wire
//! and attaches the credential. Split for the 200-line rule (I12) when the
//! broker learned to answer what a call would really resolve to (21).
//!
//! Not one of these touches the network or reads a key out: `api_key_for` stays
//! in `model.rs`, next to the only code that may use it, which is the I6
//! property the whole file arrangement exists to keep.

use super::FetchModel;

impl FetchModel {
    /// The storage key of the profile — the composition root persists there.
    pub fn profile_key(&self) -> &str {
        &self.profile_key
    }

    /// Install `public/models.json` — the shipped catalogue, before the
    /// user's stored layer goes on top of it.
    pub fn set_catalogue(&self, raw: &str) {
        self.endpoint.borrow_mut().set_catalogue(raw);
    }

    /// Pick a catalogue entry and override it. A `None` key keeps the stored
    /// one (`Endpoint::set`), which is what stops Save wiping a secret the
    /// write-only field never held.
    pub fn set_endpoint(&self, entry: &str, base_url: &str, api_key: Option<&str>, model: &str) {
        let mut e = self.endpoint.borrow_mut();
        e.select(entry);
        e.set(base_url, api_key, model);
    }

    /// The catalogue entry names, and which one is current.
    pub fn catalogue_names(&self) -> Vec<String> {
        self.endpoint.borrow().names()
    }

    pub fn current_entry(&self) -> String {
        self.endpoint.borrow().current()
    }

    /// What one named entry resolves to today — `(base_url, model, api_key_env)`,
    /// so Settings can prefill the fields when the selection changes.
    pub fn entry_fields(&self, name: &str) -> (String, String, String) {
        self.endpoint
            .borrow()
            .catalogue()
            .resolve(name)
            .map(|e| (e.base_url, e.model, e.api_key_env))
            .unwrap_or_default()
    }

    /// Whether THAT entry has a key of its own — keys are per entry, so the
    /// question only makes sense with a name attached.
    pub fn entry_has_key(&self, name: &str) -> bool {
        self.endpoint.borrow().has_key(name)
    }

    /// Why this build cannot call that entry, if it cannot — asked when the
    /// entry is PICKED, so the pane refuses at selection rather than promising
    /// a call that fails one send later (`ux-walker`, increment 04).
    pub fn entry_problem(&self, name: &str) -> Option<String> {
        let c = self.endpoint.borrow().catalogue();
        match c.resolve(name)?.chat_url() {
            Ok(_) => None,
            Err(kernel::ModelError::Unsupported { detail }) => Some(detail),
            Err(e) => Some(format!("{e:?}")),
        }
    }

    /// Where a web search goes (increment 21). It rides in this record because
    /// this record is what a Worker boots from — the broker does not call it,
    /// `FetchNet` does, and this is only where the setting is kept.
    pub fn search_url(&self) -> String {
        self.endpoint.borrow().search().to_string()
    }

    pub fn set_search(&self, base_url: &str) {
        self.endpoint.borrow_mut().set_search(base_url);
    }

    /// Forget the pick, the overrides and every saved key.
    pub fn reset(&self) {
        self.endpoint.borrow_mut().reset();
    }

    pub fn profile_json(&self) -> String {
        self.endpoint.borrow().profile_json()
    }

    pub fn load_profile(&self, raw: &str) {
        self.endpoint.borrow_mut().load_profile(raw);
    }

    /// The base URL, whether a key is set, the model name, and the env var the
    /// Python reads for this entry — never the key itself.
    pub fn endpoint_summary(&self) -> (String, bool, String, String) {
        self.endpoint.borrow().summary()
    }
}
