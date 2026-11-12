//! # Sandbox, on this machine: what this system has to keep a program inside its folder
//!
//! The port is `core/sandbox.rs`. A build is made for one system, so which sandbox it has is
//! chosen when it is compiled (`cfg(target_os)`): no build carries another system's code.
//!
//! | system | confined by | how |
//! | --- | --- | --- |
//! | macOS | the system's own sandbox | the program is started through `/usr/bin/sandbox-exec` with a profile written for it ([`profile`]): everything is allowed but writing, and writing is allowed in its folder, in temp, and in its own state |
//! | Linux | Landlock (kernel 5.13 or later) | the program is started through this same program (`askk confine <folder> … -- <program> …`), which gives up its own right to write anywhere else and then becomes the program. A kernel without Landlock is noticed at start: programs then run unconfined, and every box says so |
//! | Windows, others | nothing | the core's own answer: not confined, and it says so |
//!
//! Only files are confined. The network, and on Linux the kernel's call filter, are not
//! touched: a confined program can still reach the internet.
#[cfg(any(target_os = "macos", target_os = "linux"))]
use crate::core::sandbox::Sandbox;
use std::path::Path;

/// Where every program may write besides its own folder and state: devices (its own
/// terminal is one) and temp files.
#[cfg(target_os = "macos")]
const TEMP: &[&str] = &["/dev", "/private/var/folders", "/private/tmp"];

/// Under the user's home, what an agent's program needs besides its own state: the login
/// keychain (its sign-in is refreshed there) and caches.
#[cfg(target_os = "macos")]
const SHARED: &[&str] = &["Library/Keychains", "Library/Caches"];

/// What each shell writes under the user's home for itself: its history, its completion
/// cache, its saved sessions and the caches its plugins keep. Without these a confined shell
/// starts with a screen of "Operation not permitted". None of it is another project's, the
/// app's, or a sign-in (a shell does not get the keychain an agent gets).
const SHELLS: &[(&[&str], &[&str])] = &[
    (&["zsh"], &[".zsh_history", ".zsh_sessions", ".zcompdump", ".cache", ".local/state"]),
    (&["bash", "sh"], &[".bash_history", ".bash_sessions", ".cache", ".local/state"]),
    (&["fish"], &[".local/share/fish", ".cache", ".local/state"]),
];

/// The state a shell named `program` may write; empty for a program that is not a shell.
pub fn shell_state(program: &str) -> Vec<String> {
    let name = program.rsplit('/').next().unwrap_or(program).trim_start_matches('-');
    SHELLS.iter().find(|(names, _)| names.contains(&name)).map(|(_, s)| s.iter().map(|x| x.to_string()).collect()).unwrap_or_default()
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_shell_state(state: &[String]) -> bool {
    SHELLS.iter().any(|(_, s)| s.len() == state.len() && s.iter().zip(state).all(|(a, b)| a == b))
}

/// A path as a quoted string in a sandbox profile.
fn quoted(p: &Path) -> String {
    format!("\"{}\"", p.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\""))
}

/// The sandbox a program runs in (macOS): it may read and run as the user can, but it may
/// **write** only in its own folder (`dir`), in `temp`, and under `home` where a path begins
/// with one of `state`. So one project's program cannot change another project, the app's
/// data, or the user's files.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn profile(dir: &Path, home: &Path, state: &[&str], temp: &[&str]) -> String {
    let mut p = format!("(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* (subpath {}))\n", quoted(dir));
    for t in temp {
        p.push_str(&format!("(allow file-write* (subpath {}))\n", quoted(Path::new(t))));
    }
    for s in state {
        // A prefix, not a folder: `.claude` covers `.claude/` and `.claude.json`.
        let at: String = home.join(s).to_string_lossy().chars().flat_map(|c| if c.is_ascii_alphanumeric() || c == '/' { vec![c] } else { vec!['\\', c] }).collect();
        p.push_str(&format!("(allow file-write* (regex #\"^{at}\"))\n"));
    }
    p
}

/// macOS: the system's own sandbox.
#[cfg(target_os = "macos")]
struct Seatbelt;

#[cfg(target_os = "macos")]
const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

#[cfg(target_os = "macos")]
impl Sandbox for Seatbelt {
    fn how(&self) -> String {
        "the system's sandbox: it may write only in its folder and in temp".into()
    }
    fn confine(&self, argv: Vec<String>, folder: &Path, state: &[String]) -> Result<Vec<String>, String> {
        let home = crate::core::places::user_home().unwrap_or_else(|| "/var/empty".into());
        // A program with state of its own is an agent: it also needs what every agent needs.
        let mut all: Vec<&str> = state.iter().map(String::as_str).collect();
        if !all.is_empty() && !is_shell_state(state) {
            all.extend(SHARED);
        }
        let mut out = vec![SANDBOX_EXEC.to_string(), "-p".to_string(), profile(folder, &home, &all, TEMP)];
        out.extend(argv);
        Ok(out)
    }
}

