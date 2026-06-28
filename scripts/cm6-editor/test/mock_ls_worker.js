// Mock language-service worker for the CM6 harness page (test/index.html).
//
// Speaks the postMessage protocol documented in ../entry.js: replies to
// `completion` with two fixed items, replies to `hover` with a fixed string,
// replies to `format` with a trivially-formatted document (trailing
// whitespace stripped from every line), and publishes one diagnostic whenever
// a document is opened (didOpen). Used to exercise
// AskkCM.attachLanguageService — including format-on-save — end to end
// without a real language service.

const files = new Map();

self.onmessage = (event) => {
  const msg = event.data || {};
  switch (msg.method) {
    case "initialize":
      for (const file of msg.files || []) files.set(file.path, file.text);
      break;

    case "didOpen": {
      files.set(msg.path, msg.text || "");
      const len = (msg.text || "").length;
      self.postMessage({
        method: "publishDiagnostics",
        path: msg.path,
        diagnostics: [
          {
            from: 0,
            to: Math.min(5, len),
            severity: "warning",
            message: "mock-ls: diagnostic published on didOpen",
          },
        ],
      });
      break;
    }

    case "didChange":
      files.set(msg.path, msg.text || "");
      break;

    case "didClose":
      files.delete(msg.path);
      break;

    case "completion":
      self.postMessage({
        id: msg.id,
        result: {
          items: [
            {
              label: "mockCompletionOne",
              detail: "fixed item from mock_ls_worker",
              insertText: "mockCompletionOne()",
              kind: "function",
            },
            {
              label: "mockCompletionTwo",
              detail: "fixed item from mock_ls_worker",
              kind: "variable",
            },
          ],
        },
      });
      break;

    case "hover":
      self.postMessage({
        id: msg.id,
        result: { contents: `mock-ls hover for ${msg.path} @ ${msg.offset}` },
      });
      break;

    case "format": {
      // Trivial formatter: strip trailing whitespace from every line. Returns
      // the full formatted document as { text } per the protocol.
      const text = typeof msg.text === "string" ? msg.text : files.get(msg.path) || "";
      const formatted = text
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/, ""))
        .join("\n");
      self.postMessage({ id: msg.id, result: { text: formatted } });
      break;
    }

    default:
      break;
  }
};
