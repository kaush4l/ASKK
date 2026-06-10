// Mock language-service worker for the CM6 harness page (test/index.html).
//
// Speaks the postMessage protocol documented in ../entry.js: replies to
// `completion` with two fixed items, replies to `hover` with a fixed string,
// and publishes one diagnostic whenever a document is opened (didOpen). Used
// to exercise AskkCM.attachLanguageService end to end without a real
// language service.

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

    default:
      break;
  }
};
