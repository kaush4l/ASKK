//! ASKING THE MACHINE WHAT IT IS. An agent that guesses at its environment
//! guesses with commands whose output differs between busybox and coreutils,
//! and then misreads them.
//!
//! It is `WorkspacePort::exec` (ADR-013): run ONE script printing labelled
//! fields, and render those fields here. `find_files` — the other tool this
//! dispatch owns — has its own file, `files/find.rs`.

use kernel::{shell_quote, Execution, WorkspacePort};

use crate::files::find::{find_script, found, pattern};
use crate::proc::convention::DIR;
use crate::workspace::gate::unavailable;

/// `observe` or `find_files`, or `None` if this is neither.
pub(crate) async fn run(
    port: &dyn WorkspacePort,
    root: &str,
    tool: &str,
    arg: &dyn Fn(&str) -> String,
) -> Option<Result<Execution, String>> {
    let sh = |script: String| async move { port.exec(root, &script).await.map_err(unavailable) };
    Some(match tool {
        "observe" => sh(observe_script()).await.map(|ran| Execution {
            status: ran.status,
            output: report(&ran.output),
        }),
        "find_files" => {
            let (name, text) = (arg("name").trim().to_string(), arg("text").trim().to_string());
            match (agent::relative_path(&pattern(&name)), name.is_empty() && text.is_empty()) {
                (_, true) => Err(
                    "nothing to search for. Call it as find_files({\"name\": \"*.md\"}) or \
                     find_files({\"text\": \"TODO\"}), or give both."
                        .into(),
                ),
                (Err(refusal), _) => Err(refusal),
                (Ok(_), _) => sh(find_script(&pattern(&name), &text))
                    .await
                    .map(|ran| found(&name, &text, &ran)),
            }
        }
        _ => return None,
    })
}

/// One labelled field per line, tab-separated. Each value is guarded, so a
/// kernel that does not offer it drops that LINE rather than failing the call
/// (I15: a capability may be absent without anything breaking).
fn observe_script() -> String {
    format!(
        "printf 'kernel\\t%s\\n' \"$(uname -srm 2>/dev/null)\"; \
         printf 'up\\t%s\\n' \"$(cut -d' ' -f1 /proc/uptime 2>/dev/null)\"; \
         printf 'cwd\\t%s\\n' \"$(pwd)\"; \
         printf 'here\\t%s\\n' \"$(ls -1A 2>/dev/null | wc -l)\"; \
         printf 'started\\t%s\\n' \"$(ls -1 {d} 2>/dev/null | wc -l)\"; \
         awk '/^MemTotal:/{{t=$2}}/^MemAvailable:/{{a=$2}}/^MemFree:/{{f=$2}}\
         END{{if(!a)a=f; if(t&&a)printf \"mem\\t%d\\t%d\\n\",a,t; \
         else if(t)printf \"memall\\t%d\\n\",t}}' \
         /proc/meminfo 2>/dev/null; \
         df -k . 2>/dev/null | awk 'END{{if(NF>4)printf \"disk\\t%d\\t%d\\n\",$(NF-2),$(NF-4)}}'",
        d = shell_quote(DIR)
    )
}

/// The fields, as the compact block a model reads in one pass. What the machine
/// did not answer is absent: a line reading `memory unknown` is noise.
///
/// AND A FIELD THE GUEST ANSWERED WITH A ZERO IS NOT AN ANSWER (R10-9). Both of
/// these were measured in a browser, on a guest since deleted, against the
/// container2wasm guest this build ships (`Linux 6.1.0`), which answers both:
/// `/proc/uptime` reads `0 0` there — the reading `proc/convention.rs` already refused
/// to build liveness on — so the block said `uptime 0s` on a half-hour-old tab;
/// and `/proc/meminfo` holds `MemTotal:` and nothing else, no `MemAvailable`
/// and no `MemFree`, so the unset awk variable went through `%d` and the block
/// said `memory 0 kB free of 700 MB` — a machine reporting itself out of memory
/// while running fine. So the uptime line is dropped when it is zero, and the
/// free number is printed only when the guest gave one (`memall` is the total
/// alone, which this guest did answer).
fn report(raw: &str) -> String {
    let mut out = Vec::new();
    for line in raw.lines() {
        let f: Vec<&str> = line.split('\t').collect();
        let said = match (f.first().copied().unwrap_or_default(), f.len()) {
            ("kernel", 2) => format!("kernel   {}", f[1]),
            ("up", 2) => match uptime(f[1]) {
                Some(said) => format!("uptime   {said}"),
                None => continue,
            },
            ("cwd", 2) => format!("cwd      {}", f[1]),
            ("here", 2) => format!("here     {} entries in this folder", f[1]),
            ("started", 2) => format!("processes {} started here (list_processes has them)", f[1]),
            ("mem", 3) => format!("memory   {} free of {}", kb(f[1]), kb(f[2])),
            ("memall", 2) => format!("memory   {} in this machine", kb(f[1])),
            ("disk", 3) => format!("disk     {} free of {}", kb(f[1]), kb(f[2])),
            _ => continue,
        };
        out.push(said);
    }
    match out.is_empty() {
        true => "This Linux answered nothing about itself: the command ran, and /proc and \
                 df told it nothing."
            .into(),
        false => out.join("\n"),
    }
}

/// Kilobytes as the unit a person would have said.
fn kb(value: &str) -> String {
    let n: f64 = value.parse().unwrap_or(0.0);
    match n {
        n if n >= 1_048_576.0 => format!("{:.1} GB", n / 1_048_576.0),
        n if n >= 1024.0 => format!("{:.0} MB", n / 1024.0),
        n => format!("{n:.0} kB"),
    }
}

/// `/proc/uptime`'s float seconds as a duration — `None` when the guest does not
/// keep one. A kernel that answers `0` has not been up for no time (R10-9);
/// past that guard the spelling is `words::spanned`, the same one the process
/// table prints its `for` column with.
fn uptime(value: &str) -> Option<String> {
    match value.split('.').next()?.parse::<i64>().ok()? {
        n if n < 1 => None,
        n => Some(crate::words::spanned(n)),
    }
}

#[cfg(test)]
mod tests {
    use super::report;

    /// The block is ours, in units a person would have used, and a field the
    /// machine did not answer is absent rather than guessed at (I15).
    #[test]
    fn observation_is_rendered_not_forwarded() {
        let out = report(
            "kernel\tLinux 5.15.0 x86_64\nup\t251.44\nhere\t7\nmem\t219136\t524288\n\
             disk\t2097152\t4194304\nnonsense\n",
        );
        assert!(out.contains("kernel   Linux 5.15.0 x86_64"), "{out}");
        assert!(out.contains("uptime   4m11s"), "{out}");
        assert!(out.contains("memory   214 MB free of 512 MB"), "{out}");
        assert!(out.contains("disk     2.0 GB free of 4.0 GB"), "{out}");
        assert!(!out.contains("cwd"), "an unanswered field is absent: {out}");
        assert!(report("").contains("answered nothing about itself"));
    }

    /// R10-9: what a guest that answers badly gives back — `0 0` for uptime and
    /// a total with no free number — is not printed as a reading.
    #[test]
    fn a_zero_the_guest_could_not_answer_is_not_a_reading() {
        let out = report("up\t0\nmemall\t716800\n");
        assert!(!out.contains("uptime"), "0 0 is not an uptime: {out}");
        assert!(!out.contains("0 kB"), "{out}");
        assert!(out.contains("memory   700 MB in this machine"), "{out}");
        assert!(report("up\t23.42").contains("uptime   23s"), "c2w is unchanged");
    }
}
