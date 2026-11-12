//! The skills on disk a message can name with `$`: each `SKILL.md` one folder down in
//! `.claude/skills` and `.agents/skills` (an engine's workspace first, then the owner's home)
//! and in `~/.codex/skills`. The first of a name wins, so a workspace's own come first. It is the
//! core's [`crate::core::skills`] port on this machine.
use std::path::{Path, PathBuf};

use crate::core::skills::Found;

/// The skills for a workspace at `root` (none: only the home's).
pub fn on_disk(root: Option<&str>) -> Vec<Found> {
    let home = crate::core::places::user_home();
    let mut dirs: Vec<PathBuf> = vec![];
    for base in [root.map(PathBuf::from), home.clone()].into_iter().flatten() {
        dirs.push(base.join(".claude/skills"));
        dirs.push(base.join(".agents/skills"));
    }
    if let Some(h) = home {
        dirs.push(h.join(".codex/skills"));
    }
    in_dirs(&dirs)
}

fn in_dirs(dirs: &[PathBuf]) -> Vec<Found> {
    let mut out: Vec<Found> = vec![];
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        let mut found: Vec<Found> = entries.flatten().filter_map(|d| skill_of(&d.path().join("SKILL.md"))).collect();
        found.sort_by(|a, b| a.name.cmp(&b.name));
        for s in found {
            if !out.iter().any(|o| o.name == s.name) {
                out.push(s);
            }
        }
    }
    out
}

/// A `SKILL.md` by the `name:` and `description:` of its head; its folder's name without one.
fn skill_of(file: &Path) -> Option<Found> {
    let text = std::fs::read_to_string(file).ok()?;
    let head = text.strip_prefix("---").map(|t| t.split("\n---").next().unwrap_or_default()).unwrap_or_default();
    let field = |key: &str| head.lines().find_map(|l| l.strip_prefix(key)).map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string()).filter(|v| !v.is_empty());
    let folder = file.parent()?.file_name()?.to_string_lossy().to_string();
    let name: String = field("name:").unwrap_or(folder).chars().filter(|c| !c.is_whitespace()).collect();
    let about: String = field("description:").unwrap_or_default().chars().take(160).collect();
    Some(Found { name, about, file: file.to_string_lossy().into() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_is_named_by_its_head_and_the_first_of_a_name_wins() {
        let base = std::env::temp_dir().join(format!("askk-skills-{}", std::process::id()));
        let (mine, home) = (base.join("ws/.claude/skills"), base.join("home/.claude/skills"));
        for (dir, folder, body) in [
            (&mine, "glass", "---\nname: apple-design\ndescription: \"glass and motion\"\n---\nbody"),
            (&mine, "plain", "no head at all"),
            (&home, "other", "---\nname: apple-design\ndescription: the home's\n---\n"),
        ] {
            std::fs::create_dir_all(dir.join(folder)).unwrap();
            std::fs::write(dir.join(folder).join("SKILL.md"), body).unwrap();
        }
        let found = in_dirs(&[mine.clone(), home, base.join("missing")]);
        let _ = std::fs::remove_dir_all(&base);
        assert_eq!(found.iter().map(|f| (f.name.as_str(), f.about.as_str())).collect::<Vec<_>>(), [("apple-design", "glass and motion"), ("plain", "")]);
        assert!(found[0].file.ends_with("glass/SKILL.md"));
    }
}
