//! Shared by the HTTP server (`askk-server`) and the desktop app (`askk`): the engines folder,
//! the model connectors, hot reload and asset files.

use anyhow::{Result, bail};
use std::path::{Path, PathBuf};

pub mod connectors;
pub mod reload;

pub fn arg(name: &str, default: &str) -> String {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned()).unwrap_or_else(|| default.to_string())
}

/// Which folder the engines come from, first match wins:
/// `--engines <dir>`, then `$ASKK_ENGINES`, then `./engines` (yours, gitignored) when it holds
/// an engine, else `<data>/engines`. A `<data>/engines` with no engine is first filled with a
/// copy of `./defaults/engines` (committed, never written to), or the built-in seed if that is absent.
pub fn engines_dir(data: &Path) -> Result<(PathBuf, &'static str)> {
    let has_engine = |d: &Path| {
        std::fs::read_dir(d).is_ok_and(|r| r.flatten().any(|e| e.path().join("engine.md").is_file()))
    };
    let flag = arg("--engines", "");
    if !flag.is_empty() {
        return Ok((PathBuf::from(flag), "--engines"));
    }
    if let Ok(v) = std::env::var("ASKK_ENGINES") {
        if !v.is_empty() {
            return Ok((PathBuf::from(v), "ASKK_ENGINES"));
        }
    }
    if has_engine(Path::new("engines")) {
        return Ok((PathBuf::from("engines"), "local"));
    }
    let scratch = data.join("engines");
    if has_engine(&scratch) {
        return Ok((scratch, "data"));
    }
    let defaults = Path::new("defaults/engines");
    if has_engine(defaults) {
        copy_dir(defaults, &scratch)?;
        return Ok((scratch, "copied from defaults"));
    }
    Ok((scratch, "seed"))
}

pub fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)?.flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if src.is_dir() { copy_dir(&src, &dst)? } else { std::fs::copy(&src, &dst).map(|_| ())? }
    }
    Ok(())
}

/// Writes an uploaded image to `<data>/ui/assets/<name>` and returns its URL `/ui/assets/<name>`.
/// `data` is base64; a `data:` URL prefix is accepted.
pub fn save_asset(data_dir: &Path, name: &str, data: &str) -> Result<String> {
    let Some(name) = asset_name(name) else { bail!("name must be a .png, .jpg, .jpeg, .webp, .gif, .avif or .svg file name") };
    let b64 = data.split_once("base64,").map(|(_, b)| b).unwrap_or(data);
    let Some(bytes) = base64(b64) else { bail!("data is not base64") };
    if bytes.len() > 12 * 1024 * 1024 {
        bail!("an asset is at most 12 MB");
    }
    let dir = data_dir.join("ui/assets");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(&name), &bytes)?;
    Ok(format!("/ui/assets/{name}"))
}

/// A safe file name: letters, digits, dot, dash, underscore; an image extension; no leading dot.
pub fn asset_name(n: &str) -> Option<String> {
    let n = n.rsplit(['/', '\\']).next()?.to_ascii_lowercase();
    let ok = !n.starts_with('.') && n.len() <= 80 && n.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    let ext = n.rsplit_once('.').map(|(_, e)| e)?;
    (ok && ["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"].contains(&ext)).then_some(n)
}

pub fn base64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for ch in s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=') {
        let v = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        } as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn asset_names_and_base64() {
        assert_eq!(asset_name("../x/Wall.PNG").as_deref(), Some("wall.png"));
        assert_eq!(asset_name(".hidden.png"), None);
        assert_eq!(asset_name("a.exe"), None);
        assert_eq!(base64("aGVsbG8=").unwrap(), b"hello");
        assert!(base64("??").is_none());
    }
}
