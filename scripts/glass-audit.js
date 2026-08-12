// The material half of the layout probe (increment 14D). Split out rather than
// added to layout-audit.js, which sits at 163 lines against the 200-line rule
// (I12) — a fourth concern would not have fit, and the file that carries the
// contrast model is not the file that should carry the nesting model.
//
// It runs BETWEEN layout-probe.js (which builds `window.__probe`) and
// layout-audit.js (which writes #report), so its verdicts land in the same
// `out` array and reach check-layout.sh's `grep -c '^FAIL '`.
//
// What the rest of the guard could not see: contrast and boundaries are
// measured off computed colours, which are identical whether or not a surface
// is glass. Nothing anywhere asked how many blurring layers stack, which
// elevation is nested in which, or what a paragraph is painted on. N1-N4 and G3
// (DESIGN.md §4) are exactly those questions.
(function () {
  var P = window.__probe;
  var say = P.say, info = P.info;

  // Mirrors the elevation groups in web/glass.css. The utility classes lead
  // each list because that file's own contract is that new components opt in by
  // class — an element that is E1 without being `.e1` is one of the five names
  // below and nothing else.
  var E1 = ".e1, header, .nav, .rail, .stage";
  var E2 = ".e2, .panel, .agent-row, .tool-call, .agent-card, .term-run";

  // A blurring layer is one that actually blurs. The opaque path re-points
  // `--e1-blur` to `0px`, so the computed value there is `blur(0px) saturate(1)`
  // — not `none`, and a guard testing `!== "none"` would count three stacked
  // nothings as a violation in the plain skin and in every reduced-transparency
  // browser. The material is the radius, not the property's presence.
  var blur = function (el) {
    var s = getComputedStyle(el);
    var m = /blur\(([\d.]+)px\)/.exec(s.backdropFilter || s.webkitBackdropFilter || "");
    return m ? +m[1] : 0;
  };
  var name = function (el) {
    var c = typeof el.className === "string" ? el.className.trim() : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
           (c ? "." + c.split(/\s+/).join(".") : "");
  };
  var alpha = function (el) {
    var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
    if (!m) return 1;
    var parts = m[1].split(",");
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  };
  var all = function (fn) { document.querySelectorAll("body *").forEach(fn); };

  // ---- N1: E3 is never a descendant of E1 or E2 ---------------------------
  // Identity is the class OR the material: a surface that carries E3's blur
  // radius IS E3 whatever it calls itself, which is how "a card variant that's
  // a bit more frosted" gets caught. In the opaque path --e3-blur is 0 and the
  // class is the only signal, which is correct — there is no material to nest.
  var e3blur = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--e3-blur")) || 0;
  var e3 = [], n1 = [];
  all(function (el) {
    if (!el.matches(".e3") && !(e3blur > 0 && blur(el) === e3blur)) return;
    e3.push(el);
    var host = el.parentElement && el.parentElement.closest(E1 + ", " + E2);
    if (host) n1.push(name(el) + " inside " + name(host));
  });
  say(!n1.length, "N1", n1.join(" | ") ||
      e3.length + " E3 surface(s), none under E1/E2");

  // ---- N4: at most two blurring layers in any ancestor chain --------------
  // Walked up from every LEAF, because the ceiling is a property of the chain a
  // pixel is composited through, not of any one element. Reports the worst
  // chain, root-first, so the offender is the one you can name.
  var worst = null;
  all(function (el) {
    if (el.children.length) return;
    var stack = [];
    for (var p = el; p && p !== document.documentElement; p = p.parentElement) {
      if (blur(p) > 0) stack.push(p);
    }
    if (stack.length > 2 && (!worst || stack.length > worst.length)) worst = stack;
  });
  say(!worst, "N4", worst
    ? worst.length + " blurring layers: " +
      worst.map(name).reverse().join(" > ")
    : "no chain over 2 blurring layers");

  // ---- N2: `.e1 .e2 { backdrop-filter: none }` actually takes effect ------
  // Deliberately overlapping N4: N4 is the ceiling and would stay green on a
  // two-deep stack, while N2 is the specific rule whose failure is silent —
  // delete it and the page still looks nearly identical, costs a second
  // full-surface composite per nested card, and nothing says a word.
  var n2 = [];
  all(function (el) {
    if (blur(el) <= 0 || !el.parentElement) return;
    for (var p = el.parentElement; p; p = p.parentElement) {
      if (blur(p) > 0) {
        if (el.parentElement.closest(E1)) {
          n2.push(name(el) + " blurs inside " + name(p));
        }
        return;
      }
    }
  });
  say(!n2.length, "N2", n2.join(" | ") || "no blur nested inside an E1 surface");

  // ---- G3: body text never sits on a blur ---------------------------------
  // Walk out from the text's own element: the first ancestor with an OPAQUE
  // background shields it and the walk stops; a blurring ancestor reached first
  // is the violation. Self is checked before its own blur, so a surface that is
  // both blurred and opaquely filled reads as shielded, which is what it is.
  var g3 = [], counted = 0;
  all(function (el) {
    if (el.closest("#report") || !el.getClientRects().length) return;
    var t = Array.prototype.filter.call(el.childNodes, function (n) {
      return n.nodeType === 3 && n.textContent.trim().length > 40;
    })[0];
    if (!t) return;
    counted++;
    for (var p = el; p && p !== document.documentElement; p = p.parentElement) {
      if (alpha(p) === 1) return;
      if (blur(p) > 0) {
        g3.push(name(el) + ' "' + t.textContent.trim().slice(0, 24) + '..." on ' + name(p));
        return;
      }
    }
  });
  say(!g3.length, "G3", g3.join(" | ") ||
      counted + " text node(s) over 40 chars, all on an opaque surface");

  info("MATERIAL", "e3-blur=" + e3blur + "px e3-surfaces=" + e3.length +
       " long-text=" + counted);
})();
