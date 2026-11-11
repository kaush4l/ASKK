//! # Media on this machine (server only)
//!
//! The media place (`core/places.rs`: `<home>/media`) keeps what the user attached, one folder
//! per attachment:
//!
//! ```text
//! media/<id>/original.<ext>   the file as it came
//! media/<id>/meta.json        what was sensed in it (`core::media::Sensed`)
//! media/<id>/image.jpg        an image, made smaller
//! media/<id>/frame-<n>.jpg    stills from a video
//! media/<id>/sound.wav        a video's sound track
//! ```
//!
//! A file arrives in pieces ([`begin`], [`append`]) and is sensed when whole ([`finish`]). How
//! each kind is sensed is the value in `senses.json` (`core::media::Config`): a command per
//! step, run here. A step with no command, or whose command fails, is written into the record
//! with the reason; it never passes silently.
//!
//! | stream | steps | a model gets |
//! | --- | --- | --- |
//! | image | `image` (smaller copy) | the image |
//! | sound | `length`, `hear` | the words heard |
//! | video | `length`, `frame` × n, `sound`, `hear` | n stills and the words heard |
//! | text | read | the text |
use crate::core::media::{kind_of, valid_id, Attachment, Command, Config, Sensed, Senses};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const META: &str = "meta.json";
/// The largest file kept.
pub const MAX_BYTES: u64 = 400 * 1024 * 1024;
/// Images a model takes as they are, when no smaller copy could be made.
const PLAIN_IMAGES: &[(&str, &str)] = &[("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("png", "image/png"), ("gif", "image/gif"), ("webp", "image/webp")];
const MAX_PLAIN: u64 = 5 * 1024 * 1024;
const MAX_TEXT: usize = 20_000;
/// How long one sensing command may take.
const PATIENCE: std::time::Duration = std::time::Duration::from_secs(600);

pub fn root() -> PathBuf {
    crate::core::places::media()
}

fn dir_in(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("bad media id '{id}'"));
    }
    Ok(root.join(id))
}

/// `senses.json` from the data store; missing = nothing is configured (every step says so).
pub fn config() -> Result<Config, String> {
    let key = &crate::core::manifest::manifest().senses;
    let c: Config = match crate::core::store::data().get(key) {
        Some(t) => serde_json::from_str(&t).map_err(|e| format!("{key}: {e}"))?,
        None => Config::default(),
    };
    c.validate().map_err(|e| format!("{key}: {e}"))?;
    Ok(c)
}

fn read_meta(dir: &Path) -> Option<Sensed> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(META)).ok()?).ok()
}

fn write_meta(dir: &Path, s: &Sensed) -> Result<(), String> {
    std::fs::write(dir.join(META), serde_json::to_string_pretty(s).unwrap_or_default()).map_err(|e| format!("{}: {e}", dir.display()))
}

/// The file as it came (`original.<ext>`).
fn original(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| p.file_stem().is_some_and(|s| s == "original"))
}

static N: AtomicU64 = AtomicU64::new(0);

