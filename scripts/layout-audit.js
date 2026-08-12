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
  var rgb = function (c) {
    var m = (c || "").match(/[\d.]+/g) || [0, 0, 0];
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
  };
  var over = function (top, under) {
    // src-over, the compositing the browser actually does. The audit used to
    // skip this entirely: `opaque()` accepted ANY non-zero alpha, so the glass
    // fill rgba(255,255,255,0.055) was read as if it WERE the ground and every
    // ink on chrome measured 1.12:1 against near-white. The page was fine; the
    // model was wrong. DESIGN.md §10.1 is explicit that contrast is measured
    // against the rendered backdrop, never against a fill colour.
    var a = top.a;
    return { r: top.r * a + under.r * (1 - a),
             g: top.g * a + under.g * (1 - a),
             b: top.b * a + under.b * (1 - a), a: 1 };
  };
  var lumRGB = function (c) {
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  };
  // THE WORST CASE, not the average one. The ground is a three-lobe field and
  // its lightest region is the top-left accent lobe; light-on-glass fails
  // there and nowhere else, which is exactly why it fails invisibly — it looks
  // fine over the one part of the background anybody screenshots.
  var css = function (name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  var litGround = (function () {
    var base = rgb(css("--ground", "#0b0611").replace(/^#(..)(..)(..)$/, function (_, r, g, b) {
      return "rgb(" + parseInt(r, 16) + "," + parseInt(g, 16) + "," + parseInt(b, 16) + ")";
    }));
    var lobe = rgb(css("--lobe-accent", "rgba(185,140,255,0.20)"));
    return over(lobe, base);
  })();
  // Walk to the root compositing every translucent fill onto the one below it.
  var ground = function (el) {
    var stack = [];
    for (var p = el; p; p = p.parentElement) {
      var c = getComputedStyle(p).backgroundColor;
      var v = rgb(c);
      if (!opaque(c) || v.a === 0) continue;
      stack.push(v);
      if (v.a === 1) break;
    }
    var out = litGround;
    for (var i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  };
  var lum = function (c) { return typeof c === "string" ? lumRGB(rgb(c)) : lumRGB(c); };
  var check = function (el, label) {
    var s = getComputedStyle(el);
    var under = ground(el.parentElement || el);
    var own = rgb(s.backgroundColor);
    var g = lum(opaque(s.backgroundColor) ? over(own, under) : under);
    var text = ratio(lum(s.color), g);
    // "Has a fill" is a VISIBLE question, not an alpha one: a fill that lands
    // within 3:1 of what is behind it is not separating anything, so the
    // border is still the only thing drawing the control.
    var filled = opaque(s.backgroundColor) &&
                 ratio(lum(over(own, under)), lum(under)) >= 3;
    say(text >= 4.5, "CONTRAST " + label, s.color + " " + text.toFixed(2) + ":1");
    // A control with no fill is carried by its OUTLINE, which is a non-text
    // boundary: 3:1, WCAG 1.4.11.
    if (!filled && parseFloat(s.borderTopWidth) > 0) {
      var edge = ratio(lum(over(rgb(s.borderTopColor), under)), lum(under));
      say(edge >= 3, "BOUNDARY " + label,
          s.borderTopColor + " " + edge.toFixed(2) + ":1 on lit-lobe backdrop");
    }
  };
  // EVERY control, not the first of each kind. `document.querySelector(".nav
  // .tab")` measured whichever tab the FIXTURE happens to put first — the
  // selected one, which carries the accent edge at 7.31:1 — while the app puts
  // an unselected one there at 1.49:1. The guard was green over a page its own
  // code failed, because a check that reads "the first" is only as good as the
  // fixture agreeing with the app about ordering (walk 5, the named hole).
  // `.nav .tab` became `.nav .view-item` when the left panel started
  // navigating between views (15B), and the agent strip moved into the Chat
  // view — both are listed, because a rule that reaches one skin and not the
  // other is this file's most-repeated finding and both are still controls.
  // The two header pills (15A, 15E) are TEXT on the header's glass, which is
  // the CONTRAST assertion's whole subject, and nothing measured them.
  var controls = ".panel-toggle, .skin-toggle, .nav .view-item, .agent-tabs .tab, " +
                 ".warmth, .meter, .file-entry, input, textarea, select";
  document.querySelectorAll(controls).forEach(function (el, i) {
    var name = (el.id || el.className || el.tagName).toString().slice(0, 24);
    check(el, name + "[" + i + "]");
  });
  // …and both states of the switches, since folded is a different painting.
  document.querySelectorAll(".panel-toggle").forEach(function (b, i) {
    b.click();
    void document.body.offsetHeight;
    check(b, "panel-toggle[" + i + "] folded");
    b.click();
    void document.body.offsetHeight;
  });

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
