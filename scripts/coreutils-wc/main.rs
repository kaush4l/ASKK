//! `wc` — the hosted-binary proof for the ASKK `BinaryEnv` descriptor.
//!
//! A tiny `wasm32-wasip1` utility that exists to prove the WASI runner's
//! environment descriptor generalizes beyond the bespoke Python runtime: it is
//! hosted as a bundled asset (`assets/runtimes/coreutils/wc.wasm`) and selected
//! by name through a [`BinaryEnv`](crate) descriptor, NOT by a `.wasm` path.
//!
//! Compiled standalone (NOT part of the main ASKK crate) by
//! `scripts/coreutils-wc/build.sh` with stock `rustc --target wasm32-wasip1` —
//! no extra crates.
//!
//! Behavior (a minimal `wc`):
//!   - With one or more file arguments, it reads each from the WASI runner's
//!     preopened `/workspace` (a bare relative path is resolved against it, so
//!     `wc notes.txt` finds the seeded `/workspace/notes.txt`) and prints
//!     `<lines> <words> <bytes> <path>` per file, then a `total` line when more
//!     than one file is given.
//!   - With no file arguments, it counts standard input and prints the counts
//!     with no trailing path.
//!   - Exit 0 on success; exit 1 if any named file cannot be read.

use std::io::Read;

/// The WASI runner seeds workspace files under this preopened directory. A bare
/// relative argument is resolved against it; an already-absolute path is used
/// as-is.
const WORKSPACE_ROOT: &str = "/workspace";

/// Resolve an argument path to where the runner actually mounts workspace files.
fn resolve(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("{WORKSPACE_ROOT}/{path}")
    }
}

/// Count (lines, words, bytes) for a byte buffer, matching `wc` semantics:
/// lines = number of `\n`, words = whitespace-delimited runs.
fn count(bytes: &[u8]) -> (usize, usize, usize) {
    let lines = bytes.iter().filter(|&&b| b == b'\n').count();
    let words = bytes
        .split(|b| b.is_ascii_whitespace())
        .filter(|w| !w.is_empty())
        .count();
    (lines, words, bytes.len())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let files: Vec<&String> = args.iter().skip(1).collect();

    if files.is_empty() {
        let mut buffer = Vec::new();
        let _ = std::io::stdin().read_to_end(&mut buffer);
        let (lines, words, bytes) = count(&buffer);
        println!("{lines} {words} {bytes}");
        return;
    }

    let (mut total_lines, mut total_words, mut total_bytes) = (0usize, 0usize, 0usize);
    let mut had_error = false;
    for path in &files {
        match std::fs::read(resolve(path)) {
            Ok(bytes) => {
                let (lines, words, byte_len) = count(&bytes);
                // Report the path as the user named it (matching real `wc`).
                println!("{lines} {words} {byte_len} {path}");
                total_lines += lines;
                total_words += words;
                total_bytes += byte_len;
            }
            Err(err) => {
                eprintln!("wc: {path}: {err}");
                had_error = true;
            }
        }
    }
    if files.len() > 1 {
        println!("{total_lines} {total_words} {total_bytes} total");
    }
    if had_error {
        std::process::exit(1);
    }
}
