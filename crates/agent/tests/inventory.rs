//! THE DECLARATION AGAINST ITS SOURCE (I16). `image/Dockerfile` holds the
//! named-caller inventory of every binary the guest has, argued applet by
//! applet with the calling site for each. `crates/agent/src/environment.rs`
//! holds the same list as a VALUE, because a comment is a truth no test and no
//! model can read — which is the defect I16 exists to name, and this file is
//! the pair that keeps the two honest.
//!
//! THE DOCKERFILE IS THE SOURCE OF TRUTH AND THE DECLARATION IS ITS COPY. That
//! direction matters: the Dockerfile is what a person edits when the image
//! changes, so a name added there and forgotten here must fail, and this test
//! is the only thing that can notice. `echo` was missing from the comment for
//! as long as the comment was the only copy.
//!
//! WHAT THIS CANNOT DO, said plainly because I16 requires it: this checks the
//! declaration against ANOTHER DOCUMENT, not against the image. Only a build
//! settles what the guest really contains, and the build is frozen. So a name
//! wrong in BOTH places is invisible to this test and to every other test in
//! the tree.

/// The Dockerfile, compiled in so the check runs on the host with no I/O (I3).
const DOCKERFILE: &str = include_str!("../../../image/Dockerfile");

/// The inventory block's own bounds, in the Dockerfile's own words.
const OPENS: &str = "The complete named-caller inventory, from the source:";
const CLOSES: &str = "Nothing in crates/ shells out to";

/// Every applet the Dockerfile's inventory names.
///
/// The shape it reads: a line opening `#` then exactly three spaces then a
/// name begins the entry; anything else inside the block is a wrapped citation
/// and carries no names. The names run to the first run of two-or-more spaces,
/// which is where the citation column starts. `/bin/sh` is written with its
/// path in the source and is the same applet as `sh`.
fn dockerfile_inventory() -> Vec<String> {
    let block = DOCKERFILE
        .split_once(OPENS)
        .expect("the inventory block still opens with its own sentence")
        .1
        .split_once(CLOSES)
        .expect("…and still closes with the absent-tools sentence")
        .0;
    let mut found = Vec::new();
    for line in block.lines() {
        let Some(entry) = line.strip_prefix("#   ").filter(|e| !e.starts_with(' ')) else {
            continue;
        };
        let names = entry.split("  ").next().unwrap_or_default();
        for name in names.split(',') {
            let name = name.trim().trim_start_matches("/bin/");
            if !name.is_empty() {
                found.push(name.to_string());
            }
        }
    }
    assert!(found.len() > 20, "the block was read, not merely matched: {found:?}");
    found
}

/// The six the Dockerfile says out loud are NOT here.
fn dockerfile_absent() -> Vec<String> {
    let sentence = DOCKERFILE
        .split_once(CLOSES)
        .expect("the absent-tools sentence is still there")
        .1
        .split_once('.')
        .expect("…and still ends in a full stop")
        .0;
    sentence
        .replace(" or ", ", ")
        .split(',')
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty() && n != "a compiler")
        .collect()
}

/// THE CLASS TEST. Not "is `echo` there" — whether the two copies AGREE, for
/// every name either of them holds. A package added, removed or renamed in the
/// Dockerfile and not mirrored into the declaration fails here, and so does the
/// reverse: a name in the declaration the source never justified.
#[test]
fn the_declaration_and_its_source_name_the_same_binaries() {
    let source = dockerfile_inventory();
    let declared: Vec<&str> = agent::GUEST_BINARIES.to_vec();
    for name in &source {
        assert!(
            declared.contains(&name.as_str()),
            "`{name}` is in the Dockerfile's inventory and not in environment.rs::GUEST_BINARIES — \
             the model is never told about a binary the guest has"
        );
    }
    for name in &declared {
        assert!(
            source.contains(&name.to_string()),
            "environment.rs::GUEST_BINARIES claims `{name}`, which the Dockerfile's inventory does \
             not justify — the model is told about a binary nothing says is there"
        );
    }
}

/// …AND THE SAME ABSENCES. Telling a model `python3` is missing is a claim like
/// any other, and it is checked against the same source.
#[test]
fn the_declaration_and_its_source_name_the_same_absences() {
    let source = dockerfile_absent();
    for name in &source {
        assert!(
            agent::GUEST_ABSENT.contains(&name.as_str()),
            "the Dockerfile says `{name}` is not in this guest and environment.rs::GUEST_ABSENT \
             does not carry it"
        );
    }
    for name in agent::GUEST_ABSENT {
        assert!(
            source.contains(&name.to_string()) || name == "a compiler" || name == "compiler",
            "environment.rs::GUEST_ABSENT claims `{name}` is missing; the Dockerfile does not say so"
        );
    }
}

/// A NAME CANNOT BE IN BOTH LISTS. The one contradiction the two halves could
/// express between them, and the cheapest possible test for it.
#[test]
fn nothing_is_both_present_and_absent() {
    for name in agent::GUEST_ABSENT {
        assert!(
            !agent::GUEST_BINARIES.contains(&name),
            "`{name}` is declared both installed and absent"
        );
    }
}
