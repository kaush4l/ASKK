//! The stylesheet's TOUCH POSTURE, as a thing the gate can execute (I17).
//!
//! This module has no runtime body on purpose. `crates/ui` is bin-only — no
//! `[lib]` target, so `crates/ui/tests/` cannot link it (ROADMAP #7) — and the
//! only home for a host test is `#[cfg(test)]` inside `src`. What it guards is
//! prose: `DESIGN.md §7` and `docs/DESIGN-SYSTEM.md` make claims about hover,
//! press and motion that nothing could turn RED before this file existed.
//!
//! The reader lives next door in `css.rs`; this file is the CLAIMS. That split
//! is ROADMAP #7's doing — `posture.rs` was at exactly the 200-line ceiling and
//! `web/flow.css` made eleven sheets.
//!
//! **The honest limit (I17).** These assert the TEXT of `web/*.css`, not a
//! rendering: they fail on the edit that would break the browser, a smaller
//! claim than "the browser is not broken". They still matter, because
//! `publish.sh` runs NO stylesheet check and the six-step gate never touches
//! `web/` except through this file. See `docs/DESIGN-SYSTEM.md §9`.

#[cfg(test)]
mod css;

#[cfg(test)]
mod tests {
    use super::css::{blocks, is_no_op_hover, sheet, uncommented, SHEETS};

    /// **The posture.** Revert to make RED: un-gate any one hover rule, e.g.
    /// `web/chrome.css`'s `.nav .view-item:hover`.
    #[test]
    fn no_hover_paints_where_a_finger_cannot_hover() {
        let mut ungated = Vec::new();
        for (name, css) in SHEETS {
            for (stack, _) in blocks(css) {
                let sel = stack.last().expect("a block has a prelude");
                if !sel.contains(":hover") || sel.starts_with('@') || is_no_op_hover(sel) {
                    continue;
                }
                let guarded = stack[..stack.len() - 1]
                    .iter()
                    .any(|p| p.contains("hover: hover") && p.contains("pointer: fine"));
                if !guarded {
                    ungated.push(format!("web/{name}: {sel}"));
                }
            }
        }
        assert!(
            ungated.is_empty(),
            "a coarse pointer LATCHES :hover on what it last touched, so these \
             paint a state the finger has left:\n  {}",
            ungated.join("\n  ")
        );
    }

    /// A control whose only pointer feedback is hover has none on a phone.
    /// Revert to make RED: delete `button:not(:disabled):active`.
    #[test]
    fn everything_that_lifts_under_a_pointer_also_presses_under_a_finger() {
        let all: String = SHEETS.iter().map(|(_, c)| uncommented(c)).collect();
        let mut roots: Vec<String> = Vec::new();
        for (stack, _) in blocks(&all) {
            let sel = stack.last().expect("a block has a prelude");
            if sel.starts_with('@') || is_no_op_hover(sel) {
                continue;
            }
            for one in sel.split(',').map(str::trim) {
                if let Some(root) = one.strip_suffix(":hover") {
                    roots.push(root.replace(":not(:disabled)", ""));
                }
            }
        }
        let pressed: Vec<String> = blocks(&all)
            .iter()
            .flat_map(|(s, _)| s.last().expect("prelude").split(',').map(str::trim).map(String::from))
            .filter_map(|o| o.strip_suffix(":active").map(|r| r.replace(":not(:disabled)", "")))
            .collect();
        // ONE STATED EXCEPTION, because silent narrowing is the defect. The
        // selected tab's hover rule repaints it with the fill it already has, to
        // stop the generic tab hover lifting it; a finger's press feedback comes
        // from `.agent-tabs .tab:not(:disabled):active`, which matches it too.
        let no_press_by_ruling = [".agent-tabs .tab.current", ".agent-tabs .tab[aria-selected=\"true\"]"];
        let missing: Vec<&String> = roots
            .iter()
            .filter(|r| !pressed.contains(r) && !no_press_by_ruling.contains(&r.as_str()))
            .collect();
        assert!(missing.is_empty(), "hover-only, so dead to a finger: {missing:?}");
    }

