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
  var rect0 = function (el) { return el.getBoundingClientRect(); };
  var q = new URLSearchParams(location.search);
  var W = window.innerWidth;
  var say = function (ok, name, detail) {
    out.push((ok ? "PASS " : "FAIL ") + name + ": " + detail);
  };
  var info = function (name, detail) { out.push("INFO " + name + ": " + detail); };

  if (q.get("skin") === "plain") document.documentElement.setAttribute("data-skin", "plain");
  // Route exactly the way the shell does: one `hidden` attribute per region,
  // and ONE VIEW MOUNTED AT A TIME. The fixture used to leave the Dashboard
  // standing under whichever route it was measuring, which no shipped page
  // does (`stage.rs` mounts one view plus the chat pane) — 897px of dashboard
  // above the conversation, so the chat view computed to zero height and its
  // panel spilled onto the rail. A fixture that models a state the app cannot
  // reach reports failures the app does not have, and hides the ones it does.
  var deck = document.getElementById("deck-panel");
  var chat = document.getElementById("chat-view");
  var dash = document.getElementById("dashboard-view");
  var route = q.get("route") || (q.get("deck") === "1" ? "deck" : "chat");
  var routed = route === "deck";
  deck.hidden = route !== "deck";
  chat.hidden = route !== "chat";
  dash.hidden = route !== "dash";
  var region = route === "deck" ? deck : route === "dash" ? dash : chat;

  // THE KICKER NAMES THE ROUTE, because the shell's does (`StageHead` renders
  // `View::label`) and this fixture hardcoded "Dashboard" on all three. That
  // was invisible while it was an 11px label everywhere; it is the line above
  // a 68-136px plate now, and a fixture naming the wrong route measures the
  // wrong width. `Commands` is the deck route's name in the shipped nav.
  // The `kicker` CLASS is the Dashboard's, exactly as `panels.rs` writes it —
  // a class the markup STATES, never a `:has()` on the routed panel.
  var eyebrow = document.querySelector(".view-eyebrow");
  if (eyebrow) {
    eyebrow.textContent =
      route === "deck" ? "Commands" : route === "chat" ? "Chat" : "Dashboard";
    eyebrow.className = route === "dash" ? "view-eyebrow kicker" : "view-eyebrow";
  }
  // …AND THE PLATE NAMES THE AGENT, in `.stage-head` and SECOND, exactly where
  // `panels.rs::StageHead` puts it. It is the Dashboard that does NOT get one
  // there: `dashboard.rs` renders the `<h1>` nameplate inside the routed panel,
  // so the head's plate is hidden on that route the way the head's sentence is.
  var stagePlate = document.getElementById("stage-plate");
  if (stagePlate) stagePlate.hidden = route === "dash";
  // …AND THE WORD IS A TEXT NODE, because the subject plate is type and not a
  // span. It carried an inline `<svg><text textLength>` for one round and the
  // four-letter name `main` came out 6.87x over-tracked at 1920; the mechanism
  // is now the Dashboard `<h1>`'s alone (`centre/plate.rs`).
  //
  // THE FIXTURE'S WORD IS THE APP'S SHORTEST, NOT ITS LONGEST. `summarizer` is
  // ten glyphs and was chosen as an OVERFLOW stress — and it is the most
  // flattering word in the roster for every other question, so a design loop
  // looking at these renders saw a plate that was fine while the app served a
  // stretched one. The shipped roster is `main` and `critic`. Overflow is
  // covered by `XOVERFLOWEACH` and the tagline, which is far wider than any
  // name; what a render of a plate needs to show is the SHORT case.
  var plate = document.querySelector("#stage-plate .plate");
  if (plate) plate.textContent = "main";
  // …AND THE ACTIVE TAB IS THE AGENT THE PLATE NAMES (lap 2's desktop critic).
  // The plate and the switcher used to disagree — an artifact a reader has to
  // correct for before they can judge the pairing at all. They move together.
  document.querySelectorAll("#agent-strip .tab").forEach(function (b) {
    var on = b.id === "tab-main";
    b.classList.toggle("current", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.setAttribute("tabindex", on ? "0" : "-1");
  });
  // …AND THE AGENT STRIP IS NOT ON CHAT (R19-IA, docs/THREADS.md §7): the
  // thread list is the picker there, so the strip is chrome this route no
  // longer has — leaving it standing would model 60px the app does not spend.
  // …AND ON THE DASHBOARD IT IS NOT IN THE HEAD AT ALL: `dashboard.rs` renders
  // it INSIDE the routed panel, under the nameplate and above the agent-scoped
  // panels, because the head is pinned above `#dashboard-view` and this route's
  // `<h1>` is inside it — in the head the band cut between the kicker and the
  // nameplate (y=371 / 394 / 462 at 390x844). MOVED, not copied: two
  // `.agent-tabs` in one document would break `tab-{name}`'s uniqueness.
  var strip = document.getElementById("agent-strip");
  if (strip) {
    strip.hidden = route === "chat";
    if (route === "dash") {
      var tiles = document.getElementById("fleet-tiles");
      if (tiles && tiles.parentNode) tiles.parentNode.insertBefore(strip, tiles.nextSibling);
    }
  }
  // ONE BANNER, NOT TWO (31-walk F4). `statusbar.rs` hushes the misrouted-
  // address row while a turn has failed — at 320x780 the chrome already stands
  // at 484px against a floor of 260 — so the fixture shows the address notice
  // on one route and the failure on the others, never stacked.
  var misroute = document.getElementById("misroute-banner");
  var failure = document.querySelector(".banner.problem");
  if (misroute && failure) {
    misroute.hidden = route !== "dash";
    failure.hidden = route === "dash";
  }
  // …AND THE DASHBOARD HAS NO RAIL, WHICH THIS FIXTURE GAVE IT (28).
  // `views.rs::rail()` is Workspace alone, so every dash measurement here was
  // ~370px NARROWER than the shipped page — narrower than the 66rem container
  // query the launcher/board split keyed off, which is why the gate could not
  // reach the state that shipped a one-column board at 1440. A fixture
  // narrower than the page cannot see a rule that fires when it is wide.
  // REMOVED, not hidden: a switch for a region the app does not render is a
  // fold nobody can perform, and `fold-probe.js` guards on it existing.
  if (route === "dash") {
    var sw = document.querySelector('.panel-toggle[aria-controls="rail"]');
    if (sw) sw.remove();
    var railRegion = document.getElementById("rail");
    if (railRegion) railRegion.remove();
  }

  // …AND THE E3 STAND-IN TAKES DESIGN.md §8's GEOMETRY: "E3, bottom-right >=768
  // / bottom full-width below". The fixture pinned it bottom-right at every
  // width, so at 390 it measured 153x62 in the right-hand thumb arc over a
  // 300x91 `button.thread-summary`, which is a shape the specification does not
  // describe and no reader could have got from it. The `@media` half is not
  // expressible in the inline style the fixture carries, and NO `.toast` rule
  // may be added to `web/` (DESIGN.md:1104: "not built. No component, no CSS,
  // no specimen"), so the routing lives here beside the rest of the fixture's
  // routing. Bottom-FLUSH, not inset: a band that sits on the viewport edge is
  // the specified shape and covers the smallest strip that shape can cover.
  var toast = document.querySelector(".toast");
  if (toast && W < 768) {
    toast.style.left = "0"; toast.style.right = "0"; toast.style.bottom = "0";
    // …AND THE REGION UNDER IT OWES IT THE SAME HEIGHT (lap 2's mobile critic,
    // and now DESIGN §8). A full-width band at the viewport's foot landed on
    // 44% of `SUMMARY "How a turn works…"` in plain and 70% in glass at
    // 390x844 dash — FLOATOVER passed, because `pointer-events: none` leaves
    // the click, and the label was still unreadable. A floating band is not
    // free: the flow it floats over ends that much sooner. `padding-bottom` on
    // the OUTER scroller (`main` below 1100), which is the only box every route's
    // content shares — a band pinned to the viewport foot always has SOMETHING
    // under it on a 3,400px page, so what this can promise is not "nothing is
    // covered" but "the last control can always be scrolled clear of it".
    var scroller = document.querySelector("main");
    if (scroller) {
      scroller.style.paddingBottom = Math.ceil(rect0(toast).height) + "px";
    }
  }

  // Below the three-column breakpoint the shipped page starts with the nav
  // FOLDED (`dash::wide`), and since R3-9 a shown nav is a sheet OVER the
  // content rather than a wall above it. The fixture starts it open, so it is
  // put away here: a probe that models a state the app never lands in would
  // read the drawer as an overlap bug and hide every real one behind it.
  var nav = document.getElementById("nav");
  if (W < 1100 && !nav.hidden) {
    document.querySelector('.panel-toggle[aria-controls="nav"]').click();
  }

  var rect = rect0;
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
  var regionBox = visible(region);
  if (!rail) {
    info("OVERLAP rail/" + region.id, "this view has no rail (views.rs: Workspace)");
  } else {
    var railBox = rect(rail);
    say(!overlaps(railBox, regionBox), "OVERLAP rail/" + region.id,
        "rail " + Math.round(railBox.top) + ".." + Math.round(railBox.bottom) +
        " x " + Math.round(railBox.left) + ".." + Math.round(railBox.right) +
        " | region " + Math.round(regionBox.top) + ".." + Math.round(regionBox.bottom) +
        " x " + Math.round(regionBox.left) + ".." + Math.round(regionBox.right));
  }

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

  // ---- FLOATOVER: nothing that floats may take a control's click -----------
  // The finding this answers was measured on the E3 stand-in above and is a
  // fixture artifact (DESIGN.md:1104 — Toast is not built), but the CLAIM is
  // about the product and had no executable form: for four rounds nothing asked
  // whether a viewport-pinned surface lands on top of something a person has to
  // press. HITTEST asks it of the routed REGION's 25 sample points; this asks it
  // of every control, which is the question a toast, a sheet or a modal breaks.
  //
  // TWO STATEMENTS, because they are two different truths and I16 says the one
  // the system holds must be said: the ASSERTION is about the click —
  // `elementFromPoint` is what a pointer does, so an overlay that cannot take a
  // pointer cannot take a press — and the INFO is about the PAINT, which is what
  // an eye reads and what the critic actually measured. A green FLOATOVER with a
  // non-empty COVERED line is a real state and it is now on the record every run
  // rather than in a comment.
  var floaters = [];
  document.querySelectorAll("body *").forEach(function (el) {
    var cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") return;
    if (el.hidden || cs.visibility === "hidden" || cs.display === "none") return;
    if (el.closest("#report") || parseFloat(cs.zIndex) < 0) return;
    var r = rect(el);
    if (r.width < 4 || r.height < 4) return;
    floaters.push(el);
  });
  // …AND THE PAINT SWEEP READS WHAT AN EYE READS (lap 2's desktop critic). It
  // queried controls alone, so a toast parked on `<h2>Processes · 1 running</h2>`
  // printed `no control is painted over` on all three routes at 1440 and 1920 —
  // a heading is not a `button`. It also returned EARLY on any control whose
  // centre fell past the viewport, so a control the fold clips did not count at
  // all. Both are fixed here and they are fixed only for the PAINT half: the
  // CLICK assertion is still about controls, because a heading has no click to
  // steal, and it is still centre-based, because that is what a pointer does.
  var stolen = [], covered = [];
  var PRESSABLE = "button, a[href], input, textarea, select, summary";
  document.querySelectorAll(PRESSABLE + ", h1, h2, h3, p, li, dt, dd, pre")
    .forEach(function (c) {
      if (!c.offsetParent) return;
      var r = rect(c);
      if (r.width < 4 || r.height < 4) return;
      if ((c.textContent || "").trim().length < 2) return;
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var press = c.matches(PRESSABLE);
      var name = (c.textContent || c.tagName).trim().slice(0, 22);
      floaters.forEach(function (f) {
        if (f.contains(c) || c.contains(f)) return;
        var b = rect(f);
        // PAINT is any intersection at all — that is what an eye reads, and it
        // is the shape the critic measured (a 153x62 toast on a 300x91 button).
        if (overlaps(b, r)) covered.push(name + " under ." + (f.className || f.tagName));
        // CLICK is the centre, and controls only: a control whose middle lands
        // on a floating surface cannot be pressed, whatever the corners do.
        if (!press) return;
        if (cx < 0 || cy < 0 || cx > W || cy > window.innerHeight) return;
        if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return;
        var hit = document.elementFromPoint(cx, cy);
        if (hit && !c.contains(hit) && hit !== c && f.contains(hit)) {
          stolen.push(name + " -> ." + (f.className || f.tagName));
        }
      });
    });
  say(!stolen.length, "FLOATOVER",
      stolen.length ? stolen.join(" | ")
                    : floaters.length + " floating surface(s), no control's centre "
                      + "lands on one");
  // …AND IT NAMES THE FIXTURE, because three consecutive critics have now
  // escalated this line to P0 against the PRODUCT. There is no toast in the
  // product: `grep -rni toast crates/ui/src web/*.css` is 0 hits, DESIGN.md
  // §8 records Toast as "not built. No component, no CSS, no specimen", and
  // the only one that exists is the permanent stand-in at
  // layout-probe.html:539, mounted so N1/N4 always have a sample. A permanent
  // fixture painting over prose is the fixture being permanent; it is not a
  // defect a builder can fix in web/. Saying which surfaces are FIXTURES in
  // the line itself is I16 applied to the gate's own output — the alternative
  // is a fourth round spent fixing a page nobody is served.
  var FIXTURE = /\btoast\b/;
  var fixtures = covered.filter(function (c) { return FIXTURE.test(c); });
  var real = covered.filter(function (c) { return !FIXTURE.test(c); });
  // AND IT IS AN ASSERTION NOW, not a comment. Lap 2's critic was right about
  // the shape of the defect even though the instance was a fixture: a claim
  // executed at one width and downgraded to INFO at the width where it is
  // false is I17. With the fixture separated out, `real` is empty at all 54
  // configs, so this can be a verdict that passes today and fails the day a
  // real floating surface is written and parked on prose.
  say(!real.length, "COVERED", real.length ? real.join(" | ")
                              : "nothing a reader reads is painted over"
                                + (fixtures.length
                                   ? " (" + fixtures.length + " overlap(s) of the "
                                     + "PROBE-ONLY toast fixture ignored: no toast "
                                     + "exists in web/ or crates/ui — DESIGN.md §8)"
                                   : ""));

  // ---- STACKED: the view list lays out vertically, in BOTH skins ----------
  // The column rule was machine-skin-only, so the fallback kept `flex-wrap:
  // wrap` and made the entries a 2-across chip grid under a list that promised
  // one per row — ArrowDown moving focus RIGHT (13c walk, finding 3). It is
  // pointed at the VIEW LIST since 15B: the agent strip moved into the Chat
  // view and is deliberately a row there.
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".nav .view-item"));
  if (tabs.length > 1 && !nav.hidden) {
    var shared = null;
    for (var t = 1; t < tabs.length && !shared; t++) {
      var prev = rect(tabs[t - 1]), here = rect(tabs[t]);
      if (here.top < prev.bottom - 1) {
        shared = '"' + tabs[t - 1].textContent.trim().slice(0, 12) + '" and "' +
                 tabs[t].textContent.trim().slice(0, 12) + '" share a row';
      }
    }
    say(!shared, "STACKED", shared || tabs.length + " view entries, one per row");
  }

  // ---- the page is one screen, and never a document sideways --------------
  var doc = document.documentElement;
  info("HEIGHT", doc.scrollHeight + "px in a " + window.innerHeight + "px viewport");
  // EVERY width, BOTH skins. Gated `W >= 1100` it missed its own failure: the
  // plain skin measured 1015px in an 844px viewport at 390 as INFO, which
  // nothing counts. But ONE SCREEN is a promise about a DASHBOARD, not a
  // 256px-tall window — at 400% zoom of 1280x1024 the viewport is 320x256, and
  // there `overflow: hidden` under a 200px header left the composer and Send
  // unreachable with nothing able to scroll to them (WCAG 1.4.10). Asserting
  // one-screen there asserts the trap, so it is gated on the stylesheet's
  // own 30rem.
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

  // …AND THE SAME QUESTION OF EVERY BOX, BECAUSE THE DOCUMENT CANNOT SEE PAST ITS
  // OWN CLIP. `body` and `main` are `overflow: hidden` in the one-screen chain, so
  // an element that spills inside them leaves the document's scrollWidth untouched
  // and XOVERFLOW above prints OK over it. Measured on the app at 320 before this
  // existed: `.stage` scrollWidth 312 against clientWidth 304, the routed panel 296
  // against 272, and at 360 `.masthead` and its `<h1>` 320 against 304 — content
  // outside a box nothing can scroll, which is content a person cannot reach. A
  // lap-2 report called this fixed having measured 390 and nothing else, and 390
  // was itself 336/334.
  //
  // THE EXCEPTIONS ARE NAMED, because a silent one is how this would quietly stop
  // asserting anything. `.status-strip` and `.agent-tabs.band` scroll sideways ON
  // PURPOSE (strip.css, layout.css) and each carries its own fade or snap to say so;
  // `pre` is machine output, which four rules in surfaces.css give `overflow: auto`
  // and which is the one kind of content this product may not re-wrap.
  //
  // NAMED AND NOT COMPUTED, AND THAT IS MEASURED: `getComputedStyle` reports
  // `overflow-x: auto` for `.stage`, which declares only `overflow-y: auto` — CSS
  // computes the other axis to `auto` when one axis is not `visible`. A rule written
  // on the computed value would have skipped the exact box this was built to catch.
  var sideways = ".status-strip, .agent-tabs.band, pre";
  var spill = [];
  document.querySelectorAll("body *").forEach(function (el) {
    if (!el.offsetParent && el !== document.body) return;
    if (el.closest("#report") || el.closest(sideways)) return;
    if (el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 1) {
      spill.push(el.tagName.toLowerCase() + "." +
                 String(el.className || "").split(" ")[0] + " " +
                 el.scrollWidth + "/" + el.clientWidth);
    }
  });
  say(spill.length === 0, "XOVERFLOWEACH",
      spill.length ? spill.join(", ") : document.querySelectorAll("body *").length +
      " boxes, none wider than itself");

  // The deck's three assertions are `deck-probe.js` and the audit half is
  // `layout-audit.js`, which writes the report last — so a verdict pushed by
  // any of the three reaches check-layout.sh. Split at the 200-line rule (I12),
  // twice: this file carried all of it once, and `region` is exported because
  // the deck checks must read inside the ROUTED region and never `document`.
  window.__probe = { say: say, info: info, rect: rect, out: out, W: W, q: q,
                     routed: routed, route: route, region: region };
})();
