//! Test guest for the ASKK WASI runner worker (`assets/wasi_runner_worker.js`).
//!
//! Compiled standalone (NOT part of the main ASKK crate) by
//! `scripts/wasi-runner/test/build-guest.sh` with stock
//! `rustc --target wasm32-wasip1` — no extra crates.
//!
//! It exercises everything the runner protocol carries:
//!   1. argv     — prints the args the host passed in.
//!   2. env      — prints one environment variable.
//!   3. stdin    — echoes the string the host piped in.
//!   4. FS read  — reads the host-seeded `/workspace/input.txt`.
//!   5. FS write — creates `/workspace/out/` and writes `result.txt` into it,
//!      proving directory creation and the copy-out round-trip.
//!   6. exit     — returns 0 on success, distinct non-zero codes per failure.

use std::io::Read;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    println!("guest argv: {}", args.join(" "));
    println!(
        "guest env DEMO_KEY = {}",
        std::env::var("DEMO_KEY").unwrap_or_else(|_| "<unset>".to_string())
    );

    let mut stdin_text = String::new();
    if std::io::stdin().read_to_string(&mut stdin_text).is_ok() {
        println!("guest stdin: {}", stdin_text.trim());
    }

    let input = match std::fs::read_to_string("/workspace/input.txt") {
        Ok(contents) => contents,
        Err(err) => {
            eprintln!("guest could not read /workspace/input.txt: {err}");
            std::process::exit(2);
        }
    };
    println!("guest read input.txt: {}", input.trim());

    if let Err(err) = std::fs::create_dir_all("/workspace/out") {
        eprintln!("guest could not create /workspace/out: {err}");
        std::process::exit(3);
    }
    let body = format!(
        "processed by guest wasm: input was {:?}, argc {}\n",
        input.trim(),
        args.len()
    );
    if let Err(err) = std::fs::write("/workspace/out/result.txt", &body) {
        eprintln!("guest could not write /workspace/out/result.txt: {err}");
        std::process::exit(4);
    }
    println!("guest wrote /workspace/out/result.txt");
    println!("guest done (exit 0)");
}
