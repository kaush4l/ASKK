// The audit half of the layout probe (increment 13d). Split out of
// layout-probe.js at the 200-line rule (I12): that file holds the structural
// assertions, this one holds how the page READS.
//
// It shares `window.__probe`: layout-probe.js's helpers and the `out` array
// both push verdicts into, and it writes the report after this file has run.
(function () {
  var P = window.__probe;
  var say = P.say, info = P.info, rect = P.rect;
  var out = P.out, W = P.W, q = P.q, route = P.route;

  // ---- the type scale actually present on this page ---
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

  // ---- motion, and the reduced-motion promise ---
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

  // ---- contrast: every ink token against the ground it sits on ---
  var lin = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  var lum = function (rgb) {
    var m = rgb.match(/\d+/g).map(Number);
    return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
  };
  // Against the ground each element is ACTUALLY PAINTED ON, and it FAILS. It
  // used to resolve tokens off a scratch <span> and print INFO, which nothing
  // counts — so the plain skin's folded switch sat at 1.49:1 for a whole walk
  // (13d: "a FAIL over the elements the increment ships, not over tokens").
  var ratio = function (a, b) {
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  };
  var opaque = function (c) { return c && !/rgba\(.*,\s*0\)$/.test(c); };
  var rgb = function (c) {
    var m = (c || "").match(/[\d.]+/g) || [0, 0, 0];
    // `color-mix()` COMPUTES to `color(srgb r g b / a)` in Chrome, where the
    // channels run 0..1. Read as 0..255 every mix resolves to black, and the
    // accent fill a pressed row was painted with measured 18.61:1 against white
    // ink instead of 1.3:1 — the guard reporting the opposite of the defect.
    var k = /^color\(/.test(c || "") ? 255 : 1;
    return { r: +m[0] * k, g: +m[1] * k, b: +m[2] * k, a: m.length > 3 ? +m[3] : 1 };
  };
  var over = function (top, under) {
    // src-over, the compositing the browser actually does. `opaque()` used to
    // accept ANY non-zero alpha, so a 0.055 glass fill was read as the ground
    // and every ink on chrome measured 1.12:1 against near-white (§10.1).
    var a = top.a;
    return { r: top.r * a + under.r * (1 - a),
             g: top.g * a + under.g * (1 - a),
             b: top.b * a + under.b * (1 - a), a: 1 };
  };
  var lumRGB = function (c) {
    return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  };
  // THE WORST CASE: the lightest region is the top-left lobe.
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
  // EVERY control, not the first of each kind: `querySelector(".nav .tab")`
  // measured whichever the FIXTURE put first (the selected one, 7.31:1) while
  // the app puts an unselected one there at 1.49:1 (walk 5). The header pills
  // are TEXT on glass, this assertion's whole subject, measured by nothing.
  // …AND A DEAD CONTROL IS STILL TEXT (R18-P2). `Save agent` was reported at
  // 1.15:1 and nothing here could see it: the sweep listed live controls only,
  // so the one painting in the product that is DEFINED by being low-contrast was
  // the one painting nothing measured.
  var controls = ".panel-toggle, .skin-toggle, .nav .view-item, .agent-tabs .tab, " +
                 ".warmth, .meter, .file-entry, button:disabled, input, textarea, select";
  document.querySelectorAll(controls).forEach(function (el, i) {
    var name = (el.id || el.className || el.tagName).toString().slice(0, 24);
    check(el, name + "[" + i + "]");
  });
  // ---- …AND THE STATES THE POINTER PUTS THEM IN (R11-6) -------------------
  // A pressed process row measured rgb(198,186,216) on rgb(203,168,255), 1.1:1:
  // `controls.css` paints every bare `button` with the accent fill and its
  // `:hover`/`:active` rules are (0,1,1), outranking a class rule written
  // without one. Nothing here could see it — getComputedStyle reports the state
  // an element is IN, and headless never hovers.
  // Not by resolving values by hand: `var()`, `color-mix()` and SPECIFICITY
  // would all need re-implementing, and specificity is what made the defect.
  // Every `:hover`/`:active` rule is COPIED with the pseudo rewritten to a real
  // class of the same specificity, and the browser's own cascade answers.
  // …with TRANSITIONS OFF. `getComputedStyle` reports the value a transition is
  // CURRENTLY at, and these fills are transitioned at `--dur-fast`: read in the
  // same frame, the browser answers "still the old colour", and the audit would
  // pass a 1.1:1 painting by measuring the paint before it happened.
  // …AND INSIDE THE @media THE HOVER RULES NOW LIVE IN (R20-RAIL). This walked
  // only the TOP level, where a `CSSMediaRule` has no `selectorText` — so after
  // commit d5b1cb0 put all eleven hover rules behind
  // `@media (hover: hover) and (pointer: fine)`, every one of them became
  // invisible here. MEASURED: the 810 `:hover` assertion lines survived and 594
  // of them started reading `rgba(0, 0, 0, 0)`, the RESTING paint. The
  // assertions did not disappear; they lost their subject, which is worse than
  // no gate because the report still says PASS. `cssRules` on a grouping rule
  // is the same interface as on a sheet, so one recursive walk covers @media,
  // @supports and @layer alike.
  var collect = function (rules, state, marker) {
    var css = "";
    for (var j = 0; j < rules.length; j++) {
      var r = rules[j];
      if (r.cssRules && !r.selectorText) { css += collect(r.cssRules, state, marker); continue; }
      if (!r.selectorText || r.selectorText.indexOf(state) < 0) continue;
      // Lifted OUT of its media query on purpose: the probe is measuring the
      // painting, and whether this device would ever enter the state is the
      // question `crates/ui/src/posture/mod.rs` answers, not this one.
      css += r.cssText.split(state).join(marker) + "\n";
    }
    return css;
  };
  var forced = function (state, marker) {
    var css = "*, *::before, *::after { transition: none !important; }\n";
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules;
      try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
      css += collect(rules, state, marker);
    }
    var tag = document.createElement("style");
    tag.textContent = css;
    document.head.appendChild(tag);
    return tag;
  };
  [":hover", ":active"].forEach(function (state) {
    var marker = ".probe" + state.replace(":", "-");
    var tag = forced(state, marker);
    document.querySelectorAll(".file-entry, .file-ref, .nav .view-item").forEach(function (el, i) {
      el.classList.add(marker.slice(1));
      void document.body.offsetHeight;
      var s = getComputedStyle(el);
      var g = lum(over(rgb(s.backgroundColor), ground(el.parentElement || el)));
      var name = (el.className || el.tagName).toString().replace(marker.slice(1), "").slice(0, 22);
      say(ratio(lum(s.color), g) >= 4.5, "CONTRAST " + name + state + "[" + i + "]",
          s.color + " on " + s.backgroundColor + " " + ratio(lum(s.color), g).toFixed(2) + ":1");
      el.classList.remove(marker.slice(1));
    });
    tag.remove();
  });

  // …and both switch states, since folded is a different painting.
  document.querySelectorAll(".panel-toggle").forEach(function (b, i) {
    b.click();
    void document.body.offsetHeight;
    check(b, "panel-toggle[" + i + "] folded");
    b.click();
    void document.body.offsetHeight;
  });
  // POINTER TARGETS, AS A GATE (R20-RAIL). This was `info(...)` at 24px, and
  // `info` is not counted as a failure — so `web/controls.css:15` carried the
  // comment "the target a thumb can hit (WCAG 2.2), a floor" since increment 12
  // with nothing able to fail on it. 44 is the number the product's own comment
  // states, so 44 is what is checked.
  //
  // TWO EXEMPTIONS, EACH NAMED WITH ITS REASON, because a lowered threshold
  // would exempt everything silently:
  //  - `.skip-link` is `position: absolute; transform: translateY(-300%)`
  //    (`web/base.css:116-128`) until `:focus`. It is OFF-SCREEN for a pointer
  //    and reachable only by Tab, i.e. only by the input class that has no
  //    thumb. Measured by hand at 375x812: 134x42, the ONE element in the page
  //    under the floor. Growing it to 44 would put a taller bar over the header
  //    the instant a keyboard user presses Tab — a regression in the one
  //    interaction it serves, paid to a pointer that cannot reach it.
  //  - an inline `<a>` inside prose, which WCAG 2.5.8 exempts by name (13d).
  var FLOOR = 44;
  var exempt = function (el) {
    if (el.classList.contains("skip-link")) return true;
    var p = el.parentElement;
    return el.tagName === "A" && !!p && ["P", "LI", "TD"].indexOf(p.tagName) >= 0;
  };
  var small = [];
  document.querySelectorAll("button, a, input, summary").forEach(function (el) {
    var r = rect(el);
    if (!r.width || !r.height || exempt(el)) return;
    if (Math.min(r.width, r.height) < FLOOR) {
      small.push((el.textContent || el.tagName).trim().slice(0, 14) + " " +
                 Math.round(r.width) + "x" + Math.round(r.height));
    }
  });
  say(small.length === 0, "TARGETS",
      small.length ? "under " + FLOOR + "px: " + small.join(", ") : "none under " + FLOOR + "px");

  document.getElementById("report").textContent =
    "== " + W + "x" + window.innerHeight + " skin=" + (q.get("skin") || "machine") +
    " route=" + route + "\n" + out.join("\n");
})();
