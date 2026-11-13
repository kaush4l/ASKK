// The published tab in Firefox: each screen at a desktop and a phone width, dark and light.
// Says, per frame, whether the glass (`backdrop-filter`) and the springs (`linear()`) are
// there, whether the page scrolls sideways, whether `/` opens the composer's menu, and what
// the page threw. Frames go to <out>; a JSON report to stdout. Exit 1 when a frame is wrong.
//
//   node check.mjs <site url, ending in /> <out folder>
//
// It is run from beside an installed `playwright` (the firefox workflow copies it there).
// Firefox does not start on the owner's macOS 27, so this runs on the Linux runner.
import { firefox } from "playwright";
import { mkdirSync } from "node:fs";

const [site, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pages = [["home", ""], ["talk", "talk"], ["sessions", "sessions"], ["settings", "settings"]];
const sizes = [["desktop", 1440, 900], ["phone", 390, 844]];
const browser = await firefox.launch();
const report = { engine: `firefox ${browser.version()}`, frames: {} };
let wrong = 0;
for (const [name, path] of pages) {
  for (const [size, w, h] of sizes) {
    for (const scheme of ["dark", "light"]) {
      const p = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
      const errors = [];
      p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
      await p.goto(site + path, { waitUntil: "load" });
      await p.waitForSelector(".glass", { timeout: 30000 }).catch(() => errors.push("no glass surface in 30 s"));
      await p.waitForTimeout(1000);
      const f = await p.evaluate(() => ({
        backdrop: CSS.supports("backdrop-filter", "blur(4px)"),
        linear: CSS.supports("transition-timing-function", "linear(0, 1)"),
        glass: [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).backdropFilter !== "none").length,
        overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      const ta = await p.$("textarea");
      if (ta) {
        await ta.click();
        await p.keyboard.type("/");
        await p.waitForTimeout(500);
        f.slashMenu = await p.evaluate(() => /\/clear/.test(document.body.innerText));
        await p.keyboard.press("Escape");
      }
      f.errors = errors;
      const key = `${name}--${size}-${scheme}`;
      await p.screenshot({ path: `${out}/firefox--${key}.png` });
      const bad = !f.backdrop || !f.linear || f.glass === 0 || f.overflowX || f.slashMenu === false || errors.length > 0;
      if (bad) wrong++;
      report.frames[key] = { ...f, ok: !bad };
      await p.close();
    }
  }
}
await browser.close();
report.wrong = wrong;
console.log(JSON.stringify(report));
process.exit(wrong ? 1 : 0);
