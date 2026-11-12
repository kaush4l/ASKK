//! # Diff: what a run changed in a file, as the lines that changed
//!
//! A file as it was and as it is now become a unified diff (the form `git diff` prints), so
//! the one reader that colours a fenced `diff` (`code.rs`) colours it too.
//!
//! | question | answer |
//! | --- | --- |
//! | which lines? | the fewest lines taken away and added that turn one into the other (a longest common run of lines) |
//! | how much around them? | three unchanged lines on each side; hunks that touch are one |
//! | a very large file? | past [`MAX_CELLS`] lines × lines it is shown as taken away whole and added whole, and said so |

/// The most lines × lines compared one by one.
pub const MAX_CELLS: usize = 2_000_000;
/// Unchanged lines shown around each change.
const AROUND: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Op {
    Same(usize, usize),
    Gone(usize),
    New(usize),
}

/// The steps from `a` to `b`, in order.
fn ops(a: &[&str], b: &[&str]) -> (Vec<Op>, bool) {
    // What both start and end with is the same: compare only what lies between.
    let head = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let tail = a[head..].iter().rev().zip(b[head..].iter().rev()).take_while(|(x, y)| x == y).count();
    let (x, y) = (&a[head..a.len() - tail], &b[head..b.len() - tail]);
    let mut out: Vec<Op> = (0..head).map(|i| Op::Same(i, i)).collect();
    let whole = (x.len() + 1) * (y.len() + 1) > MAX_CELLS;
    if whole {
        out.extend((0..x.len()).map(|i| Op::Gone(head + i)));
        out.extend((0..y.len()).map(|j| Op::New(head + j)));
    } else {
        // How long the longest common run is from each pair of places on.
        let w = y.len() + 1;
        let mut l = vec![0u32; (x.len() + 1) * w];
        for i in (0..x.len()).rev() {
            for j in (0..y.len()).rev() {
                l[i * w + j] = if x[i] == y[j] { l[(i + 1) * w + j + 1] + 1 } else { l[(i + 1) * w + j].max(l[i * w + j + 1]) };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < x.len() || j < y.len() {
            if i < x.len() && j < y.len() && x[i] == y[j] {
                out.push(Op::Same(head + i, head + j));
                i += 1;
                j += 1;
            } else if i < x.len() && (j == y.len() || l[(i + 1) * w + j] >= l[i * w + j + 1]) {
                // What goes is shown before what comes in its place.
                out.push(Op::Gone(head + i));
                i += 1;
            } else {
                out.push(Op::New(head + j));
                j += 1;
            }
        }
    }
    out.extend((0..tail).map(|k| Op::Same(a.len() - tail + k, b.len() - tail + k)));
    (out, whole)
}

/// How many lines were added and taken away.
pub fn counts(before: Option<&str>, after: &str) -> (usize, usize) {
    let (a, b): (Vec<&str>, Vec<&str>) = (before.unwrap_or_default().lines().collect(), after.lines().collect());
    let (ops, _) = ops(&a, &b);
    (ops.iter().filter(|o| matches!(o, Op::New(_))).count(), ops.iter().filter(|o| matches!(o, Op::Gone(_))).count())
}

/// `path` as it was (`None`: it did not exist) and as it is, as a unified diff. Empty when
/// nothing changed.
pub fn unified(path: &str, before: Option<&str>, after: &str) -> String {
    let a: Vec<&str> = before.unwrap_or_default().lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let (ops, whole) = ops(&a, &b);
    let changed: Vec<usize> = ops.iter().enumerate().filter(|(_, o)| !matches!(o, Op::Same(..))).map(|(k, _)| k).collect();
    if changed.is_empty() {
        return String::new();
    }
    let mut out = vec![if before.is_some() { format!("--- a/{path}") } else { "--- /dev/null".to_string() }, format!("+++ b/{path}")];
    if whole {
        out.push("# too long to compare line by line: shown taken away whole and added whole".into());
    }
    // Hunks: each change with the lines around it; changes whose surroundings touch are one.
    let mut spans: Vec<(usize, usize)> = vec![];
    for k in changed {
        let (from, to) = (k.saturating_sub(AROUND), (k + AROUND + 1).min(ops.len()));
        match spans.last_mut() {
            Some(last) if from <= last.1 => last.1 = to,
            _ => spans.push((from, to)),
        }
    }
    for (from, to) in spans {
        let part = &ops[from..to];
        // Where the hunk begins on each side (1-based), and how many lines it has there.
        let start_a = part.iter().find_map(|o| match o { Op::Same(i, _) | Op::Gone(i) => Some(*i), _ => None });
        let start_b = part.iter().find_map(|o| match o { Op::Same(_, j) | Op::New(j) => Some(*j), _ => None });
        let len_a = part.iter().filter(|o| !matches!(o, Op::New(_))).count();
        let len_b = part.iter().filter(|o| !matches!(o, Op::Gone(_))).count();
        let at = |s: Option<usize>, n: usize| if n == 0 { s.unwrap_or(0) } else { s.map_or(1, |s| s + 1) };
        out.push(format!("@@ -{},{len_a} +{},{len_b} @@", at(start_a, len_a), at(start_b, len_b)));
        for o in part {
            out.push(match o {
                Op::Same(i, _) => format!(" {}", a[*i]),
                Op::Gone(i) => format!("-{}", a[*i]),
                Op::New(j) => format!("+{}", b[*j]),
            });
        }
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_is_shown_with_the_lines_around_it() {
        let before = "a\nb\nc\nd\ne\nf\ng\nh\ni\n";
        let after = "a\nb\nc\nd\nE\nf\ng\nh\ni\nj\n";
        let d = unified("x.rs", Some(before), after);
        assert_eq!(d, "--- a/x.rs\n+++ b/x.rs\n@@ -2,8 +2,9 @@\n b\n c\n d\n-e\n+E\n f\n g\n h\n i\n+j");
        assert_eq!(counts(Some(before), after), (2, 1));
        assert_eq!(unified("x.rs", Some("same\n"), "same\n"), "", "nothing changed, nothing shown");
    }

    #[test]
    fn a_new_file_is_all_added_and_far_changes_are_two_hunks() {
        assert_eq!(unified("n.md", None, "one\ntwo"), "--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+one\n+two");
        let before: String = (1..=20).map(|i| format!("{i}\n")).collect();
        let after: String = (1..=20).map(|i| match i { 2 => "two\n".to_string(), 19 => "nineteen\n".to_string(), i => format!("{i}\n") }).collect();
        let d = unified("f", Some(&before), &after);
        assert_eq!(d.matches("@@ ").count(), 2, "{d}");
        assert!(d.contains("-2\n+two") && d.contains("-19\n+nineteen"), "{d}");
    }
}
