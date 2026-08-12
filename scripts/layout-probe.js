// The layout probe's assertions (increment 12d). Runs inside
// chrome-headless-shell against scripts/layout-probe.html and writes its
// verdict into #report, which --dump-dom hands back to check-layout.sh.
//
// HITTEST is the check that did not exist: for three increments a sticky rail
// painted over the whole deck and swallowed its clicks, and every walk that
// read the page read past it, because nothing ever asked what a click at a
// given point actually lands on.
(function () {
  var out = [];
  var q = new URLSearchParams(location.search);
  var W = window.innerWidth;
  var say = function (ok, name, detail) {
    out.push((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  var info = function (name, detail) { out.push("INFO " + name + ": " + detail); };

  if (q.get("skin") === "plain") document.documentElement.setAttribute("data-skin", "plain");
  var deck = document.getElementById("deck-panel");
  var chat = document.getElementById("chat-panel");
  var routed = q.get("deck") === "1";
  // Route exactly the way the shell does: one `hidden` attribute per region.
  deck.hidden = !routed;
  chat.hidden = routed;
  var region = routed ? deck : chat;

  var rect = function (el) { return el.getBoundingClientRect(); };
  var overlaps = function (a, b) {
    return a.left < b.right - 1 && b.left < a.right - 1 &&
           a.top < b.bottom - 1 && b.top < a.bottom - 1;
  };

  // A region taller than its scroll container has a RECT that runs past the
  // glass: at 1100 plain/deck the deck's rect is 258..1210 inside a stage that
  // clips at 884, so a point at y=893 is inside the rect, outside the view, and
  // lands on the body. Measure the VISIBLE intersection. Clipping ancestors are
  // found by asking the computed style, never by naming elements: WHICH box
  // scrolls moves with the breakpoint, and a hardcoded list gets that wrong in
  // exactly the direction that hides a bug.
  var visible = function (el) {
    var b = { top: rect(el).top, bottom: rect(el).bottom,
              left: rect(el).left, right: rect(el).right };
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p);
      if (o.overflowY === "visible" && o.overflowX === "visible") continue;
      var c = rect(p);
      b.top = Math.max(b.top, c.top);
      b.bottom = Math.min(b.bottom, c.bottom);
      b.left = Math.max(b.left, c.left);
      b.right = Math.min(b.right, c.right);
    }
    b.width = b.right - b.left;
    b.height = b.bottom - b.top;
    return b;
  };

  // ---- OVERLAP: two regions of one screen may not paint on each other. -----
  var rail = document.querySelector(".rail");
  var railBox = rect(rail);
  var regionBox = visible(region);
  say(!overlaps(railBox, regionBox), "OVERLAP rail/" + region.id,
      "rail " + Math.round(railBox.top) + ".." + Math.round(railBox.bottom) +
      " x " + Math.round(railBox.left) + ".." + Math.round(railBox.right) +
      " | region " + Math.round(regionBox.top) + ".." + Math.round(regionBox.bottom) +
      " x " + Math.round(regionBox.left) + ".." + Math.round(regionBox.right));

  // ---- HITTEST: what does a click at this point actually hit? --------------
  // A 5x5 grid over the region, at rest and again at the bottom of the page —
  // the sticky rail only escaped its row once the document had scrolled.
  var hittest = function (label) {
    var b = visible(region);
    var bad = null, n = 0;
    for (var i = 1; i <= 5 && !bad; i++) {
      for (var j = 1; j <= 5 && !bad; j++) {
        var x = b.left + (b.width * i) / 6, y = b.top + (b.height * j) / 6;
        if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) continue;
        n++;
        var hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (!region.contains(hit)) {
          var owner = hit.closest(".rail,.primary,header,main") || hit;
          bad = "(" + Math.round(x) + "," + Math.round(y) + ") hits " +
                (owner.className || owner.tagName) + ' "' +
                (hit.textContent || "").trim().slice(0, 30) + '"';
        }
      }
    }
    // No sampled point on screen is not a pass — say so rather than bank it.
    if (!bad && n === 0) info("HITTEST " + label, "region entirely off screen");
    else say(!bad, "HITTEST " + label, bad || n + " points inside #" + region.id);
  };
  hittest("scrollY=0");
  var max = document.documentElement.scrollHeight - window.innerHeight;
  if (max > 0) {
    window.scrollTo(0, max);
    hittest("scrollY=" + Math.round(window.scrollY));
    window.scrollTo(0, 0);
  }

  // ---- STACKED: a vertical tablist lays out vertically, in BOTH skins ------
  // The column rule was machine-skin-only, so the fallback kept theme.css's
  // `flex-wrap: wrap` and made five entries a 2-across chip grid under an
  // `aria-orientation="vertical"` that promised a list — ArrowDown moving
  // focus RIGHT (13c walk, finding 3). No two tabs may share a row.
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".nav .tab"));
  if (tabs.length > 1 && !nav.hidden) {
    var shared = null;
    for (var t = 1; t < tabs.length && !shared; t++) {
      var prev = rect(tabs[t - 1]), here = rect(tabs[t]);
      if (here.top < prev.bottom - 1) {
        shared = '"' + tabs[t - 1].textContent.trim().slice(0, 12) + '" and "' +
                 tabs[t].textContent.trim().slice(0, 12) + '" share a row';
      }
    }
    say(!shared, "STACKED", shared || tabs.length + " tabs, one per row");
  }

  // ---- the page is one screen, and never a document sideways --------------
  var doc = document.documentElement;
  info("HEIGHT", doc.scrollHeight + "px in a " + window.innerHeight + "px viewport");
  // EVERY width, BOTH skins. This was gated `W >= 1100`, precisely where the
  // failure it exists to catch did NOT live: the plain skin measured 1015px in
  // an 844px viewport at 390 and the probe printed it as INFO, which nothing
  // counts.
  // ONE SCREEN is a promise about a DASHBOARD, not a 256px-tall window. At
  // 400% zoom of 1280x1024 the viewport is 320x256 and holding it there WAS the
  // bug: overflow:hidden under a 200px header left the composer, the log and
  // Send unreachable with nothing able to scroll to them (WCAG 1.4.10).
  // Asserting one-screen there would assert the trap. Gated on the same 30rem
  // the stylesheet is.
  if (window.innerHeight >= 480) {
    say(doc.scrollHeight <= window.innerHeight + 1, "ONESCREEN",
        doc.scrollHeight + " vs " + window.innerHeight);
  } else {
    // What must hold instead: everything is REACHABLE. Nothing may be clipped
    // out of a container that cannot scroll to it.
    var trapped = [];
    document.querySelectorAll("button, a, input, textarea, select, summary").forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      var reach = r.bottom <= window.innerHeight || doc.scrollHeight > window.innerHeight;
      if (!reach) trapped.push((el.textContent || el.tagName).trim().slice(0, 16));
    });
    say(trapped.length === 0, "REACHABLE",
        trapped.length ? trapped.join(", ") + " below a page that cannot scroll"
                       : document.querySelectorAll("button,a,input,textarea,select,summary").length +
                         " controls, page scrolls " + doc.scrollHeight);
  }
  say(doc.scrollWidth <= doc.clientWidth, "XOVERFLOW",
      doc.scrollWidth + " vs " + doc.clientWidth);

  // The audit half runs next (layout-audit.js) and writes the report, so a
  // verdict from either file reaches check-layout.sh. Split because this file
  // hit the 200-line rule (I12) carrying both halves.
  window.__probe = { say: say, info: info, rect: rect, out: out, W: W, q: q, routed: routed };
})();
