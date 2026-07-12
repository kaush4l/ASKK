//! Host-target bootstrap — split from `boot.rs` to stay under the ADR-012
//! file-size cap; a `#[path]` child module keeps the same privacy access as
//! an inline `mod` (same trick as `boot_tests.rs`).

use super::*;

/// Host bootstrap: memory stores + a scripted `MockProvider` — the living
/// smoke session `main` drives (and tests assert on).
pub async fn host_session() -> Result<HarnessHandle, String> {
    use askk_core::Provider;
    use askk_inference::{MockProvider, MockTransport};
    use askk_runtime::run::TestHost;
    use askk_runtime::state::{BlobStore, MemBlob, MemKv};

    let kv: Rc<dyn KvStore> = Rc::new(MemKv::new());
    let blobs: Rc<dyn BlobStore> = Rc::new(MemBlob::new());
    let (log, _replayed) = SignalLog::open(blobs.clone(), Box::new(|| 0))
        .await
        .map_err(|e| e.to_string())?;
    let mut registry = ToolRegistry::new();
    register_builtins(&mut registry, || 7).map_err(|e| e.to_string())?;
    let searxng = Rc::new(RefCell::new(String::new()));
    register_web_search(
        &mut registry,
        Rc::new(MockTransport::new()),
        searxng.clone(),
    )
    .map_err(|e| e.to_string())?;
    register_knowledge(&mut registry, kv.clone(), || 7).map_err(|e| e.to_string())?;
    register_memory_tools(&mut registry, kv.clone(), || 7).map_err(|e| e.to_string())?;
    register_board(&mut registry, kv.clone()).map_err(|e| e.to_string())?;
    register_artifacts(&mut registry, blobs.clone(), || 7).map_err(|e| e.to_string())?;
    let shell_exec = Rc::new(crate::host::vm::SerialShell::new());
    register_shell(&mut registry, shell_exec.clone()).map_err(|e| e.to_string())?;
    register_workspace(&mut registry, shell_exec).map_err(|e| e.to_string())?;
    // Seam parity with the wasm boot: no MCP servers configured on the host.
    let _ = register_mcp(&mut registry, Rc::new(MockTransport::new()), &[]).await;
    crate::host::config::register_baked_tools(&mut registry);

    let mock = Rc::new(MockProvider::new("default/mock"));
    mock.push_text("action: tool\nanswer: {\"name\": \"echo\", \"arguments\": {\"text\": \"hello from the harness\"}}");
    mock.push_text("action: answer\nanswer: echo returned: hello from the harness");
    let provider: Rc<dyn Provider> = mock;
    let resolver: ProviderResolver = Box::new(move |_| Ok(provider.clone()));

    let buffer: Rc<RefCell<Vec<Signal>>> = Rc::new(RefCell::new(Vec::new()));
    let host: Rc<dyn RunHost> = Rc::new(TestHost::new());
    let profiles = Rc::new(RefCell::new(ProfileSet::default()));
    let (agents, teams, skills, soul) = crate::host::config::baked_config()?;
    build_handle(
        agents, teams, skills, soul, registry, resolver, log, kv, blobs, host, buffer, profiles,
        searxng,
    )
}

/// One entry for the UI on both targets (the host branch exists so `ui/`
/// compiles and previews without wasm; it is not launched by host `main`).
pub async fn session(notify: Box<dyn Fn()>) -> Result<HarnessHandle, String> {
    let _ = notify; // TestHost records signals itself
    host_session().await
}
