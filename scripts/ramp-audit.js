// THE TYPE RAMP, ASSERTED (the UI uplift round). DESIGN.md §10 item 13 is a
// pass/fail criterion — "the ramp is USED" — and until this file existed
// nothing executed it. `layout-audit.js:24` prints `INFO SIZES` and stops, so
// the criterion was a sentence in a document that no command could fail on.
// That is exactly I17: a claim the gate cannot execute is not a verified claim.
//
// It is its own file because layout-audit.js is 245 lines and its own header
// records that it was split out of layout-probe.js at the 200-line rule (I12).
// Growing it to carry this would have repeated the mistake it documents.
//
// It runs BEFORE layout-audit.js on purpose: that file writes #report last, so
// a verdict pushed after it would not reach the reader.
(function () {
  var P = window.__probe;
  var say = P.say, info = P.info;

  // THE RATCHET. Not a target — a floor that has already been cleared, so the
  // gate can only ever move upward, by hand and in writing, each time a round
  // earns it.
  //
  // THE FIRST THING IT DID WAS CATCH ITS OWN AUTHOR. These constants were set
  // from docs/UPLIFT-FINDINGS.md F2, which measured 2.91:1 and 55% — on the
  // DASHBOARD, which turns out to be the best route in the product. Run across
  // all three routes at nine widths the real worst case is:
  //
  //     dash   6 steps  11-32px  range 2.91:1  top 14px @ 65%
  //     chat   5 steps  11-20px  range 1.82:1  top 14px @ 72%
  //     deck   4 steps  11-18px  range 1.64:1  top 14px @ 72%
  //
  // So chat and deck carry NO display type at all, and on both of them a
  // single 14px step holds nearly three quarters of the rendered text. F2 was
  // measured on the one screen that has a masthead, and it flattered the page.
  //
  // The floors below are therefore the measured worst case and not the
  // Dashboard's: this assertion passes today and would fail the moment any
  // route regressed past the worst one that currently ships. The round's goal
  // is range 6.0 and dominance 0.45 — a page that reads as cinematic runs
  // between 6:1 and 12:1 — and raising these two constants is that round's
  // exit criterion, not its opening move. A gate that fails on the day it is
  // written teaches the next reader to edit the gate.
  var MIN_RANGE = 1.6;
  var MAX_DOMINANCE = 0.75;

  var sizes = {};
  var total = 0;
  document.querySelectorAll("body *").forEach(function (el) {
    if (!el.offsetParent && el !== document.body) return;
    var text = Array.prototype.some.call(el.childNodes, function (n) {
      return n.nodeType === 3 && n.textContent.trim();
    });
    if (!text || el.closest("#report")) return;
    var s = parseFloat(getComputedStyle(el).fontSize);
    if (!s) return;
    sizes[s] = (sizes[s] || 0) + 1;
    total++;
  });

  // A page with almost nothing rendered on it cannot be judged on its ramp,
  // and saying so beats reporting a confident ratio over four nodes. The
  // probe renders every route, and the thin ones are thin on purpose.
  if (total < 12) {
    info("RAMP", "only " + total + " text nodes rendered — not judged");
    return;
  }

  var steps = Object.keys(sizes).map(Number).sort(function (a, b) { return a - b; });
  var smallest = steps[0];
  var largest = steps[steps.length - 1];
  var range = largest / smallest;

  var top = 0;
  var topSize = 0;
  steps.forEach(function (s) { if (sizes[s] > top) { top = sizes[s]; topSize = s; } });
  var dominance = top / total;

  info("RAMP", steps.length + " steps " + smallest + "-" + largest + "px"
    + " range=" + range.toFixed(2) + ":1"
    + " top=" + topSize + "px@" + (dominance * 100).toFixed(0) + "%"
    + " n=" + total);

  say(range >= MIN_RANGE, "RAMPRANGE",
    largest + "/" + smallest + " = " + range.toFixed(2) + ":1 (floor " + MIN_RANGE + ":1)");

  say(dominance <= MAX_DOMINANCE, "RAMPDOMINANCE",
    topSize + "px holds " + top + " of " + total + " nodes = "
    + (dominance * 100).toFixed(0) + "% (max " + (MAX_DOMINANCE * 100) + "%)");
})();