/// A new id: the time and a count, in letters and digits.
fn new_id() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let mut n = ms * 100 + N.fetch_add(1, Ordering::SeqCst) % 100;
    let mut out = vec![];
    while n > 0 {
        out.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Start keeping a file: its folder, an empty original, a first record. Returns its id.
pub fn begin_in(root: &Path, name: &str, mime: &str) -> Result<String, String> {
    let name: String = name.rsplit(['/', '\\']).next().unwrap_or_default().chars().filter(|c| !c.is_control()).take(120).collect();
    let name = if name.trim().is_empty() { "file".to_string() } else { name.trim().to_string() };
    let ext: String = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).filter(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_else(|| "bin".into());
    let id = new_id();
    let dir = dir_in(root, &id)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    std::fs::write(dir.join(format!("original.{ext}")), b"").map_err(|e| e.to_string())?;
    write_meta(&dir, &Sensed { id: id.clone(), kind: kind_of(mime, &name).into(), name, status: "receiving".into(), ..Default::default() })?;
    Ok(id)
}

/// Add the next piece of a file; returns its size so far.
pub fn append_in(root: &Path, id: &str, bytes: &[u8]) -> Result<u64, String> {
    use std::io::Write;
    let dir = dir_in(root, id)?;
    if read_meta(&dir).is_none_or(|m| m.status != "receiving") {
        return Err(format!("media '{id}' is not being received"));
    }
    let file = original(&dir).ok_or_else(|| format!("no media '{id}'"))?;
    let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    if size + bytes.len() as u64 > MAX_BYTES {
        return Err(format!("the file is larger than {} MB", MAX_BYTES / 1024 / 1024));
    }
    std::fs::OpenOptions::new().append(true).open(&file).and_then(|mut f| f.write_all(bytes)).map_err(|e| e.to_string())?;
    Ok(size + bytes.len() as u64)
}

/// Fill a command's arguments.
fn fill(arg: &str, with: &[(&str, String)]) -> String {
    with.iter().fold(arg.to_string(), |a, (k, v)| a.replace(&format!("{{{k}}}"), v))
}

/// Run one sensing command; its words are its `text` file, else what it printed (a JSON
/// `field` of it, when the command names one). Every run is added to `steps`.
async fn run(what: &str, c: &Command, with: &[(&str, String)], steps: &mut Vec<(String, u64, String)>) -> Result<String, String> {
    let t = std::time::Instant::now();
    let out = run_quiet(what, c, with).await;
    steps.push((what.into(), t.elapsed().as_millis() as u64, match &out { Ok(_) => "ok".into(), Err(e) => e.clone() }));
    out
}

async fn run_quiet(what: &str, c: &Command, with: &[(&str, String)]) -> Result<String, String> {
    let (prog, args) = c.command.split_first().ok_or_else(|| format!("no command for it (senses.json: {what})"))?;
    let child = tokio::process::Command::new(prog)
        .args(args.iter().map(|a| fill(a, with)))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("{prog}: {e}"))?;
    let out = tokio::time::timeout(PATIENCE, child.wait_with_output()).await.map_err(|_| format!("{prog}: took longer than {}s", PATIENCE.as_secs()))?.map_err(|e| format!("{prog}: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail: String = err.trim().chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(format!("{prog}: {}", if tail.is_empty() { out.status.to_string() } else { tail }));
    }
    let printed = if c.text.is_empty() { String::from_utf8_lossy(&out.stdout).into_owned() } else { std::fs::read_to_string(fill(&c.text, with)).map_err(|e| format!("{prog}: its words were not where senses.json says ({}): {e}", fill(&c.text, with)))? };
    if c.field.is_empty() {
        return Ok(printed.trim().to_string());
    }
    let v: serde_json::Value = serde_json::from_str(printed.trim()).map_err(|e| format!("{prog}: its output is not JSON: {e}"))?;
    v[&c.field].as_str().map(|s| s.trim().to_string()).ok_or_else(|| format!("{prog}: its output has no '{}'", c.field))
}

fn exists(p: &Path) -> bool {
    std::fs::metadata(p).is_ok_and(|m| m.len() > 0)
}

/// Sense a kept file with `cfg` and write the record.
pub async fn sense_in(root: &Path, id: &str, cfg: &Config) -> Result<Sensed, String> {
    let dir = dir_in(root, id)?;
    let mut s = read_meta(&dir).ok_or_else(|| format!("no media '{id}'"))?;
    let input = original(&dir).ok_or_else(|| format!("no media '{id}'"))?;
    let p = |path: &Path| path.to_string_lossy().into_owned();
    let base = |output: &Path, at: f64| -> Vec<(&'static str, String)> {
        vec![("input", p(&input)), ("output", p(output)), ("dir", p(&dir)), ("stem", output.file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default()), ("at", format!("{at:.2}"))]
    };
    let mut steps = vec![];
    let mut problems: Vec<String> = vec![];
    s.text.clear();
    s.parts.clear();
    let part = |path: &Path, mime: &str, label: String| Attachment { id: id.to_string(), kind: "image".into(), mime: mime.into(), path: p(path), label };
    // Hear `sound` (a file): the words, or why not.
    async fn hear(cfg: &Config, sound: &Path, with: Vec<(&'static str, String)>, steps: &mut Vec<(String, u64, String)>) -> Result<String, String> {
        let mut with = with;
        with.retain(|(k, _)| *k != "input" && *k != "stem");
        with.push(("input", sound.to_string_lossy().into_owned()));
        with.push(("stem", sound.file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default()));
        run("hear", &cfg.hear, &with, steps).await
    }
    match s.kind.as_str() {
        "image" => {
            let small = dir.join("image.jpg");
            let made = run("image", &cfg.image, &base(&small, 0.0), &mut steps).await;
            let ext = input.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            let plain = PLAIN_IMAGES.iter().find(|(e, _)| *e == ext).filter(|_| std::fs::metadata(&input).is_ok_and(|m| m.len() <= MAX_PLAIN));
            match (made, exists(&small), plain) {
                (Ok(_), true, _) => s.parts.push(part(&small, "image/jpeg", String::new())),
                // No smaller copy: the image as it came, when a model takes that.
                (_, _, Some((_, mime))) => s.parts.push(part(&input, mime, String::new())),
                (Err(e), _, None) => problems.push(e),
                (Ok(_), false, None) => problems.push("the image command made no image".into()),
            }
        }
        "audio" => {
            s.seconds = run("length", &cfg.length, &base(&input, 0.0), &mut steps).await.ok().and_then(|t| t.trim().parse().ok()).unwrap_or(0.0);
            match hear(cfg, &input, base(&input, 0.0), &mut steps).await {
                Ok(words) => s.text = words,
                Err(e) => problems.push(e),
            }
        }
        "video" => {
            s.seconds = run("length", &cfg.length, &base(&input, 0.0), &mut steps).await.ok().and_then(|t| t.trim().parse().ok()).unwrap_or(0.0);
            let n = if cfg.frames == 0 { 6 } else { cfg.frames };
            for i in 0..n {
                // Spread over the length; with no length known, one a second from the start.
                let at = if s.seconds > 0.0 { (i as f64 + 0.5) * s.seconds / n as f64 } else { i as f64 };
                let still = dir.join(format!("frame-{}.jpg", i + 1));
                match run("frame", &cfg.frame, &base(&still, at), &mut steps).await {
                    Ok(_) if exists(&still) => s.parts.push(part(&still, "image/jpeg", format!("frame at {at:.1}s"))),
                    Ok(_) => {}
                    Err(e) => {
                        problems.push(e);
                        break;
                    }
                }
            }
            let sound = dir.join("sound.wav");
            match run("sound", &cfg.sound, &base(&sound, 0.0), &mut steps).await {
                Ok(_) if exists(&sound) => match hear(cfg, &sound, base(&sound, 0.0), &mut steps).await {
                    Ok(words) => s.text = words,
                    Err(e) => problems.push(e),
                },
                // A video without a sound track is still a video.
                Ok(_) => {}
                Err(e) => problems.push(e),
            }
        }
        "text" => match std::fs::read_to_string(&input) {
            Ok(t) => s.text = if t.chars().count() > MAX_TEXT { format!("{}… (cut)", t.chars().take(MAX_TEXT).collect::<String>()) } else { t },
            Err(e) => problems.push(format!("not readable as text: {e}")),
        },
        _ => problems.push("this kind of file cannot be sensed (images, sound, video and text can)".into()),
    }
    s.steps = steps;
    // Ready when anything was taken from it; an error says everything that went wrong.
    if s.parts.is_empty() && s.text.trim().is_empty() {
        s.status = "error".into();
        s.text = if problems.is_empty() { "nothing could be taken from it".into() } else { problems.join("; ") };
    } else {
        s.status = "ready".into();
    }
    write_meta(&dir, &s)?;
    Ok(s)
}

pub fn begin(name: &str, mime: &str) -> Result<String, String> {
    begin_in(&root(), name, mime)
}

pub fn append(id: &str, bytes: &[u8]) -> Result<u64, String> {
    append_in(&root(), id, bytes)
}

/// The file is whole: sense it.
pub async fn finish(id: &str) -> Result<Sensed, String> {
    let dir = dir_in(&root(), id)?;
    match config() {
        Ok(cfg) => sense_in(&root(), id, &cfg).await,
        // A broken senses.json is said on the attachment, where the user is looking.
        Err(e) => {
            let mut s = read_meta(&dir).ok_or_else(|| format!("no media '{id}'"))?;
            s.status = "error".into();
            s.text = e;
            write_meta(&dir, &s)?;
            Ok(s)
        }
    }
}

/// What a person is shown of an attachment: its first picture, `(mime, bytes)`.
pub fn preview(id: &str) -> Option<(String, Vec<u8>)> {
    let s = read_meta(&dir_in(&root(), id).ok()?)?;
    let p = s.parts.first()?;
    Some((p.mime.clone(), std::fs::read(&p.path).ok()?))
}

/// A kept file's bytes (an image, to show a model).
pub fn bytes(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

/// The host's side of `core::media::Senses`.
pub struct Kept;

impl Senses for Kept {
    fn sensed(&self, id: &str) -> Option<Sensed> {
        read_meta(&dir_in(&root(), id).ok()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(args: &[&str]) -> Command {
        Command { command: args.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("askk-media-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    /// Stand-in commands: a "still" is a copy of the input, the "words" are printed.
    fn cfg() -> Config {
        Config {
            image: cmd(&["/bin/cp", "{input}", "{output}"]),
            hear: Command { command: vec!["/bin/sh".into(), "-c".into(), "printf '{\"text\": \" heard %s \"}' \"$(basename {input})\"".into()], field: "text".into(), ..Default::default() },
            frame: cmd(&["/bin/sh", "-c", "echo still-{at} > {output}"]),
            sound: cmd(&["/bin/cp", "{input}", "{output}"]),
            length: cmd(&["/bin/echo", "8.0"]),
            frames: 2,
        }
    }

    #[tokio::test]
    async fn each_stream_is_sensed_by_the_commands_in_the_config() {
        let root = temp("streams");
        let keep = |name: &str, bytes: &[u8]| {
            let id = begin_in(&root, name, "").unwrap();
            append_in(&root, &id, &bytes[..bytes.len() / 2]).unwrap();
            assert_eq!(append_in(&root, &id, &bytes[bytes.len() / 2..]).unwrap(), bytes.len() as u64, "pieces add up");
            id
        };
        let img = sense_in(&root, &keep("../../pic.PNG", b"pixels"), &cfg()).await.unwrap();
        assert_eq!((img.kind.as_str(), img.name.as_str(), img.status.as_str(), img.parts.len()), ("image", "pic.PNG", "ready", 1), "a name is never a path");
        assert!(img.parts[0].path.ends_with("image.jpg") && img.parts[0].mime == "image/jpeg");
        let aud = sense_in(&root, &keep("memo.m4a", b"waves"), &cfg()).await.unwrap();
        assert_eq!((aud.status.as_str(), aud.text.as_str(), aud.seconds), ("ready", "heard original.m4a", 8.0));
        assert_eq!(aud.steps.iter().map(|(w, _, r)| (w.as_str(), r.as_str())).collect::<Vec<_>>(), [("length", "ok"), ("hear", "ok")], "every step is recorded");
        let vid = sense_in(&root, &keep("clip.mov", b"frames+waves"), &cfg()).await.unwrap();
        assert_eq!(vid.parts.iter().map(|p| p.label.as_str()).collect::<Vec<_>>(), ["frame at 2.0s", "frame at 6.0s"], "stills spread over the length");
        assert_eq!(vid.text, "heard sound.wav", "the sound track is heard");
        let txt = sense_in(&root, &keep("notes.md", b"# hi"), &cfg()).await.unwrap();
        assert_eq!((txt.kind.as_str(), txt.text.as_str()), ("text", "# hi"));
        assert_eq!(read_meta(&root.join(&vid.id)).unwrap(), vid, "the record is kept beside the file");
        assert!(append_in(&root, &vid.id, b"more").is_err(), "a sensed file takes no more pieces");
        assert!(append_in(&root, "../x", b"").is_err() && sense_in(&root, "nope1", &cfg()).await.is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_step_that_cannot_run_says_why() {
        let root = temp("errors");
        let id = begin_in(&root, "memo.wav", "audio/wav").unwrap();
        append_in(&root, &id, b"waves").unwrap();
        let none = sense_in(&root, &id, &Config::default()).await.unwrap();
        assert_eq!(none.status, "error");
        assert!(none.text.contains("no command for it (senses.json: hear)"), "{}", none.text);
        let id = begin_in(&root, "memo.wav", "audio/wav").unwrap();
        let broken = Config { hear: cmd(&["/bin/sh", "-c", "echo no model >&2; exit 3"]), ..Default::default() };
        let failed = sense_in(&root, &id, &broken).await.unwrap();
        assert!(failed.status == "error" && failed.text.contains("no model"), "{}", failed.text);
        // An image a model takes as it is needs no command.
        let id = begin_in(&root, "pic.png", "image/png").unwrap();
        append_in(&root, &id, b"pixels").unwrap();
        let plain = sense_in(&root, &id, &Config::default()).await.unwrap();
        assert_eq!((plain.status.as_str(), plain.parts[0].mime.as_str()), ("ready", "image/png"));
        let id = begin_in(&root, "thing.bin", "").unwrap();
        assert!(sense_in(&root, &id, &cfg()).await.unwrap().text.contains("cannot be sensed"));
        let _ = std::fs::remove_dir_all(root);
    }
}
