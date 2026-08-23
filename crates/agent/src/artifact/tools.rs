//! THE TWO CALLS AN ARTIFACT BRINGS WITH IT, and nothing else — no second
//! writer, no lister, no deleter. `write_file` already writes the file and
//! `list_files` already lists the folder; what the group had no way to say was
//! WHICH of those files is a deliverable and what it is for. These two say it
//! and read it back, and every other verb would be a second answer to a
//! question the workspace tools have already answered (ADR-013's rule, one
//! capability over).
//!
//! The descriptions are written for a 12B model: they say what the capability
//! IS, what it is FOR, and they claim exactly what the host delivers and no
//! more. `record_artifact` in particular does not promise that the file was
//! checked — it cannot, in a Worker (`super`'s header) — so it says what it
//! does say, which is that the record reaches everyone in the space.

use crate::tools::Tool;

/// The names, as constants, because the host matches on them and the block
/// names them: three copies of a string literal is three places to mistype it.
pub const RECORD_ARTIFACT: &str = "record_artifact";
pub const READ_ARTIFACT: &str = "read_artifact";

/// The two tools the artifacts faculty offers.
pub fn artifact_tools() -> Vec<Tool> {
    vec![
        Tool::new(
            RECORD_ARTIFACT,
            "Put a file you have written on this space's shelf, so every agent working here \
             sees it named and described in their prompt without reading it. 'name' is the \
             file's path in the workspace folder; 'description' is one line saying what it \
             is. 'kind' and 'audience' are optional. Recording the same name again replaces \
             the entry and counts up its revision.",
            &["name", "description", "kind", "audience"],
        ),
        Tool::new(
            READ_ARTIFACT,
            "Read an artifact on this space's shelf by its name. For a big one, add 'offset' \
             and 'limit' — whole numbers of BYTES — to read one window of it; the answer \
             states the whole file's size, so you can ask for the rest.",
            &["name"],
        ),
    ]
}

/// Whether this tool name is one of the shelf's own.
pub fn is_artifact_tool(name: &str) -> bool {
    name == RECORD_ARTIFACT || name == READ_ARTIFACT
}
