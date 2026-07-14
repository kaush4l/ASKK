// ASKK c2w VM worker (classic worker, copied verbatim to assets — NOT
// bundled). Boots the container2wasm WASI module (Bochs x86_64 + Alpine
// rootfs in one wasm) and serves its tty to the main thread via xterm-pty's
// TtyClient (SharedArrayBuffer + Atomics).
//
// Protocol: the first message is {type:"conf", scripts:[urls]} carrying the
// asset URLs of the classic-script dependencies (Dioxus hashes asset names,
// so importScripts can't hardcode them): xterm-pty workerTools, the vendored
// browser_wasi_shim (index + wasi_defs), and c2w's worker-util + wasi-util.
// After importScripts, "conf-ok" is posted and the upstream wasi-browser
// protocol takes over: {type:"init", imagename} then TtyServer's messages.
//
// Networking is deliberately absent (mirrors the v86 console: no guest net).

var confDone = false;

self.onmessage = function (msg) {
  var d = msg.data;
  if (!confDone && d && d.type === "conf") {
    confDone = true;
    importScripts.apply(self, d.scripts);
    self.onmessage = mainOnMessage;
    self.postMessage({ type: "conf-ok" });
    return;
  }
};

// Upstream examples/wasi-browser/htdocs/worker.js logic, no-net path only.
function mainOnMessage(msg) {
  if (serveIfInitMsg(msg)) {
    return;
  }
  var ttyClient = new TtyClient(msg.data);
  fetchImage().then(function (wasm) {
    startWasi(wasm, ttyClient, [], [], [], 3, 5);
  });
}

// Fetch the image whole; on 404 fall back to the chunked layout
// (`<name>.wasm00.wasm`, `<name>.wasm01.wasm`, …) that publish.sh produces
// when the file exceeds GitHub Pages' 100 MB per-file cap. Self-configuring:
// no chunk count is baked anywhere — chunks are fetched until the first 404.
function fetchImage() {
  var name = getImagename();
  return fetch(name, { credentials: "same-origin" }).then(function (resp) {
    if (resp.ok) {
      return resp.arrayBuffer();
    }
    return fetchChunked(name);
  });
}

function fetchChunked(name) {
  var bufs = [];
  function next(i) {
    var s = i.toString();
    while (s.length < 2) s = "0" + s;
    return fetch(name + s + ".wasm", { credentials: "same-origin" }).then(
      function (r) {
        if (!r.ok) {
          if (i === 0) {
            throw new Error("VM image missing: " + name);
          }
          return bufs;
        }
        return r.arrayBuffer().then(function (b) {
          bufs.push(b);
          return next(i + 1);
        });
      }
    );
  }
  return next(0).then(function (parts) {
    var total = 0;
    parts.forEach(function (b) {
      total += b.byteLength;
    });
    var out = new Uint8Array(total);
    var off = 0;
    parts.forEach(function (b) {
      out.set(new Uint8Array(b), off);
      off += b.byteLength;
    });
    return out.buffer;
  });
}

function startWasi(wasm, ttyClient, args, env, fds, listenfd, connfd) {
  var wasi = new WASI(args, env, fds);
  wasiHack(wasi, ttyClient, connfd);
  wasiHackSocket(wasi, listenfd, connfd);
  WebAssembly.instantiate(wasm, {
    wasi_snapshot_preview1: wasi.wasiImport,
  }).then(function (inst) {
    wasi.start(inst.instance);
  });
}

// wasiHack patches the WASI object to route stdio through xterm-pty and to
// give the emulator a usable poll_oneoff. Ported from upstream
// examples/wasi-browser/htdocs/worker.js (wasiHackSocket comes from
// worker-util.js, which is importScripts'd above).
function wasiHack(wasi, ttyClient, connfd) {
  const ERRNO_INVAL = 28;
  var _fd_read = wasi.wasiImport.fd_read;
  wasi.wasiImport.fd_read = (fd, iovs_ptr, iovs_len, nread_ptr) => {
    if (fd == 0) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      var iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
      var nread = 0;
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i];
        if (iovec.buf_len == 0) {
          continue;
        }
        var data = ttyClient.onRead(iovec.buf_len);
        buffer8.set(data, iovec.buf);
        nread += data.length;
      }
      buffer.setUint32(nread_ptr, nread, true);
      return 0;
    }
    return _fd_read.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nread_ptr]);
  };
  var _fd_write = wasi.wasiImport.fd_write;
  wasi.wasiImport.fd_write = (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
    if (fd == 1 || fd == 2) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      var iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
      var wtotal = 0;
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i];
        var buf = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
        if (buf.length == 0) {
          continue;
        }
        ttyClient.onWrite(Array.from(buf));
        wtotal += buf.length;
      }
      buffer.setUint32(nwritten_ptr, wtotal, true);
      return 0;
    }
    return _fd_write.apply(wasi.wasiImport, [
      fd,
      iovs_ptr,
      iovs_len,
      nwritten_ptr,
    ]);
  };
  wasi.wasiImport.poll_oneoff = (in_ptr, out_ptr, nsubscriptions, nevents_ptr) => {
    if (nsubscriptions == 0) {
      return ERRNO_INVAL;
    }
    let buffer = new DataView(wasi.inst.exports.memory.buffer);
    let in_ = Subscription.read_bytes_array(buffer, in_ptr, nsubscriptions);
    let isReadPollStdin = false;
    let isReadPollConn = false;
    let isClockPoll = false;
    let pollSubStdin;
    let pollSubConn;
    let clockSub;
    let timeout = Number.MAX_VALUE;
    for (let sub of in_) {
      if (sub.u.tag.variant == "fd_read") {
        if (sub.u.data.fd != 0 && sub.u.data.fd != connfd) {
          return ERRNO_INVAL;
        }
        if (sub.u.data.fd == 0) {
          isReadPollStdin = true;
          pollSubStdin = sub;
        } else {
          isReadPollConn = true;
          pollSubConn = sub;
        }
      } else if (sub.u.tag.variant == "clock") {
        if (sub.u.data.timeout < timeout) {
          timeout = sub.u.data.timeout;
          isClockPoll = true;
          clockSub = sub;
        }
      } else {
        return ERRNO_INVAL;
      }
    }
    let events = [];
    if (isReadPollStdin || isReadPollConn || isClockPoll) {
      var readable = false;
      if (isReadPollStdin || (isClockPoll && timeout > 0)) {
        readable = ttyClient.onWaitForReadable(timeout / 1000000000);
      }
      if (readable && isReadPollStdin) {
        let event = new Event();
        event.userdata = pollSubStdin.userdata;
        event.error = 0;
        event.type = new EventType("fd_read");
        events.push(event);
      }
      if (isReadPollConn) {
        var sockreadable = sockWaitForReadable();
        if (sockreadable == errStatus) {
          return ERRNO_INVAL;
        } else if (sockreadable == true) {
          let event = new Event();
          event.userdata = pollSubConn.userdata;
          event.error = 0;
          event.type = new EventType("fd_read");
          events.push(event);
        }
      }
      if (isClockPoll) {
        let event = new Event();
        event.userdata = clockSub.userdata;
        event.error = 0;
        event.type = new EventType("clock");
        events.push(event);
      }
    }
    var len = events.length;
    Event.write_bytes_array(buffer, out_ptr, events);
    buffer.setUint32(nevents_ptr, len, true);
    return 0;
  };
}
