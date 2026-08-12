// The FOLD assertions (split out of layout-probe.js, which hit the 200-line
// rule carrying them). This is the promise the dashboard makes in words:
// folding a side panel hands its width to the CENTRE, exactly, and the centre
// is never the thinnest column on screen.
//
// It runs after layout-probe.js and shares its `window.__probe`. It presses the
// real switches rather than setting `hidden` itself, because the
// `aria-expanded` -> `hidden` contract is part of what is being tested.
(function () {
  var P = window.__probe;
  var say = P.say, info = P.info, rect = P.rect, W = P.W;

  // ---- FOLD: a folded region gives its width to the STAGE ------------------
  // The check that did not exist in 13, which is why 13 and 13b both shipped
  // broken: twice the stage LOST width when a panel was put away — first
  // auto-placement moved it into a content-sized track, then a dead layer's
  // template outranked its replacement and capped it at 416px in all twelve
  // fold states — and the probe said OK both times, modelling a page with no
  // folds in it. The assertion is the promise in words.
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
})();
