/* askk-ws.js — WebSocket-over-relay polyfill for the hermes dashboard iframe.
 *
 * Service workers cannot intercept WebSocket upgrades, so the ingress relay
 * (askk-sw.js) can never carry a real WS. Instead the SW injects this script
 * into every relayed dashboard HTML document; it replaces window.WebSocket
 * with a shim that tunnels frames over plain fetches:
 *
 *   POST /__ws/open        {path}            -> {id}
 *   GET  /__ws/recv/<id>                     -> {msgs:[{t,d|c}...]} | 204
 *   POST /__ws/send/<id>   {t:'txt'|'bin', d}
 *   POST /__ws/close/<id>  {c}
 *
 * Those fetches ride the normal iframe->SW->ingress-queue->guest path
 * (hermesClients routing); guest-side askk-ingressd routes /__ws/* to the
 * askk-wsbridge daemon (127.0.0.1:9219) which speaks real WebSocket to the
 * hermes dashboard on 127.0.0.1:9119. Schema pinned in CONTRACTS.md.
 *
 * Latency ceiling: one relay round trip per recv cycle — the events feed and
 * chat work, but frames arrive with relay latency (seconds), not
 * milliseconds. The terminal pane remains the fast path.
 */
(function (g) {
  "use strict";
  if (g.__askkWsInstalled) return;
  g.__askkWsInstalled = true;

  var NativeWS = g.WebSocket;

  // ws(s)://<any-host>/path?q  |  /path?q  ->  "/path?q"
  function wsPath(url) {
    try {
      var u = new URL(String(url), g.location.href);
      return u.pathname + u.search;
    } catch (e) {
      return String(url);
    }
  }

  function b64ToBuf(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  function bufToB64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function RelayWebSocket(url, _protocols) {
    var self = this;
    this.url = String(url);
    this.readyState = RelayWebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.binaryType = "blob";
    this.protocol = "";
    this.extensions = "";
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._target = new EventTarget();
    this._id = null;
    this._sendQ = []; // frames queued while CONNECTING
    this._alive = true;

    fetch("/__ws/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: wsPath(url) }),
    }).then(function (r) {
      if (!r.ok) throw new Error("open " + r.status);
      return r.json();
    }).then(function (o) {
      if (!self._alive) return;
      self._id = o.id;
      self.readyState = RelayWebSocket.OPEN;
      self._fire("open", new Event("open"));
      var q = self._sendQ; self._sendQ = [];
      q.forEach(function (f) { self._post(f); });
      self._recvLoop();
    }).catch(function () {
      self._die(1006);
    });
  }

  RelayWebSocket.CONNECTING = 0;
  RelayWebSocket.OPEN = 1;
  RelayWebSocket.CLOSING = 2;
  RelayWebSocket.CLOSED = 3;
  RelayWebSocket.prototype.CONNECTING = 0;
  RelayWebSocket.prototype.OPEN = 1;
  RelayWebSocket.prototype.CLOSING = 2;
  RelayWebSocket.prototype.CLOSED = 3;

  RelayWebSocket.prototype.addEventListener = function (t, fn, o) { this._target.addEventListener(t, fn, o); };
  RelayWebSocket.prototype.removeEventListener = function (t, fn, o) { this._target.removeEventListener(t, fn, o); };
  RelayWebSocket.prototype.dispatchEvent = function (ev) { return this._target.dispatchEvent(ev); };

  RelayWebSocket.prototype._fire = function (name, ev) {
    try { this._target.dispatchEvent(ev); } catch (e) {}
    var h = this["on" + name];
    if (typeof h === "function") { try { h.call(this, ev); } catch (e) {} }
  };

  RelayWebSocket.prototype._die = function (code) {
    if (!this._alive) return;
    this._alive = false;
    this.readyState = RelayWebSocket.CLOSED;
    this._fire("error", new Event("error"));
    this._fire("close", new CloseEvent("close", { code: code || 1006, wasClean: false }));
  };

  RelayWebSocket.prototype._recvLoop = function () {
    var self = this;
    if (!self._alive || self._id === null) return;
    fetch("/__ws/recv/" + self._id).then(function (r) {
      if (!self._alive) return null;
      if (r.status === 204) return { msgs: [] };
      // 404 = the bridge no longer knows this socket — that's final. Any
      // other failure (502 relay orphan, transient network) is retried a
      // few times before giving up: one hiccup must not kill a live chat
      // stream mid-completion.
      if (r.status === 404) throw { fatal: true };
      if (!r.ok) throw { fatal: false };
      self._recvFails = 0;
      return r.json();
    }).then(function (o) {
      if (!o || !self._alive) return;
      (o.msgs || []).forEach(function (m) {
        if (!self._alive) return;
        if (m.t === "txt") {
          self._fire("message", new MessageEvent("message", { data: m.d }));
        } else if (m.t === "bin") {
          var buf = b64ToBuf(m.d);
          var data = self.binaryType === "arraybuffer" ? buf : new Blob([buf]);
          self._fire("message", new MessageEvent("message", { data: data }));
        } else if (m.t === "close") {
          self._alive = false;
          self.readyState = RelayWebSocket.CLOSED;
          self._fire("close", new CloseEvent("close", { code: m.c || 1000, wasClean: true }));
        }
      });
      if (self._alive) self._recvLoop();
    }).catch(function (err) {
      if (err && err.fatal === false) {
        self._recvFails = (self._recvFails || 0) + 1;
        if (self._recvFails <= 3 && self._alive) {
          setTimeout(function () { self._recvLoop(); }, 2000 * self._recvFails);
          return;
        }
      }
      self._die(1006);
    });
  };

  RelayWebSocket.prototype._post = function (frame) {
    var self = this;
    fetch("/__ws/send/" + this._id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(frame),
    }).catch(function () { self._die(1006); });
  };

  RelayWebSocket.prototype.send = function (data) {
    if (this.readyState === RelayWebSocket.CONNECTING) {
      // real WS throws here; hermes' client never does this, but stay honest
      throw new DOMException("Still in CONNECTING state.", "InvalidStateError");
    }
    if (this.readyState !== RelayWebSocket.OPEN) return;
    var self = this;
    if (typeof data === "string") {
      this._post({ t: "txt", d: data });
    } else if (data instanceof Blob) {
      data.arrayBuffer().then(function (buf) { self._post({ t: "bin", d: bufToB64(buf) }); });
    } else if (data instanceof ArrayBuffer) {
      this._post({ t: "bin", d: bufToB64(data) });
    } else if (ArrayBuffer.isView(data)) {
      this._post({ t: "bin", d: bufToB64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) });
    } else {
      this._post({ t: "txt", d: String(data) });
    }
  };

  RelayWebSocket.prototype.close = function (code) {
    if (this.readyState === RelayWebSocket.CLOSED || this.readyState === RelayWebSocket.CLOSING) return;
    this.readyState = RelayWebSocket.CLOSING;
    var self = this;
    var finish = function () {
      self._alive = false;
      self.readyState = RelayWebSocket.CLOSED;
      self._fire("close", new CloseEvent("close", { code: code || 1000, wasClean: true }));
    };
    if (this._id === null) { finish(); return; }
    fetch("/__ws/close/" + this._id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: code || 1000 }),
    }).then(finish, finish);
  };

  g.WebSocket = RelayWebSocket;
  g.__askkNativeWebSocket = NativeWS; // escape hatch for debugging
})(window);
