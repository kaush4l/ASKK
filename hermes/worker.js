// Container worker. Both imports are RELATIVE, for two separate reasons:
//
//  1. Cross-origin isolation. The page is served COEP: require-corp, and
//     importScripts() issues a no-cors request — a CDN script with no
//     Cross-Origin-Resource-Policy header is blocked, and the worker then
//     dies with no console error and no terminal output at all. The stock
//     c2w example pulls xterm-pty's workerTools.js from jsdelivr, which is
//     precisely that case; it is vendored here instead.
//  2. gh-pages serves the site from a subpath, so the example's
//     location.origin + "/dist/…" resolves above the site root.
importScripts(new URL("./vendor/xterm-pty-workerTools.js", location.href).href);
importScripts(new URL("./dist/worker-util.js", location.href).href);

var info;
var args;

self.onerror = (e) => {
    console.error("container worker error:", (e && e.message) || e);
};

onmessage = (msg) => {
    const req_ = msg.data;
    if ((typeof req_ == "object") && (req_.type == "init")) {
        info = req_.info;
        args = req_.args;
        return;
    }
    var ttyClient = new TtyClient(msg.data);
    RunContainer.startContainer(info, args, ttyClient);
};
