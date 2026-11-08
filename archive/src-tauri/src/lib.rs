//! The desktop shell: a window, nothing else. At start it runs the backend (`askk-server`) as a
//! child process under `sandbox-exec` (sandbox/profiles/server.sb), waits for it, and opens a
//! webview on http://127.0.0.1:<port> — the same URL a browser tab can open. Closing the app
//! stops the backend (SIGTERM, then it saves and exits).
//!
//! Env: ASKK_DATA (default `data`), ASKK_ENGINES (see askk_server::engines_dir), ASKK_PORT (4600),
//! ASKK_SANDBOX=0 runs the backend without the sandbox (for debugging denials).

use std::{
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct Backend(Mutex<Option<Child>>);

fn env(name: &str, default: &str) -> String {
    std::env::var(name).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.into())
}

fn abs(p: &Path) -> PathBuf {
    std::fs::create_dir_all(p).ok();
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf()) // Seatbelt matches resolved paths
}

fn spawn_backend(port: &str) -> anyhow::Result<Child> {
    // `tauri dev` runs from src-tauri/; data, engines, defaults and build/ are relative to the repo.
    if std::env::current_dir()?.ends_with("src-tauri") {
        std::env::set_current_dir("..")?;
    }
    let root = std::env::current_dir()?.canonicalize()?;
    let data = abs(Path::new(&env("ASKK_DATA", "data")));
    let (engines, source) = askk_server::engines_dir(&data)?;
    let engines = abs(&engines);
    let server = std::env::current_exe()?.with_file_name("askk-server");
    anyhow::ensure!(server.is_file(), "{} is missing: cargo build -p askk-server", server.display());
    let args = ["--data".into(), data.display().to_string(), "--engines".into(), engines.display().to_string(), "--port".into(), port.into(), "--ui".into(), root.join("build").display().to_string()];
    println!("backend: engines {} ({source}) · data {} · http://127.0.0.1:{port}", engines.display(), data.display());
    let child = if env("ASKK_SANDBOX", "1") == "0" {
        Command::new(&server).args(&args).spawn()?
    } else {
        Command::new("/usr/bin/sandbox-exec")
            .arg("-f").arg(root.join("sandbox/profiles/server.sb"))
            .arg("-D").arg(format!("ROOT={}", root.display()))
            .arg("-D").arg(format!("DATA={}", data.display()))
            .arg("-D").arg(format!("ENGINES={}", engines.display()))
            .arg("-D").arg(format!("PORT={port}"))
            .arg(&server).args(&args)
            .spawn()?
    };
    Ok(child)
}

fn wait_ready(port: &str, child: &mut Child) -> anyhow::Result<()> {
    let addr = format!("127.0.0.1:{port}").parse()?;
    let until = Instant::now() + Duration::from_secs(20);
    while Instant::now() < until {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        if let Some(code) = child.try_wait()? {
            anyhow::bail!("backend exited ({code}) before it was ready");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    anyhow::bail!("backend not ready on :{port} after 20 s")
}

fn stop(child: &mut Child) {
    unsafe { libc_kill(child.id() as i32, 15) };
    let until = Instant::now() + Duration::from_secs(10);
    while Instant::now() < until {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

unsafe extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = env("ASKK_PORT", "4600");
    let mut child = spawn_backend(&port).expect("askk: cannot start the backend");
    if let Err(e) = wait_ready(&port, &mut child) {
        stop(&mut child);
        panic!("askk: {e:#}");
    }
    let url = format!("http://127.0.0.1:{port}");
    tauri::Builder::default()
        .manage(Backend(Mutex::new(Some(child))))
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("Askk")
                .inner_size(1280.0, 820.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building askk")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(mut c) = app.state::<Backend>().0.lock().unwrap().take()
            {
                stop(&mut c);
            }
        });
}
