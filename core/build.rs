//! Embeds `../defaults/engines/` as the built-in seed: every file under it, at its path.
use std::{env, fs, path::Path};

fn walk(dir: &Path, base: &Path, out: &mut Vec<(String, String)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if p.is_dir() {
            walk(&p, base, out);
        } else {
            let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
            out.push((format!("engines/{rel}"), p.canonicalize().unwrap().to_string_lossy().into_owned()));
        }
    }
}

fn main() {
    let root = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("../defaults/engines");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files = vec![];
    walk(&root, &root, &mut files);
    assert!(!files.is_empty(), "defaults/engines/ is empty: the seed needs at least one engine");
    let body: String = files.iter().map(|(rel, abs)| format!("    ({rel:?}, include_str!({abs:?})),\n")).collect();
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("seed_files.rs");
    fs::write(out, format!("pub const FILES: &[(&str, &str)] = &[\n{body}];\n")).unwrap();
}
