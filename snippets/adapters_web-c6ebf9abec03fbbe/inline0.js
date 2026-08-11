
let linux = null, booting = null, queue = Promise.resolve(), out = [];

function load(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error("could not load the CheerpX engine from " + src));
    document.head.appendChild(el);
  });
}

async function bootOnce(engine, disk, cache) {
  if (typeof document === "undefined")
    throw new Error("the workspace runs in the page, not in an agent's Worker");
  if (!self.crossOriginIsolated)
    throw new Error("this page is not cross-origin isolated, so SharedArrayBuffer is unavailable");
  if (!self.CheerpX) await load(engine);
  const base = await CheerpX.CloudDevice.create(disk);
  const cached = await CheerpX.IDBDevice.create(cache);
  const overlay = await CheerpX.OverlayDevice.create(base, cached);
  const cx = await CheerpX.Linux.create({ mounts: [
    { type: "ext2", dev: overlay, path: "/" },
    { type: "devs", path: "/dev" },
    { type: "devpts", path: "/dev/pts" },
    { type: "proc", path: "/proc" },
    { type: "sys", path: "/sys" },
  ]});
  const decoder = new TextDecoder();
  cx.setCustomConsole((data) => {
    out.push(typeof data === "number" ? String.fromCharCode(data) : decoder.decode(data, { stream: true }));
  }, 120, 40);
  linux = cx;
}

export function cx_boot(engine, disk, cache) {
  if (!booting) booting = bootOnce(engine, disk, cache).catch((e) => { booting = null; throw e; });
  return booting;
}

// One command at a time: a second cx.run while the first is live would
// interleave two commands' output in one console.
export function cx_exec(command) {
  const run = queue.then(async () => {
    out = [];
    const status = await linux.run("/bin/sh", ["-c", command], {
      env: ["HOME=/root", "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "TERM=dumb"],
      cwd: "/root", uid: 0, gid: 0,
    });
    // The console is a terminal: it carries escape sequences and CRLF that
    // belong to a screen, not to a captured result.
    const text = out.join("")
      .replace(/\x1b\][^\x07]*\x07/g, "")
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
      .replace(/\r\n/g, "\n");
    const code = typeof status === "number" ? status : (status && status.status) | 0;
    return JSON.stringify({ status: code, output: text });
  });
  queue = run.catch(() => {});
  return run;
}
