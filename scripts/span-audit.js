// SPAN QUALITY, ASSERTED (the ground-up round). Its own file for the reason
// ramp-audit.js is its own file: that one is at the 200-line rule (I12) and its
// header records being split out of layout-probe.js for exactly this, so
// growing it to carry a second concern would repeat the mistake it documents.
//
// The concern here is NOT the ramp. It is one question about one mechanism:
// when a word is spanned to its box, is it still a word? `textLength` makes the
// span exact by construction, which means the obvious measurement — span error
// — can never fail, and a round shipped `m    a    i    n` to production with a
// clean 0.0px at all eleven widths to prove it was fine.
//
// Runs after ramp-audit.js and before layout-audit.js, which writes #report
// last; a verdict pushed after that file would not reach the reader.
(function () {
  var P = window.__probe;
  var say = P.say;

  // THE CEILING.
  // A `<text textLength="100%">` spans its box BY CONSTRUCTION, so span error is
  // 0.0px however far the word was pulled apart to do it — the metric a
  // maximally over-tracked word satisfies BEST. Measuring it is how
  // `m    a    i    n` shipped: the subject plate took the nameplate's span
  // mechanism and stretched a four-letter agent name 6.87x at 1920, 350.9px per
  // gap. Every 0.0 in that round's report was true. So assert what span error is
  // a proxy FOR — box over the word's own natural width. Ceiling 2.0 because
  // HARNESS, the one word spanned on purpose, measures 1.13x-1.91x: clears the
  // real case with air, catches 6.33x threefold. Raise it only in a change that
  // shows the word still reads.
  var MAX_STRETCH = 2.0;
  document.querySelectorAll("text[textLength]").forEach(function (t, i) {
    var box = t.getBoundingClientRect().width;
    if (!box) return;
    // The same node without the span, measured and thrown away: the only honest
    // source of "how wide does this word want to be".
    var clone = t.cloneNode(true);
    clone.removeAttribute("textLength");
    clone.removeAttribute("lengthAdjust");
    t.parentNode.appendChild(clone);
    var natural = clone.getBoundingClientRect().width;
    clone.remove();
    if (!natural) return;
    var ratio = box / natural;
    var word = (t.textContent || "").trim();
    say(ratio <= MAX_STRETCH, "STRETCH",
      JSON.stringify(word) + " set in " + box.toFixed(0) + "px of box on "
      + natural.toFixed(0) + "px of natural type = " + ratio.toFixed(2)
      + "x (max " + MAX_STRETCH.toFixed(1) + "x)"
      + (word.length > 1
        ? ", " + ((box - natural) / (word.length - 1)).toFixed(0) + "px per gap"
        : " — ONE GLYPH, which has no gap to distribute: a spanned word of one"
          + " letter renders at natural width and leaves its rule short"));
  });

})();
