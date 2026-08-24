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
  // RAISED IN THE EDITORIAL ROUND, in the same change that earns it. The floors
  // are the ROUND'S STATED GOAL and not flush against the measurement: a page
  // that reads as cinematic runs 6:1 to 12:1, and the ruled plate puts 68px at
  // 390 and 136px at 1440 over an 11px caption on ALL THREE routes — 6.18:1 and
  // 12.36:1. Dominance falls because ~one text node in three changed register
  // by KIND (editorial.css §7): output is READ and went up, an index or a state
  // is SCANNED and went down.
  var MIN_RANGE = 6.0;
  var MAX_DOMINANCE = 0.45;
  // ...AND THE ONE THE ROUND'S OWN CRITIC CAUGHT. Everything above counts every
  // text node in the DOCUMENT, and at 390 the Dashboard is 3,400px tall — so a
  // dominance earned over four screens of content was being reported as the
  // answer to "what does the first screen look like", which is the only
  // question the brief asks. Measured both ways on the same tree: whole-page
  // 38% / above-the-fold 70% on dash, 38/63 on chat, 43/65 on deck. The gate
  // was passing 0.45 on a page whose first screen is 70%. That is I17 turned
  // on its author: the claim the round says it earned is not the claim the
  // command executes.
  //
  // So the fold gets its own floor, ratcheted at today's measured worst rather
  // than at the goal — the fix for a too-generous gate is a second honest gate,
  // not a second aspirational one. RANGE survives fold-scoping unchanged
  // (6.18:1 above the fold on all three routes) and so keeps one floor.
  // RAISED 0.75 -> 0.70 IN LAP 2, in the change that earns it. The worst config
  // was 390x844 and 320x780 dash at 71% — one 68px word over a field of 11px
  // micro-caps with nothing between, which is the arithmetic signature of the
  // "cheap imitation" impression the round exists to answer. Two moves paid for
  // it and neither was a token: the agent tab band left the Dashboard's head
  // for the routed panel (`dashboard.rs`), which took 18 caption nodes off the
  // first screen with the nameplate; and the failure banner's remedy became a
  // 16px disclosure. Measured worst is now 65% at 54 configs, so 0.70 is the
  // ratchet at today's number with five points of air, not at an aspiration.
  var MAX_FOLD_DOMINANCE = 0.70;
  // A FOLD TOO SHORT TO HOLD CONTENT IS NOT A FOLD. 320x256 is the WCAG 1.4.10
  // case — 1280x1024 at 400% browser zoom — and 256px of viewport holds the
  // header and nothing else, so a ramp measured there measures the chrome. It
  // is the ONLY config that fails FOLDRANGE (3 steps, 11-16px, 1.45:1, on all
  // three routes in both skins) and it fails it for a reason that is correct:
  // somebody at 400% zoom is reading, not being sold a nameplate. Skipped
  // loudly rather than silently, and the whole-page assertions still run on it.
  var MIN_FOLD_PX = 400;

  // ONE SWEEP, TWO SCOPES. `foldOnly` keeps a node when any part of it is
  // painted inside the first viewport — the same rule a reader's eye uses.
  var sweep = function (foldOnly) {
    var sizes = {};
    var total = 0;
    document.querySelectorAll("body *").forEach(function (el) {
      if (!el.offsetParent && el !== document.body) return;
      var text = Array.prototype.some.call(el.childNodes, function (n) {
        return n.nodeType === 3 && n.textContent.trim();
      });
      if (!text || el.closest("#report")) return;
      if (foldOnly) {
        var r = el.getBoundingClientRect();
        if (r.top >= window.innerHeight || r.bottom <= 0) return;
      }
      var s = parseFloat(getComputedStyle(el).fontSize);
      if (!s) return;
      sizes[s] = (sizes[s] || 0) + 1;
      total++;
    });
    return { sizes: sizes, total: total };
  };

  var page = sweep(false);
  var sizes = page.sizes;
  var total = page.total;

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

  // ---- and the same question asked of the first screen only ----
  var fold = sweep(true);
  if (window.innerHeight < MIN_FOLD_PX) {
    info("RAMPFOLD", "fold is " + window.innerHeight + "px (< " + MIN_FOLD_PX
      + ") — zoom/short-viewport case, not judged on type");
  } else if (fold.total >= 12) {
    var fsteps = Object.keys(fold.sizes).map(Number).sort(function (a, b) { return a - b; });
    var ftop = 0, ftopSize = 0;
    fsteps.forEach(function (s) { if (fold.sizes[s] > ftop) { ftop = fold.sizes[s]; ftopSize = s; } });
    var fdom = ftop / fold.total;
    var frange = fsteps[fsteps.length - 1] / fsteps[0];

    info("RAMPFOLD", fsteps.length + " steps " + fsteps[0] + "-" + fsteps[fsteps.length - 1] + "px"
      + " range=" + frange.toFixed(2) + ":1"
      + " top=" + ftopSize + "px@" + (fdom * 100).toFixed(0) + "%"
      + " n=" + fold.total + " of " + total);

    say(fdom <= MAX_FOLD_DOMINANCE, "FOLDDOMINANCE",
      ftopSize + "px holds " + ftop + " of " + fold.total + " above-fold nodes = "
      + (fdom * 100).toFixed(0) + "% (max " + (MAX_FOLD_DOMINANCE * 100) + "%)");

    say(frange >= MIN_RANGE, "FOLDRANGE",
      fsteps[fsteps.length - 1] + "/" + fsteps[0] + " = " + frange.toFixed(2)
      + ":1 above the fold (floor " + MIN_RANGE + ":1)");
  } else {
    info("RAMPFOLD", "only " + fold.total + " text nodes above the fold — not judged");
  }

})();
