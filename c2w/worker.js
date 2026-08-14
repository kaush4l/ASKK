// The container's own Worker: it runs the c2w VM and speaks the xterm-pty
// TTY protocol back to the page. Transport only — no application logic (I5).
//
// Both imports are RELATIVE, for two separate reasons:
//
//  1. Cross-origin isolation. The page is served COEP: require-corp and
//     importScripts() issues a no-cors request, so a CDN script with no
//     Cross-Origin-Resource-Policy header is blocked and the worker dies with
//     no console error and no output at all. The stock container2wasm example
//     pulls xterm-pty's workerTools.js from jsdelivr, which is exactly that
//     case; it is vendored beside this file instead.
//  2. The site is served from a repo subpath (kaush4l.github.io/ASKK/), so the
//     example's `location.origin + "/dist/…"` resolves above the site root.
importScripts(new URL("./vendor/xterm-pty-workerTools.js", location.href).href);
importScripts(new URL("./dist/worker-util.js", location.href).href);

var info;
var args;

self.onerror = (e) => {
  console.error("c2w container worker error:", (e && e.message) || e);
};

onmessage = (msg) => {
  const req_ = msg.data;
  if (typeof req_ == "object" && req_.type == "init") {
    info = req_.info;
    args = req_.args;
    return;
  }
  var ttyClient = new TtyClient(msg.data);
  RunContainer.startContainer(info, args, ttyClient);
};
