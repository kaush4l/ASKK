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

  // ---- OVERLAP: two regions of one screen may not paint on each other. -----
  var rail = document.querySelector(".rail");
  var railBox = rect(rail);
  var regionBox = rect(region);
  say(!overlaps(railBox, regionBox), "OVERLAP rail/" + region.id,
      "rail " + Math.round(railBox.top) + ".." + Math.round(railBox.bottom) +
      " x " + Math.round(railBox.left) + ".." + Math.round(railBox.right) +
      " | region " + Math.round(regionBox.top) + ".." + Math.round(regionBox.bottom) +
      " x " + Math.round(regionBox.left) + ".." + Math.round(regionBox.right));

  // ---- HITTEST: what does a click at this point actually hit? --------------
  // A 5x5 grid over the region, at rest and again at the bottom of the page —
  // the sticky rail only escaped its row once the document had scrolled.
  var hittest = function (label) {
    var b = rect(region);
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

  // ---- the page is one screen, and never a document sideways --------------
  var doc = document.documentElement;
  info("HEIGHT", doc.scrollHeight + "px in a " + window.innerHeight + "px viewport");
  if (W >= 1100 && q.get("skin") !== "plain") {
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