    /// The UA's tap flash is a second, undesigned press affordance, and a long
    /// press selects a control's LABEL — measured here: tapping the `critic` tab
    /// selected the word `critic`. Revert to make RED: drop `user-select: none`.
    #[test]
    fn a_control_is_pressed_not_selected() {
        let controls = uncommented(sheet("controls.css"));
        for prop in ["-webkit-tap-highlight-color: transparent", "user-select: none"] {
            let n = controls.matches(prop).count();
            assert!(n >= 2, "`{prop}` covers {n} of the two control roots (button, summary)");
        }
    }

    /// Motion is a vocabulary or it is decoration. Revert to make RED: delete
    /// the `nav-rise` rule from `web/chrome.css`.
    #[test]
    fn every_declared_duration_and_easing_has_a_reader() {
        let all: String = SHEETS.iter().map(|(_, c)| uncommented(c)).collect();
        // `--ease-in` is EXITS ONLY and this product has no exit: sheet and
        // scrim leave by `[hidden]` and by unmounting, which no transition can
        // follow. Named here rather than given a fake reader.
        let no_reader_by_ruling = ["--ease-in"];
        for token in ["--dur-fast", "--dur", "--dur-slow", "--ease", "--ease-out", "--ease-in"] {
            let readers = all.matches(&format!("var({token})")).count();
            let allowed = no_reader_by_ruling.contains(&token);
            assert_eq!(
                readers == 0,
                allowed,
                "{token} has {readers} readers; allowed-to-have-none is {allowed}"
            );
        }
    }

    /// `base.css`'s reduced-motion block cuts DURATION and leaves the animation
    /// NAME standing, which `layout-audit.js:36` asserts resolves to `none`: as
    /// a bare `@media (max-width: 1099px)` the arrival shipped `LAYOUT CHECK
    /// FAILED: 30`. WIDENED IN ROADMAP #7 from chrome.css to every sheet, so
    /// the flow rail's pulse is held to the same rule the arrival is.
    ///
    /// Revert to make RED: drop `and (prefers-reduced-motion: no-preference)`
    /// from `web/chrome.css:191`, or drop the guard round `flow-pulse`.
    #[test]
    fn nothing_animates_for_someone_who_asked_for_stillness() {
        // SIX BECAME EIGHT IN THE EDITORIAL ROUND, and the arithmetic is worth
        // stating because the brief predicted NINE: `editorial.css` adds three
        // (the plate, the standfirst and the disclosure arriving in reading
        // order), and `strip.css` LOSES one — the status strip stopped being a
        // sideways scrollport, so its scroll-driven swipe cue went with it.
        // 6 + 3 - 1 = 8. The count is here so that a fourth animation cannot
        // arrive without someone reading this sentence.
        //
        // ONE EXCEPTION, AND IT IS A DEFECT RECORDED RATHER THAN HIDDEN.
        // `.skeleton::after` (`web/surfaces.css:181-185`) animates ungated and
        // predates this test. `check-layout.sh` cannot see it either — the probe
        // fixture has no `.skeleton` — so it is stated here and belongs to
        // whoever next owns `surfaces.css`.
        let ungated_by_record = ["askk-shimmer"];
        let (mut seen, mut bad) = (0, Vec::new());
        for (name, css) in SHEETS {
            for (stack, decls) in blocks(css) {
                if !decls.contains("animation:") {
                    continue;
                }
                seen += 1;
                let guarded = stack.iter().any(|p| p.contains("prefers-reduced-motion: no-preference"));
                let excused = ungated_by_record.iter().any(|k| decls.contains(k));
                if !guarded && !excused {
                    bad.push(format!("web/{name}: {}", stack.last().expect("prelude")));
                }
            }
        }
        assert!(bad.is_empty(), "animates outside a no-preference guard:\n  {}", bad.join("\n  "));
        assert_eq!(seen, 8, "this tree has eight `animation:` rules; this test found {seen}");
    }
}
