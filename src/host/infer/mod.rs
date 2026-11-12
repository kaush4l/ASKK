//! # Inference: how the host reaches a model
//!
//! The engine calls [`crate::core::Infer`] and never learns the provider. Which provider a
//! model name means is **bound at init and at refresh**: the models (manifest key `models`) are
//! read once, and read again only when that key is marked changed — saving on the models page
//! takes effect on the next call, without restart. A file edited by hand, outside the app, is
//! seen at the next start. Sampling (temperature, top_p) comes from the engine's `sampling`
//! element; unset = not sent.
use crate::core::held::Held;
pub mod connectors;
use crate::core::models::Models;

/// `models.json` in the data store (seeded from `defaults/models.json`); empty when missing.
pub async fn load() -> Models {
    crate::core::store::data().get(&crate::core::manifest::manifest().models).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

static BOUND: std::sync::Mutex<Option<(u64, Models)>> = std::sync::Mutex::new(None);

/// The models as bound: read at first use (init), and read again only after the models key is
/// marked changed (refresh — the models page saving, or any write through the store).
fn bound() -> Models {
    use crate::core::changes;
    let key = &crate::core::manifest::manifest().models;
    let read = || crate::core::store::data().get(key).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut b = BOUND.held();
    match b.as_mut() {
        Some((seen, models)) => {
            let (now, keys) = changes::since(*seen);
            if keys.iter().any(|(k, _)| k == key) {
                *models = read();
            }
            *seen = now;
        }
        None => *b = Some((changes::now(), read())),
    }
    b.as_ref().map(|(_, m)| m.clone()).unwrap_or_default()
}

/// The engine-facing runtime: the engine names a model and never learns the provider.
pub struct ModelsInfer;

impl crate::core::Infer for ModelsInfer {
    fn complete(&self, model: &str, prompt: String, sampling: crate::core::Sampling) -> crate::core::Fut<Result<String, String>> {
        let model = crate::core::param::model(model);
        Box::pin(async move {
            let m = bound().find(&model).ok_or_else(|| format!("no model named '{model}' (and no default)"))?.clone();
            connectors::complete(&m, &prompt, &sampling).await
        })
    }
    fn complete_with(&self, model: &str, prompt: String, sampling: crate::core::Sampling, media: Vec<crate::core::media::Attachment>) -> crate::core::Fut<Result<String, String>> {
        let model = crate::core::param::model(model);
        Box::pin(async move {
            let m = bound().find(&model).ok_or_else(|| format!("no model named '{model}' (and no default)"))?.clone();
            connectors::complete_with(&m, &prompt, &sampling, &media).await
        })
    }
    fn stream(&self, model: &str, prompt: String, sampling: crate::core::Sampling, media: Vec<crate::core::media::Attachment>, said: crate::core::Said) -> crate::core::Fut<Result<String, String>> {
        let model = crate::core::param::model(model);
        Box::pin(async move {
            let m = bound().find(&model).ok_or_else(|| format!("no model named '{model}' (and no default)"))?.clone();
            connectors::stream(&m, &prompt, &sampling, &media, Some(&said)).await
        })
    }
    fn context(&self, model: &str) -> crate::core::Fut<usize> {
        let model = crate::core::param::model(model);
        Box::pin(async move {
            match bound().find(&model) {
                // Input budget: the window holds prompt and reply, so the reply cap comes off.
                Some(m) => (connectors::context(m).await as usize).saturating_sub(m.max_tokens as usize),
                None => 0,
            }
        })
    }
}
