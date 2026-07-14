// Custom JS tool (lives beside the agents; listed in manifest.json "tools").
// Self-registers on window.askkTools with an MCP-shaped card. The harness
// evals this file at boot, reads the card, and exposes `fetch_url` to agents.
window.askkTools = window.askkTools || {};
window.askkTools["fetch_url"] = {
  description:
    "Fetch a URL over HTTP(S) and return its response body as text (truncated to 4000 chars). Subject to the browser's CORS policy.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The absolute URL to fetch." },
    },
    required: ["url"],
  },
  async call(args) {
    const url = args && args.url;
    if (!url) return "fetch_url: missing 'url'";
    try {
      const resp = await fetch(url);
      const body = await resp.text();
      const head = `HTTP ${resp.status} ${resp.statusText}\n`;
      return head + body.slice(0, 4000);
    } catch (e) {
      return `fetch_url: request failed (CORS or network): ${String(e)}`;
    }
  },
};
