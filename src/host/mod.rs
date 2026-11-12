//! # Host: everything that touches the machine (server only)
//!
//! The core says what happens; the host does it on this computer.
//!
//! | file | touches |
//! | --- | --- |
//! | `store.rs` | the data folder (or one JSON file): the disk forms of the store |
//! | `world.rs` | boot: lock → seed → load → init; the running engines |
//! | `infer/` | model servers and command-line models |
//! | `harness/` | other agents' programs (one file per kind) and the path a session's prompt takes |
//! | `workspace.rs` | files and commands in the workspace; jobs |
//! | `market.rs` | market data |
//! | `data.rs` | the user's own data files, read as tables |
//! | `media.rs` | what the user attached (images, sound, video) and the commands that sense it |
//! | `tools.rs` | the tools every engine shares |
//! | `changes.rs` | sleeping until something changes (the windows' one feed) |
//!
//! The host also names who runs background work ([`crate::core::tasks`]): the server's runtime.
pub mod changes;
pub mod code;
pub mod data;
pub mod harness;
pub mod infer;
pub mod market;
pub mod media;
pub mod room;
pub mod store;
pub mod tools;
pub mod workspace;
pub mod world;

/// Start the host: read the command line, boot the world.
pub fn start(args: Vec<String>) {
    crate::core::places::take_args(&args);
    store::start();
    crate::core::files::set(std::sync::Arc::new(workspace::Disk));
    crate::core::media::set(std::sync::Arc::new(media::Kept));
    crate::core::tasks::set(std::sync::Arc::new(Runtime));
    crate::core::tables::set(std::sync::Arc::new(data::Personal));
    crate::core::world::boots_with(world::start);
    // What this build can do, noted beside the lines that make it so (core/caps.rs).
    use crate::core::caps::provided;
    provided("store", "the data folder on this machine");
    provided("engines", "booted from the data folder at start");
    provided("background", "the server's own runtime");
    provided("files", "files and commands on this machine");
    provided("senses", "programs on this machine (ffmpeg, a local model)");
    provided("tables", "the user's personal folder");
    provided("models", "model servers and command-line models");
    provided("sessions", "other agents' programs (harnesses)");
    if code::found() {
        crate::core::code::set(std::sync::Arc::new(code::Node));
        provided("code", "node on this machine, in an empty context (JavaScript)");
    }
    world::boot_now();
}

/// Background work runs on the server's runtime (the caller is always inside it).
struct Runtime;

impl crate::core::tasks::Tasks for Runtime {
    fn spawn(&self, work: crate::core::Fut<()>) {
        tokio::spawn(work);
    }
}
