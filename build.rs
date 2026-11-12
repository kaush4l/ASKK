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

/// The build id: one short name for exactly this source. The same source gives the same id
/// in every program made from it (the service and the page it serves are two programs), so a
/// page can tell whether it was made for the service it is talking to (`core/service.rs`).
/// It is worked out from the text of every file a build is made of, in name order.
/// Returns the id and the names of the files it was worked out from.
fn build_id(root: &Path) -> (String, Vec<String>) {
    let mut files = BTreeMap::new();
    for part in ["src", "defaults", "assets"] {
        walk(&root.join(part), part, &mut files);
    }
    // Written again by every build from `tailwind.css` and the source, both counted already.
    files.remove("assets/tailwind.css");
    for file in ["Cargo.toml", "Cargo.lock", "tailwind.css", "build.rs"] {
        if let Ok(text) = std::fs::read_to_string(root.join(file)) {
            files.insert(file.to_string(), text);
        }
    }
    // FNV-1a: small, and the same on every machine and every version of the tools.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut take = |bytes: &[u8]| {
        for b in bytes {
            hash ^= u64::from(*b);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for (name, text) in &files {
        take(name.as_bytes());
        take(&[0]);
        // A checkout on Windows may end lines differently; the source is still the same.
        take(text.replace("\r\n", "\n").as_bytes());
        take(&[0]);
    }
    (format!("{hash:016x}"), files.into_keys().collect())
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=defaults");
    for part in ["src", "Cargo.toml", "Cargo.lock", "tailwind.css"] {
        println!("cargo:rerun-if-changed={part}");
    }
    let root = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let root = Path::new(&root);
    let mut keys = BTreeMap::new();
    walk(&root.join("defaults"), "", &mut keys);
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("defaults.json");
    std::fs::write(out, serde_json::to_string(&keys).unwrap()).unwrap();
    let (id, files) = build_id(root);
    // The looks are named one by one, not as a folder: `assets/tailwind.css` is written again
    // by every build, and naming the folder would make every build start over because of it.
    for file in files.iter().filter(|f| f.starts_with("assets/")) {
        println!("cargo:rerun-if-changed={file}");
    }
    println!("cargo:rustc-env=ASKK_BUILD={id}");
}
