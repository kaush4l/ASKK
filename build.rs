//! The defaults folder is packed into one bundle (keys → text, the store's standard form) and
//! compiled into every build, so a program on its own can still make a first home: the tab has
//! no disk to seed from, and a host started away from this repository has no `defaults` folder.
use std::collections::BTreeMap;
use std::path::Path;

fn walk(dir: &Path, key: &str, out: &mut BTreeMap<String, String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let k = if key.is_empty() { name } else { format!("{key}/{name}") };
        if e.path().is_dir() {
            walk(&e.path(), &k, out);
        } else if let Ok(text) = std::fs::read_to_string(e.path()) {
            // Only text is state; anything else (an image) is not a store value.
            out.insert(k, text);
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=defaults");
    let mut keys = BTreeMap::new();
    walk(&Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("defaults"), "", &mut keys);
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("defaults.json");
    std::fs::write(out, serde_json::to_string(&keys).unwrap()).unwrap();
}
