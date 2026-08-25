// The deck's own assertions (27 and 30), split out of `layout-probe.js` at
// the 200-line rule (I12). Every one exists because a defect shipped past a
// gate that was green: DECKMONO because DECKCELLS asks at one width, CLIPPED
// because a cap on a child is invisible to a check that measures the parent,
// and SWIPECUE because the answer increment 24 found for one scrollport was
// never made a rule that the next one had to follow.
//
// Reads `window.__probe`, which `layout-probe.js` builds — including `region`,
// the ROUTED view. Measuring `document` instead would read hidden views, whose
// grids answer with the unresolved `repeat(auto-fit, …)` they were given.
(function () {
  var P = window.__probe;
  if (!P) return;
  var say = P.say, info = P.info, W = P.W, region = P.region;

  // THE DECK'S CARDS ARE THE DECK'S CELLS (27). `display: grid` on the
  // Dashboard's board says nothing about whether the CARDS are its items: two
  // wrappers stand between them in the shipped tree, and with either one left
  // in place the grid formed one column and every card stacked inside it. The
  // page still passed OVERFLOW, ONESCREEN and every contrast check, because a
  // single-column deck is a perfectly valid layout — it is just not the one
  // that was written. So the assertion is on the OUTCOME and not on the tree:
  // where the deck is wide enough for two 18rem tracks, two cards must share a
  // row. Checking `parentElement` would not do it — `display: contents` is
  // exactly the mechanism that makes a descendant a grid item without moving
  // it in the DOM, so the tree says orphan while the layout is correct.
  // Compact is exempt by its own rule: one column is what the rail asks for.
  document.querySelectorAll(".board:not(.compact)").forEach(function (deck) {
    var cards = deck.querySelectorAll(".agent-row");
    var wide = deck.getBoundingClientRect().width >= 36 * 16;
    if (cards.length < 2 || !wide || getComputedStyle(deck).display !== "grid") return;
    var a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect();
    say(Math.abs(a.top - b.top) < 1, "DECKCELLS",
        Math.abs(a.top - b.top) < 1
          ? cards.length + " cards share a row in " + Math.round(deck.getBoundingClientRect().width) + "px"
          : "cards stacked in a " + Math.round(deck.getBoundingClientRect().width) +
            "px deck that has room for two");
  });

  // ---- DECKMONO: the widest screen may not give the deck the fewest columns.
  // DECKCELLS asks at ONE width whether the cards are the deck's cells, and the
  // deployed 1440 page passed it while stacking all eight in a 430px column
  // beside 1313px of nothing: the deck was the launcher's COMPANION, so
  // crossing the 66rem container query cut it from three tracks to one —
  // 390:1, 768:2, 1100:2, 1440:1. That defect is a COMPARISON between two
  // widths and a probe renders one, so the container is driven directly here.
  // Inside the ROUTED region, never `document`: a `display: none` grid answers
  // `gridTemplateColumns` with the unresolved `repeat(auto-fit, …)` it was
  // given — four tokens, a monotone PASS over a board nobody was shown.
  var vp = region.classList.contains("view-panel") ? region
                                                  : region.querySelector(".view-panel");
  var mono = region.querySelector(".board:not(.compact)");
  if (vp && mono) {
    var saved = vp.getAttribute("style");
    var seen = [], drop = null, was = 0;
    [320, 480, 640, 800, 960, 1120, 1280].forEach(function (w) {
      vp.setAttribute("style", (saved || "") +
        ";width:" + w + "px;max-width:none;flex:0 0 auto;align-self:flex-start");
      var n = getComputedStyle(mono).gridTemplateColumns.split(" ").length;
      if (was && n < was) drop = seen[seen.length - 1] + " then " + w + ":" + n;
      was = n;
      seen.push(w + ":" + n);
    });
    if (saved === null) vp.removeAttribute("style"); else vp.setAttribute("style", saved);
    say(!drop, "DECKMONO", drop ? "the deck LOSES a column as the page widens — " +
        drop : "columns by container width " + seen.join(" "));
  }

  // ---- CLIPPED: an explanation is not truncated where it need not be -------
  // The banner's recovery sentence measured clientHeight 48 against 179 at 390
  // and 48 against 128 at 768 — a 3rem cap, `overflow: auto`, overlay
  // scrollbars, no other cue — and the half that vanished is the half saying
  // what to DO. Scoped to what this product calls an explanation (DESIGN §5),
  // not to every scroller: the transcript and the shell log are frames you
  // browse.
  //
  // AND IT IS A BUDGET NOW, NOT AN EXEMPTION (lap 2's mobile critic, and I17).
  // This printed `only the banner gives way, and only under 30rem` at all six
  // mobile configs while 172-261px of prose was hidden, because it exempted
  // `banner && band` outright and never measured HOW MUCH — it would have
  // printed the same PASS at `max-height: 1vh`, and it printed it unchanged
  // while a lap moved the cap 30vh -> 18vh and hid 101px more at 390. "Only
  // the banner gives way" was executable; "and only by an amount a reader can
  // recover" was not, so the number moved where the gate could not see it.
  // The tolerance is ZERO and that is not strictness for its own sake: with
  // the long remedy behind a `<details>` (`status_pills.rs`) nothing is hidden
  // at any of the 54 configs, so zero is what the tree actually measures. The
  // px hidden is printed at EVERY config either way, so the next lap sees the
  // number move before a reader does.
  var cut = [], worst = 0, deep = "";
  document.querySelectorAll(".banner, .banner *, .note").forEach(function (el) {
    var what = (el.className || el.tagName) + " ";
    var banner = el.classList.contains("banner");
    if (!banner && getComputedStyle(el).maxHeight !== "none") {
      cut.push(what + "caps its own height inside the banner");
      return;
    }
    var hidden = el.scrollHeight - el.clientHeight;
    if (hidden <= 4 || (el.textContent || "").trim().length <= 40) return;
    var pct = Math.round((100 * hidden) / el.scrollHeight);
    if (hidden > worst) { worst = hidden; deep = what + hidden + "px = " + pct + "%"; }
    cut.push(what + "hides " + hidden + "px of prose = " + pct + "% of itself");
  });
  say(!cut.length, "CLIPPED", cut.join(", ") ||
      "no explanation hides any of itself at this width");
  info("CLIPPEDPX", worst ? "deepest cut " + deep : "0px hidden across " +
       document.querySelectorAll(".banner, .banner *, .note").length + " explanations");

  // ---- SWIPECUE: a scrollport that hides its scrollbar owes a cue ----------
  // `.agent-tabs` at 390 held five of eight chips in 332px of a 615px row with
  // `scrollbar-width: none`, ending flush on the panel's rounded edge, while a
  // tile above it read `none of 8 agents`. `.status-strip` answered exactly
  // this in 24 with a mask; nothing made that answer a rule, so the next
  // sideways scrollport shipped without one.
  var nocue = [];
  document.querySelectorAll("*").forEach(function (el) {
    if (el.scrollWidth <= el.clientWidth + 4) return;
    var s = getComputedStyle(el);
    if (s.getPropertyValue("scrollbar-width") !== "none") return;
    if (s.getPropertyValue("mask-image") !== "none") return;
    nocue.push((el.className || el.tagName) + " " + el.clientWidth + "/" + el.scrollWidth);
  });
  say(!nocue.length, "SWIPECUE", nocue.join(", ") ||
      "every hidden-scrollbar port with somewhere to go says so");

  // ---- SWIPEEND: …and it stops saying so where there is nowhere to go -----
  // The mask SWIPECUE demands was static, so scrolled to the last chip the
  // strip still dimmed it and ate the container's right border — an affordance
  // pointing at nothing (31-walk F3). The fix is a scroll-driven animation that
  // empties `--swipe-fade` over the last fifth of the travel (strip.css).
  //
  // WHAT THIS CAN AND CANNOT MEASURE. `--dump-dom` produces no frames:
  // `requestAnimationFrame` never fires here and a scroll timeline is only
  // sampled in a frame, so setting `scrollLeft` and reading `mask-image` back
  // returns the resting value at every offset — measured, twice. What IS
  // readable without a frame is the WIRING: that the port drives an animation
  // off ITS OWN inline scroll position, and that the animation's last keyframe
  // takes the fade to zero. Both come from the CSSOM, and either one breaking
  // is what would put the always-on mask back.
  var endOf = function (name) {
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules = document.styleSheets[i].cssRules;
      for (var j = 0; j < rules.length; j++) {
        if (rules[j].type !== 7 || rules[j].name !== name) continue;
        var last = rules[j].cssRules[rules[j].cssRules.length - 1];
        return { at: last.keyText, fade: last.style.getPropertyValue("--swipe-fade").trim() };
      }
    }
    return null;
  };
  // …EXCEPT WHERE THE PROMISE IS THAT NOTHING ANIMATES. Under reduced motion the
  // cue is deliberately the static mask of increment 28 — the same fallback a
  // browser with no scroll timelines gets — so asserting the withdrawal here
  // would assert against `REDUCEDMOTION` (layout-audit.js) two checks away.
  var stuck = [], seen = [];
  var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll(still ? "#nothing" : "*").forEach(function (el) {
    if (el.scrollWidth <= el.clientWidth + 4) return;
    var s = getComputedStyle(el);
    if (s.getPropertyValue("scrollbar-width") !== "none") return;
    if (s.getPropertyValue("mask-image") === "none") return;
    var what = el.className || el.tagName;
    seen.push(what);
    var driven = el.getAnimations().filter(function (a) {
      var t = a.timeline;
      return t && t.constructor.name === "ScrollTimeline" && t.source === el && t.axis === "inline";
    });
    if (!driven.length) {
      stuck.push(what + " masks at every scroll position");
      return;
    }
    var end = endOf(driven[0].animationName);
    if (!end) stuck.push(what + ": no @keyframes " + driven[0].animationName);
    else if (end.at !== "100%" || !/^0[a-z%]*$/.test(end.fade)) {
      stuck.push(what + " ends at " + end.at + " with --swipe-fade: " + (end.fade || "unset"));
    }
  });
  say(!stuck.length, "SWIPEEND", stuck.join(", ") ||
      (still ? "reduced motion: the cue is the static mask, and that is the promise"
             : seen.length ? seen.join(" + ") + " empty the fade at the end of their own scroll"
                           : "no port is scrollable at this width"));

  // ---- DASHEDGE: the Dashboard's cards share an edge ----------------------
  // Increment 30 capped every Dashboard panel except the deck's at `--column`,
  // and 1440 shipped a 608px launcher over a 1136px board over a 608px space
  // card: ~530px of nothing beside the field you type a whole task into, and
  // one card twice the width of its neighbours (31-walk F5). The cap belongs on
  // the PROSE, which carries its own (`surfaces.css`), not on the card. One
  // column, one edge — asserted at every width, since the failure was that two
  // cards in the same column disagreed about where the column ends.
  // REPOINTED AT THE RUN (ADE-DESIGN.md §3). This read `.dash-grid .panel`, and
  // `.dash-grid` was the Dashboard's launcher-and-board row — a class no
  // component emits any more, so the assertion would have gone on printing
  // nothing at 54 configurations while reading PASS by absence. A gate that
  // loses its subject is worse than no gate, because the report still says OK
  // (`layout-audit.js:145` says the same thing about the hover rules).
  //
  // The claim survives the rename unchanged, and it is now about MORE: the run
  // stacks the launcher, the conversation and the tool trace in one column, and
  // two panels in one column that disagree about where the column ends is the
  // exact defect 31-walk F5 recorded. `.reading` is excluded because a panel
  // holding only prose is capped at `--column` ON PURPOSE (`layout.css:122`),
  // so it is narrower by design and not by accident.
  var col = document.querySelectorAll(
    "#work-view > .panel:not(.reading), #chat-view > .panel:not(.reading), " +
    "#trace-view > .panel:not(.reading)");
  var run = [];
  col.forEach(function (c) { if (!c.closest("[hidden]")) run.push(c); });
  if (run.length > 1) {
    var widths = [];
    run.forEach(function (c) { widths.push(Math.round(c.getBoundingClientRect().width)); });
    var ragged = widths.some(function (w) { return Math.abs(w - widths[0]) > 1; });
    say(!ragged, "RUNEDGE", ragged
      ? "the run's panels are " + widths.join("/") + "px wide in one column"
      : run.length + " panels, all " + widths[0] + "px");
    var field = document.querySelector("#work-view .grows");
    if (field) {
      P.info("TASKFIELD", "the task field is " + Math.round(field.getBoundingClientRect().width) +
             "px in a " + widths[0] + "px card");
    }
  } else {
    P.info("RUNEDGE", run.length + " unhidden run panels — not judged");
  }
})();
