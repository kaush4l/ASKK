//! The seed: what a fresh engines folder starts with. It is `defaults/engines/` itself,
//! embedded at build time (core/build.rs), written out as files and read back like any other
//! configuration. Edit the files there; nothing about them lives in code.

use anyhow::Result;

use crate::Store;

include!(concat!(env!("OUT_DIR"), "/seed_files.rs"));

pub fn write(store: &dyn Store) -> Result<()> {
    for (path, text) in FILES.iter() {
        store.write_text(path, text)?;
    }
    Ok(())
}
