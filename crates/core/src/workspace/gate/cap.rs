//! THE CEILING ON ONE TOOL RESULT. Every workspace call's output goes into the
//! next prompt whole, and `find / -type f` in the guest is megabytes: one call
//! could spend the entire context window and the turn after it would have no
//! room to say what it found.
//!
//! WHAT MAKES THIS SAFE IS THE SENTENCE IN THE MIDDLE. A silent truncation
//! would be a worse defect than the one it fixes — a model reading a cut
//! listing as the whole listing concludes the file is not there — so the cut
//! states its own size, the command's true size, and WHOSE act it was. The
//! head and the tail both survive because the two ends carry different things:
//! a command's first lines are what it is doing and its last lines are how it
//! ended.

/// The most one tool result may carry. Chosen against the prompt rather than
/// against the guest: a 12 KB result is already the largest block in most
/// prompts, and two of them in one turn is most of a small model's window.
const CEILING: usize = 12_000;
/// Weighted towards the HEAD — a listing's beginning identifies what is being
/// listed — with enough tail left for the way a command ended.
const HEAD: usize = 8_000;
const TAIL: usize = 4_000;

/// `output`, cut to [`CEILING`] if it is over it, with the cut announced in
/// place. Under the ceiling this is the identity: the cap must never become a
/// trimmer that edits ordinary answers.
pub(super) fn capped(output: String) -> String {
    if output.len() <= CEILING {
        return output;
    }
    let head = boundary(&output, HEAD);
    let tail = boundary(&output, output.len() - TAIL);
    format!(
        "{}{}{}",
        &output[..head],
        notice(tail - head, output[head..tail].lines().count(), output.len(), head, output.len() - tail),
        &output[tail..]
    )
}

/// The sentence the model reads where the missing bytes were. It names the
/// harness explicitly, because everything else in this field is bytes the
/// guest printed and a reader has no other way to tell the two apart.
fn notice(bytes: usize, lines: usize, whole: usize, kept_head: usize, kept_tail: usize) -> String {
    format!(
        "\n\n… THE HARNESS CUT {bytes} BYTES ({lines} lines) OUT OF THE MIDDLE OF THIS OUTPUT. \
         The command printed {whole} bytes in total and one tool result may carry {CEILING}, so \
         you are reading its first {kept_head} bytes and its last {kept_tail} bytes. The gap is \
         this product's doing, not the command's, and nothing on either side of it was altered. \
         To see what is in the gap, narrow the command — grep, head, wc -l, or a redirect to a \
         file you then read in pieces.\n\n"
    )
}

/// The largest char boundary at or below `at`, so a cut never lands inside a
/// UTF-8 character and hands the model a byte that is not text.
fn boundary(said: &str, mut at: usize) -> usize {
    while at > 0 && !said.is_char_boundary(at) {
        at -= 1;
    }
    at
}
