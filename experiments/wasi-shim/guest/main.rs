//! Tiny WASI Preview-1 guest binary for the wasi-shim spike.
//!
//! Compiled standalone (NOT part of the main ASKK crate) with:
//!     rustc --target wasm32-wasip1 -O -o ../demo.wasm main.rs
//! (or run ../build.sh).
//!
//! It exercises the three things the spike cares about:
//!   1. argv      — prints the args the host passed in.
//!   2. env       — prints one environment variable.
//!   3. virtual FS — reads a preopened file the host wrote, then writes
//!      a new file back into the same virtual directory (proving writes
//!      round-trip through the shim's in-memory filesystem), and lists
//!      the directory to show readdir works.
//!
//! Plain `std` against the WASI sysroot — no extra crates.

use std::env;
use std::fs;
use std::io::Write;

fn main() {
    println!("=== ASKK wasi-shim guest ===");

    // 1. argv
    let args: Vec<String> = env::args().collect();
    println!("argc = {}", args.len());
    for (i, a) in args.iter().enumerate() {
        println!("  argv[{i}] = {a}");
    }

    // 2. env
    match env::var("ASKK_GREETING") {
        Ok(v) => println!("env ASKK_GREETING = {v}"),
        Err(_) => println!("env ASKK_GREETING = <unset>"),
    }

    // 3. virtual FS: read the file the host preopened under /sandbox.
    let input = "/sandbox/input.txt";
    match fs::read_to_string(input) {
        Ok(contents) => {
            println!("read {input} ({} bytes):", contents.len());
            for line in contents.lines() {
                println!("  > {line}");
            }
        }
        Err(e) => println!("could not read {input}: {e}"),
    }

    // Write a new file back so the host can observe a guest-produced write.
    let output = "/sandbox/output.txt";
    let body = format!("written by guest wasm\nsaw {} args\n", args.len());
    match fs::File::create(output) {
        Ok(mut f) => match f.write_all(body.as_bytes()) {
            Ok(()) => println!("wrote {output} ({} bytes)", body.len()),
            Err(e) => println!("could not write {output}: {e}"),
        },
        Err(e) => println!("could not create {output}: {e}"),
    }

    // List the sandbox directory to show readdir works.
    println!("listing /sandbox:");
    match fs::read_dir("/sandbox") {
        Ok(entries) => {
            let mut names: Vec<String> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            for n in names {
                println!("  - {n}");
            }
        }
        Err(e) => println!("could not list /sandbox: {e}"),
    }

    println!("=== guest done (exit 0) ===");
}