/// Linux: Landlock, taken on by a process for itself just before it becomes the program.
#[cfg(target_os = "linux")]
struct Landlocked {
    /// This program's own file: it is what starts a confined program.
    exe: String,
}

/// The word after `askk` that starts a program confined (Linux).
pub const CONFINE: &str = "confine";

#[cfg(target_os = "linux")]
impl Sandbox for Landlocked {
    fn how(&self) -> String {
        "Landlock: it may write only in its folder and in temp".into()
    }
    fn confine(&self, argv: Vec<String>, folder: &Path, state: &[String]) -> Result<Vec<String>, String> {
        let mut out = vec![self.exe.clone(), CONFINE.to_string(), folder.to_string_lossy().into_owned()];
        if let Some(home) = crate::core::places::user_home() {
            // Landlock names files and folders, not beginnings of names: `.claude` covers the
            // folder of that name; a file beside it (`.claude.json`) is named too when it is there.
            for s in state {
                out.extend([home.join(s), home.join(format!("{s}.json"))].iter().filter(|p| p.exists()).map(|p| p.to_string_lossy().into_owned()));
            }
        }
        out.push("--".into());
        out.extend(argv);
        Ok(out)
    }
}

/// Linux on a kernel without Landlock: nothing confines, and the box says why.
#[cfg(target_os = "linux")]
struct NoLandlock;

#[cfg(target_os = "linux")]
impl Sandbox for NoLandlock {
    fn how(&self) -> String {
        "not confined: this kernel has no Landlock (it came with Linux 5.13), so the program can write wherever you can".into()
    }
    fn confine(&self, argv: Vec<String>, _: &Path, _: &[String]) -> Result<Vec<String>, String> {
        Ok(argv)
    }
}

/// Where a confined program may write besides its folder (Linux).
#[cfg(target_os = "linux")]
const WRITABLE: &[&str] = &["/dev", "/tmp", "/var/tmp"];

/// Give up, for this process and everything it starts, the right to write anywhere but
/// `writable` (Linux). Reading and running stay as they were.
#[cfg(target_os = "linux")]
pub fn confine_self(writable: &[String]) -> Result<(), String> {
    use landlock::{path_beneath_rules, Access, AccessFs, Ruleset, RulesetAttr, RulesetCreatedAttr, RulesetStatus, ABI};
    // The newest rules this program knows; on an older kernel the ones it lacks are left out.
    let abi = ABI::V5;
    let said = |e: landlock::RulesetError| format!("Landlock refused the rules: {e}");
    let status = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))
        .map_err(said)?
        .create()
        .map_err(said)?
        .add_rules(path_beneath_rules(["/"], AccessFs::from_read(abi)))
        .map_err(said)?
        .add_rules(path_beneath_rules(writable, AccessFs::from_all(abi)))
        .map_err(said)?
        .restrict_self()
        .map_err(said)?;
    match status.ruleset {
        RulesetStatus::NotEnforced => Err("this kernel has no Landlock (it came with Linux 5.13), so the program cannot be confined".into()),
        _ => Ok(()),
    }
}

/// Whether this kernel has Landlock, asked without confining anything: making a set of
/// rules that must hold fails where there is none.
#[cfg(target_os = "linux")]
fn landlock_here() -> bool {
    use landlock::{Access, AccessFs, CompatLevel, Compatible, Ruleset, RulesetAttr, ABI};
    Ruleset::default().set_compatibility(CompatLevel::HardRequirement).handle_access(AccessFs::from_all(ABI::V1)).and_then(|r| r.create()).is_ok()
}

/// `askk confine <folder> [<also writable>…] -- <program> [<arguments>…]` (Linux): confine
/// this process to those folders, then become the program. It returns only when that could
/// not be done, with the reason.
#[cfg(target_os = "linux")]
pub fn confined(args: &[String]) -> String {
    use std::os::unix::process::CommandExt;
    let Some(at) = args.iter().position(|a| a == "--") else {
        return format!("`askk {CONFINE}` needs a folder, `--`, and the program to run");
    };
    let (folders, program) = (&args[..at], &args[at + 1..]);
    let (Some(_), Some(name)) = (folders.first(), program.first()) else {
        return format!("`askk {CONFINE}` needs a folder, `--`, and the program to run");
    };
    let writable: Vec<String> = folders.iter().cloned().chain(WRITABLE.iter().map(|w| w.to_string())).collect();
    if let Err(e) = confine_self(&writable) {
        return format!("{name} was not started: {e}");
    }
    let e = std::process::Command::new(name).args(&program[1..]).exec();
    format!("{name} could not be started: {e}")
}

/// On a system that confines programs another way, the word is not used.
#[cfg(not(target_os = "linux"))]
pub fn confined(_: &[String]) -> String {
    format!("`askk {CONFINE}` is how a program is confined on Linux (Landlock); this system does not use it")
}

