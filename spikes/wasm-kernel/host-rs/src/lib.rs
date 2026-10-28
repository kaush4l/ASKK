//! askk:spike/host as a WebAssembly component for the wasmtime run (spike, 2026-10-26).
//! Files go through std::fs, which on wasm32-wasip2 is wasi:filesystem: the component reaches only the folders
//! wasmtime preopens (`--dir lane::/desk`) — the grant is the runtime's, not a rule in this code.
//! The model is scripted (the same three replies as jco/model.js), so the run needs no key.

wit_bindgen::generate!({ path: "../wit", world: "host-impl" });

use exports::askk::spike::host::Guest;
use std::sync::atomic::{AtomicUsize, Ordering};

static STEP: AtomicUsize = AtomicUsize::new(0);
const SCRIPT: [&str; 3] = [
    r##"{"thought":"write the note","calls":[{"tool":"fs.write","input":{"path":"/desk/notes/hello.md","text":"# Hello from inside the WASM sandbox (wasmtime)\n"}}]}"##,
    r##"{"thought":"try a file outside the grant, then read mine","calls":[{"tool":"fs.write","input":{"path":"/etc/askk-escape.txt","text":"should never land"}},{"tool":"fs.read","input":{"path":"/desk/notes/hello.md"}}]}"##,
    r##"{"thought":"report","calls":[],"answer":"Wrote /desk/notes/hello.md and read it back; the write to /etc failed: wasmtime never granted it."}"##,
];

struct Host;

impl Guest for Host {
    fn fs_read(path: String) -> Result<String, String> {
        std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
    }
    fn fs_write(path: String, text: String) -> Result<(), String> {
        if let Some(dir) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{path}: {e}"))?;
        }
        std::fs::write(&path, text).map_err(|e| format!("{path}: {e}"))
    }
    fn complete(prompt: String) -> Result<String, String> {
        let n = STEP.fetch_add(1, Ordering::SeqCst) % SCRIPT.len();
        eprintln!("[model] step {}: prompt {} chars", n + 1, prompt.len());
        Ok(SCRIPT[n].to_string())
    }
    fn log(line: String) {
        eprintln!("[kernel] {line}");
    }
}

export!(Host);
