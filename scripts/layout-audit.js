// The audit half of the layout probe (increment 13d). Split out of
// layout-probe.js, which hit the 200-line rule (I12) carrying both the
// structural assertions — overlap, hit-test, fold, stacking, one screen — and
// these, which are about how the page READS rather than where it is.
//
// It shares `window.__probe`: the helpers layout-probe.js sets up, and the
// `out` array both files push their verdicts into. layout-probe.js writes the
// report after this file has run, so a check added here reaches it.
(function () {
  var P = window.__probe;
  var say = P.say, info = P.info, rect = P.rect;
  var out = P.out, W = P.W, q = P.q, routed = P.routed;

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
  // Against the ground each element is ACTUALLY PAINTED ON, and it FAILS.
  // This used to resolve tokens off a scratch <span> and print INFO, which
  // `check-layout.sh` never counts — so the plain skin's folded switch sat at
  // 1.49:1 through a whole walk and the guard had no way to say so: the token
  // reads identically in both skins, and the defect was which token the rule
  // reached for (13d walk, "make it a FAIL over the elements the increment
  // ships, not over tokens").
  var ratio = function (a, b) {
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  };
  var opaque = function (c) { return c && !/rgba\(.*,\s*0\)$/.test(c); };
  var ground = function (el) {
    for (var p = el; p; p = p.parentElement) {
      var c = getComputedStyle(p).backgroundColor;
      if (opaque(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  var check = function (el, label) {
    var s = getComputedStyle(el);
    var under = ground(el.parentElement || el);
    var g = lum(opaque(s.backgroundColor) ? s.backgroundColor : under);
    var text = ratio(lum(s.color), g);
    say(text >= 4.5, "CONTRAST " + label, s.color + " " + text.toFixed(2) + ":1");
    // A control with no fill is carried by its OUTLINE, which is a non-text
    // boundary: 3:1, WCAG 1.4.11.
    if (!opaque(s.backgroundColor) && parseFloat(s.borderTopWidth) > 0) {
      var edge = ratio(lum(s.borderTopColor), lum(under));
      say(edge >= 3, "BOUNDARY " + label,
          s.borderTopColor + " " + edge.toFixed(2) + ":1 on " + under);
    }
  };
  document.querySelectorAll(".panel-toggle").forEach(function (b, i) {
    check(b, "panel-toggle[" + i + "] open");
    b.click();
    void document.body.offsetHeight;
    check(b, "panel-toggle[" + i + "] folded");
    b.click();
    void document.body.offsetHeight;
  });
  var firstTab = document.querySelector(".nav .tab");
  if (firstTab) check(firstTab, "nav tab");

  // Pointer targets, as INFO: at 390 everything clears 44px, and the only
  // thing under 24 is an inline link in running prose, which WCAG 2.5.8
  // exempts. Worth printing, not worth failing (13d walk).
  var small = [];
  document.querySelectorAll("button, a, input, summary").forEach(function (el) {
    var r = rect(el);
    if (r.width && r.height && Math.min(r.width, r.height) < 24) {
      small.push((el.textContent || el.tagName).trim().slice(0, 14) + " " +
                 Math.round(r.width) + "x" + Math.round(r.height));
    }
  });
  info("TARGETS", small.length ? "under 24px: " + small.join(", ") : "none under 24px");

  document.getElementById("report").textContent =
    "== " + W + "x" + window.innerHeight + " skin=" + (q.get("skin") || "machine") +
    " route=" + (routed ? "deck" : "chat") + "\n" + out.join("\n");
})();
