//! Attaching: a file chosen in the composer, dropped on it or pasted into it goes to the
//! service in pieces, is sensed there, and comes back as a chip the next message can carry.
use crate::api::{media_begin, media_done, media_piece, Chip};
use crate::core::media::b64;
use crate::ui::web::components::Attached;
use dioxus::html::FileData;
use dioxus::prelude::*;

/// Bytes of a file sent in one piece.
const PIECE: usize = 256 * 1024;

/// Send each file, saying in `attached` how far it is: `reading`, `sending 40%`, `sensing…`,
/// then what the service made of it, or the error.
pub async fn upload(files: Vec<FileData>, attached: Signal<Vec<Attached>>, next_key: Signal<u64>) {
    for f in files {
        let key = begin(&f.name(), attached, next_key);
        match f.read_bytes().await {
            Ok(bytes) => send(key, f.name(), f.content_type().unwrap_or_default(), bytes.to_vec(), attached).await,
            Err(e) => status(attached, key, format!("error: {e}"), None),
        }
    }
}

/// The same for bytes already in hand (a paste, a drop): `name` and `mime` say what they are.
pub async fn upload_bytes(name: String, mime: String, bytes: Vec<u8>, attached: Signal<Vec<Attached>>, next_key: Signal<u64>) {
    let key = begin(&name, attached, next_key);
    send(key, name, mime, bytes, attached).await;
}

fn begin(name: &str, mut attached: Signal<Vec<Attached>>, mut next_key: Signal<u64>) -> u64 {
    let key = next_key();
    next_key += 1;
    attached.write().push(Attached { key, name: name.to_string(), status: "reading".into(), chip: None });
    key
}

fn status(mut attached: Signal<Vec<Attached>>, key: u64, status: String, chip: Option<Chip>) {
    if let Some(p) = attached.write().iter_mut().find(|p| p.key == key) {
        p.status = status;
        p.chip = chip;
    }
}

async fn send(key: u64, name: String, mime: String, bytes: Vec<u8>, attached: Signal<Vec<Attached>>) {
    let sent: Result<Chip, String> = async {
        let id = media_begin(name, mime).await.map_err(|e| e.to_string())?;
        let total = bytes.len().max(1);
        for (i, piece) in bytes.chunks(PIECE).enumerate() {
            media_piece(id.clone(), b64(piece)).await.map_err(|e| e.to_string())?;
            status(attached, key, format!("sending {}%", ((i + 1) * PIECE).min(total) * 100 / total), None);
        }
        status(attached, key, "sensing…".into(), None);
        media_done(id).await.map_err(|e| e.to_string())
    }
    .await;
    match sent {
        Ok(c) => status(attached, key, c.status.clone(), Some(c)),
        Err(e) => status(attached, key, format!("error: {e}"), None),
    }
}
