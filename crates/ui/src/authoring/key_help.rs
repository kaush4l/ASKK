//! WHAT THE KEYS IN AN AGENT FILE MEAN (R16-P1-6), and who the repository
//! instructions are for. `authoring/mod.rs` owns the textarea; this owns the
//! prose beside it, which is copy a reader depends on rather than markup.
//!
//! The Agents view explains itself in plain English and then hands over a
//! textarea of YAML whose keys — `engine`, `space`, `tools`, `compact_at`,
//! `keep_recent`, `max_rounds` — were defined nowhere in the product. One line
//! each, beside the field, in the same words the rest of the interface uses.

use dioxus::prelude::*;

use crate::ui::{Button, Disclosure};
use crate::shell::views::View;

/// Every key `agent::parse_agent_file` reads, glossed. The list is the
/// loader's, in the order the blank file writes them, so a key that exists in
/// the parser and not here is a visible gap rather than a silent one.
///
/// `engine` is glossed WITHOUT the word engine (R16-4) — Settings calls the
/// Linux that — and `max_rounds` is glossed without the word round (R16-3),
/// which appears nowhere else in this interface and would be a third counter
/// beside "turns" and the tool trace. The key names itself; the sentence says
/// what it does.
const KEYS: &[(&str, &str)] = &[
    ("name", "what you will call it everywhere else"),
    ("description", "one line, shown beside its name and read by agents that can delegate to it"),
    ("model", "which model to ask, by its name in the endpoint's catalogue; blank means the endpoint's default"),
    ("temperature", "how loose its wording is, 0 to 2; leave it out to take the model's own"),
    ("engine", "how it works: react calls a tool, reads the result, then decides again; base answers in one reply and calls nothing"),
    ("role", "which job in this app it holds: entry is the agent this page talks to, summarizer is the one that compacts every other agent's history. Leave it out and it holds neither"),
    ("stages", "the loop it runs, in order: plan turns your request into a brief before any work, work is the tool loop, verify runs the check the brief named, critique reads the turn back before answering. Leave it out and it runs work alone"),
    ("space", "the name of the group it works in — it gets a folder in the Linux this page runs, and the facts and notes every agent naming the same space shares"),
    ("tools", "which tools it may call. tools: [] is EVERY built-in one; tools: [now] is only that one"),
    ("compact_at", "how many turns it keeps in full before the oldest are summarised: 8"),
    ("keep_recent", "how many of the newest turns are never summarised: 3"),
    ("max_rounds", "how many steps it may take in one turn before it must stop: 64"),
];

/// THE PATH THAT ALREADY WORKS, SAID FIRST (R17-P1-7). The plain-English route
/// — tell `author` what you want and it writes and installs the agent — was
/// mentioned nowhere on the panel whose whole subject is writing one, so it was
/// found only by people who went looking. It leads somewhere: the door is the
/// same route every other card uses, so this holds no state of its own.
pub fn ask_author(here: bool) -> Element {
    if !here {
        return rsx! {};
    }
    rsx! {
        p { class: "note",
            "You do not have to write this file yourself. Tell "
            strong { "author" }
            " what you want in plain English — \"an agent that reads a recipe and tells me the \
             shopping list, call it shopper\" — and it writes the file and installs it. Editing \
             below is the other way, for when you want the exact words."
        }
        div { class: "row",
            Button {
                variant: "secondary",
                onclick: move |_| crate::shell::route::show(View::Chat, "author"),
                "Ask author to write one"
            }
        }
    }
}

/// The gloss list, then the two disclosures — the format, and the repository.
pub fn notes() -> Element {
    rsx! {
        // THE ONE KEY WHOSE NAME IS NOT THE WORD THE PAGE USES (R17-P1-8), on
        // the fold's own summary: `space:` is the workspace, and a reader who
        // never opens this list still meets the pair. The key is glossed, not
        // renamed — renaming it is a change to a stored data format, and it
        // would silently split every agent file already written.
        Disclosure { summary: "What each setting in the file means — space: names the group it works in",
            dl { class: "key-gloss",
                for (key, said) in KEYS.iter().copied() {
                    dt { key: "{key}", "{key}" }
                    dd { "{said}" }
                }
            }
        }
        Disclosure { summary: "The file format, and how long an agent lasts",
            p { class: "note",
                "The file is an agent.md: YAML frontmatter, then the instructions the agent \
                 follows. What you save here takes effect at the end of the current turn — no \
                 reload — and beats a shipped agent of the same name, so an agent named main \
                 replaces main until you delete it again. It is kept in this browser: \
                 clearing this site's data takes it with them, and another browser does not \
                 have it. Export downloads the same file the site serves."
            }
        }
        // …AND THE REPOSITORY INSTRUCTIONS SAY WHO THEY ARE FOR (R16-P1-6). Two
        // steps for committing a file to `public/agents/` sat inside the one
        // fold that looked like help for the person in the browser, who has no
        // repository and cannot follow either step.
        Disclosure { summary: "If you have this site's source and want to ship the agent with it",
            p { class: "note",
                "This part is for whoever builds the site, not for using it here. Committing \
                 an exported file takes two steps, not one: put it at \
                 public/agents/<name>/agent.md, AND add <name> to public/agents/index.json — \
                 that file is the manifest, and a folder it does not list is never fetched."
            }
        }
    }
}
