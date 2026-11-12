//! Attaching: a file chosen in the composer goes to the service in pieces, is sensed there,
//! and comes back as a chip the next message can carry.
use crate::api::{media_begin, media_done, media_piece, Chip};
use crate::core::media::b64;
use crate::ui::web::components::Attached;
use dioxus::html::FileData;
use dioxus::prelude::*;

/// Bytes of a file sent in one piece.
const PIECE: usize = 256 * 1024;

/// Send each file, saying in `attached` how far it is: `reading`, `sending 40%`, `sensing…`,
/// then what the service made of it, or the error.
pub async fn upload(files: Vec<FileData>, mut attached: Signal<Vec<Attached>>, mut next_key: Signal<u64>) {
    for f in files {
        let key = next_key();
        next_key += 1;
        let name = f.name();
        attached.write().push(Attached { key, name: name.clone(), status: "reading".into(), chip: None });
        let mut set = move |status: String, chip: Option<Chip>| {
            if let Some(p) = attached.write().iter_mut().find(|p| p.key == key) {
                p.status = status;
                p.chip = chip;
            }
        };
        let sent: Result<Chip, String> = async {
            let bytes = f.read_bytes().await.map_err(|e| e.to_string())?;
            let id = media_begin(name, f.content_type().unwrap_or_default()).await.map_err(|e| e.to_string())?;
            let total = bytes.len().max(1);
            for (i, piece) in bytes.chunks(PIECE).enumerate() {
                media_piece(id.clone(), b64(piece)).await.map_err(|e| e.to_string())?;
                set(format!("sending {}%", ((i + 1) * PIECE).min(total) * 100 / total), None);
            }
            set("sensing…".into(), None);
            media_done(id).await.map_err(|e| e.to_string())
        }
        .await;
        match sent {
            Ok(c) => set(c.status.clone(), Some(c)),
            Err(e) => set(format!("error: {e}"), None),
        }
    }
}