/// Fill the port with what this system has, and note it as a capability.
pub fn start() {
    #[cfg(target_os = "macos")]
    {
        if Path::new(SANDBOX_EXEC).is_file() {
            let sandbox = std::sync::Arc::new(Seatbelt);
            crate::core::caps::provided("sandbox", &sandbox.how());
            crate::core::sandbox::set(sandbox);
        } else {
            eprintln!("askk: {SANDBOX_EXEC} is not on this Mac, so programs started in a terminal are not confined");
        }
    }
    #[cfg(target_os = "linux")]
    {
        match std::env::current_exe() {
            Ok(exe) if landlock_here() => {
                let sandbox = std::sync::Arc::new(Landlocked { exe: exe.to_string_lossy().into_owned() });
                crate::core::caps::provided("sandbox", &sandbox.how());
                crate::core::sandbox::set(sandbox);
            }
            Ok(_) => {
                eprintln!("askk: this kernel has no Landlock (it came with Linux 5.13), so programs started in a terminal are not confined");
                crate::core::sandbox::set(std::sync::Arc::new(NoLandlock));
            }
            Err(e) => eprintln!("askk: this program could not find its own file ({e}), so programs started in a terminal are not confined"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_state_path_is_a_prefix_and_cannot_break_out_of_the_profile() {
        let p = profile(Path::new("/w/a \"b\""), Path::new("/Users/me"), &[".claude"], &[]);
        assert!(p.contains(r#"(subpath "/w/a \"b\"")"#), "{p}");
        assert!(p.contains(r#"(regex #"^/Users/me/\.claude")"#), "{p}");
        assert!(p.starts_with("(version 1)\n(allow default)\n(deny file-write*)\n"));
    }

    /// A folder of its own for one test, with `mine` (the program's folder) and `other`
    /// (somebody else's) in it. It is under the build's own folder, not under temp: temp is
    /// a place a confined program may write.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn scratch(tag: &str) -> std::path::PathBuf {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join(format!("askk-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for d in ["mine", "other"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        root.canonicalize().unwrap()
    }

    /// The rule itself, enforced by the system: a confined program writes in its folder and
    /// is refused next door.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_confined_program_cannot_write_outside_its_folder() {
        let root = scratch("confined");
        let script = "echo a > in.txt; echo b > ../other/out.txt; echo c > \"$TMPDIR/askk-confined-$$\" && rm \"$TMPDIR/askk-confined-$$\" && echo temp-ok";
        let argv = Seatbelt.confine(vec!["/bin/sh".into(), "-c".into(), script.into()], &root.join("mine"), &[]).unwrap();
        let o = std::process::Command::new(&argv[0]).args(&argv[1..]).current_dir(root.join("mine")).output().unwrap();
        let said = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
        assert!(root.join("mine/in.txt").is_file(), "its own folder is writable: {said}");
        assert!(!root.join("other/out.txt").exists(), "the folder next door is not: {said}");
        assert!(said.contains("temp-ok"), "temp is writable: {said}");
        assert!(said.contains("Operation not permitted"), "the refusal is the system's own: {said}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The same rule on Linux. The test process cannot confine itself (every later test would
    /// be confined too), so a child does, between being made and becoming `sh`: exactly what
    /// `askk confine` does. On a kernel without Landlock the test says so and checks nothing.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_confined_program_cannot_write_outside_its_folder() {
        use std::os::unix::process::CommandExt;
        if !landlock_here() {
            eprintln!("not checked: this kernel has no Landlock");
            return;
        }
        let root = scratch("confined");
        let writable: Vec<String> = [root.join("mine").to_string_lossy().into_owned()].into_iter().chain(WRITABLE.iter().map(|w| w.to_string())).collect();
        let script = "echo a > in.txt; echo b > ../other/out.txt; echo c > /tmp/askk-confined-$$ && rm /tmp/askk-confined-$$ && echo temp-ok";
        let mut cmd = std::process::Command::new("/bin/sh");
        cmd.args(["-c", script]).current_dir(root.join("mine"));
        // After the fork, before `sh`: the child gives up its rights, as `confined` does.
        unsafe {
            cmd.pre_exec(move || confine_self(&writable).map_err(std::io::Error::other));
        }
        let o = cmd.output().unwrap();
        let said = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
        assert!(root.join("mine/in.txt").is_file(), "its own folder is writable: {said}");
        assert!(!root.join("other/out.txt").exists(), "the folder next door is not: {said}");
        assert!(said.contains("temp-ok"), "temp is writable: {said}");
        assert!(said.contains("Permission denied"), "the refusal is the kernel's own: {said}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_word_that_confines_says_what_it_needs() {
        let said = confined(&["only-a-folder".to_string()]);
        assert!(said.contains("askk confine"), "{said}");
    }

    #[test]
    fn a_shell_may_keep_its_history_but_gets_no_keychain() {
        let zsh = shell_state("/bin/zsh");
        assert!(zsh.iter().any(|s| s == ".zsh_history"));
        assert!(is_shell_state(&zsh));
        assert!(shell_state("python3").is_empty());
        assert!(!is_shell_state(&[".claude".to_string()]), "an agent's state is not a shell's");
    }
}
