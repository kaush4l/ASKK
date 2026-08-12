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

  // The stage is a scroll container from increment 13, so a region taller than
  // it has a RECT that runs past the glass: at 1100 plain/deck the deck's rect
  // is 258..1210 inside a stage that clips at 884, and a point at y=893 is
  // inside the rect, outside the view, and lands on the body. Measure the
  // VISIBLE intersection — what is clipped away cannot be clicked, and what is
  // on screen is still asserted point for point.
  // Every ancestor that CLIPS, found by asking the computed style rather than
  // by naming elements: which box scrolls moves with the breakpoint — the
  // stage above 1100, `main` below it — and a hardcoded list gets that wrong
  // in exactly the direction that hides a bug.
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

  // ---- FOLD: a folded region gives its width to the STAGE ------------------
  // The check that did not exist in 13, which is why 13 and 13b both shipped
  // broken. Twice the stage was the region that LOST width when a panel was
  // put away: first auto-placement moved it into a content-sized track, then
  // the 12d template outlived the rule meant to replace it and capped it at
  // 26rem — 416px in all twelve fold states — and the probe said OK both
  // times, because it still modelled a page with no folds in it.
  //
  // The assertion is the promise in words: folding a region must never make
  // the stage narrower, and the stage is never the thinnest column on screen.
  var stage = document.querySelector(".stage");
  var nav = document.getElementById("nav");
  var railEl = document.getElementById("rail");
  var wide = function (el) { return Math.round(rect(el).width); };
  // PRESS the switch, the way a person does — the probe used to set `hidden`
  // itself, so the `aria-expanded` -> `hidden` contract was never exercised
  // (13c walk). The fixture wires the same contract dash.rs does.
  var press = function (id) {
    var b = document.querySelector('.panel-toggle[aria-controls="' + id + '"]');
    if (b) b.click();
    void document.body.offsetHeight;
    return !!b;
  };

  if (stage && nav && railEl) {
    var navW = wide(nav), railW = wide(railEl), open = wide(stage);
    if (W >= 1100) {
      // EXACTLY the folded region's width, not merely "wider" — `>` passes on
      // +1px and every gutter regression short of total was invisible to it
      // (13c walk, guard gap 1). All FOUR states, including both-away, which
      // nothing had ever measured.
      var near = function (a, b) { return Math.abs(a - b) <= 2; };
      var state = function (label, want) {
        var got = wide(stage);
        say(near(got, want), "FOLD " + label, "stage " + got + " want " + want);
      };
      press("nav");
      state("nav", open + navW);
      press("rail");
      state("nav+rail", open + navW + railW);
      press("nav");
      state("rail", open + railW);
      press("rail");
      state("open", open);
      // A dashboard whose centre is thinner than its furniture is not a
      // dashboard. 13b shipped a 90px conversation beside a 374px rail.
      say(open >= navW && open >= railW, "STAGEWIDEST",
          "stage " + open + " | nav " + navW + " | rail " + railW);
      info("TRACKS", getComputedStyle(document.querySelector("main")).gridTemplateColumns);
    } else {
      // Below 1100 the regions stack, so folding cannot widen anything — what
      // must hold is that the switches are THERE and still route. The guard was
      // gated `W >= 1100` entirely, which is why the plain skin's phone was
      // 171px over one screen with nobody watching (13c walk, gap 4).
      say(press("nav") && nav.hidden, "FOLDNARROW nav", "nav hidden=" + nav.hidden);
      press("nav");
      say(press("rail") && railEl.hidden, "FOLDNARROW rail", "rail hidden=" + railEl.hidden);
      press("rail");
    }
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
  // BOTH skins from increment 13: the plain skin is the same three regions on
  // the same one screen, and it was exempt here only because it used to be a
  // single scrolling column.
  if (W >= 1100) {
    say(doc.scrollHeight <= window.innerHeight + 1, "ONESCREEN",
        doc.scrollHeight + " vs " + window.innerHeight);
  }
  say(doc.scrollWidth <= doc.clientWidth, "XOVERFLOW",
      doc.scrollWidth + " vs " + doc.clientWidth);

  // ---- the type scale actually present on this page -----------------------
  var sizes = {};
  document.querySelectorAll("body *").forEach(function (el) {
    if (!el.offsetParent && el !== document.body) return;
    var text = Array.prototype.some.call(el.childNodes, function (n) {
      return n.nodeType === 3 && n.textContent.trim();
    });
    if (!text || el.closest("#report")) return;
    var s = getComputedStyle(el).fontSize;
    sizes[s] = (sizes[s] || 0) + 1;
  });
  var scale = Object.keys(sizes).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
  info("SIZES", scale.map(function (s) { return s + "x" + sizes[s]; }).join(" "));

  // ---- motion, and the reduced-motion promise -----------------------------
  var running = [];
  document.querySelectorAll("body *").forEach(function (el) {
    ["", "::before", "::after"].forEach(function (p) {
      var a = getComputedStyle(el, p || null).animationName;
      if (a && a !== "none") running.push(a);
    });
  });
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  info("MOTION", "reduced=" + reduced + " running=[" + running.sort().join(" ") + "]");
  if (reduced) say(running.length === 0, "REDUCEDMOTION", running.join(" ") || "nothing animates");

  // ---- contrast: every ink token against the ground it sits on ------------
  var lin = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  var lum = function (rgb) {
    var m = rgb.match(/\d+/g).map(Number);
    return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
  };
  var probe = document.createElement("span");
  document.body.appendChild(probe);
  var resolve = function (token) {
    probe.style.color = "var(" + token + ")";
    return getComputedStyle(probe).color;
  };
  var bg = lum(resolve("--bg"));
  ["--ink", "--ink-dim", "--accent", "--danger", "--machine"].forEach(function (t) {
    var c = resolve(t);
    if (!c) return;
    var l = lum(c), hi = Math.max(l, bg), lo = Math.min(l, bg);
    info("CONTRAST " + t, c + " " + ((hi + 0.05) / (lo + 0.05)).toFixed(2) + ":1 on --bg");
  });
  probe.remove();

  document.getElementById("report").textContent =
    "== " + W + "x" + window.innerHeight + " skin=" + (q.get("skin") || "machine") +
    " route=" + (routed ? "deck" : "chat") + "\n" + out.join("\n");
})();
