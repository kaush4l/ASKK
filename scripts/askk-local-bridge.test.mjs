import http from "node:http";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridgeServer, readWorkspacePromptFiles } from "./askk-local-bridge.mjs";

const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
});

describe("ASKK local bridge web tools", () => {
    it("normalizes Brave-style web search results", async () => {
        const mock = http.createServer((request, response) => {
            assert.equal(request.method, "GET");
            assert.equal(request.headers["x-subscription-token"], "brave-test");
            const url = new URL(request.url, "http://mock.local");
            assert.equal(url.searchParams.get("q"), "rust dioxus");
            assert.equal(url.searchParams.get("count"), "3");
            json(response, {
                web: {
                    results: [
                        {
                            title: "Dioxus",
                            url: "https://dioxuslabs.com",
                            description: "Rust UI framework",
                        },
                    ],
                },
            });
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer({
            braveApiKey: "brave-test",
            braveSearchUrl: `http://127.0.0.1:${mockPort}/brave`,
        }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "rust dioxus", count: 3 }),
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(body, {
            success: true,
            data: {
                web: [
                    {
                        title: "Dioxus",
                        url: "https://dioxuslabs.com",
                        description: "Rust UI framework",
                        position: 1,
                    },
                ],
            },
        });
    });

    it("normalizes Tavily search results", async () => {
        const mock = http.createServer((request, response) => {
            let raw = "";
            request.on("data", (chunk) => {
                raw += chunk;
            });
            request.on("end", () => {
                const payload = JSON.parse(raw);
                assert.equal(payload.api_key, "tvly-test");
                if (request.url === "/search") {
                    json(response, {
                        results: [
                            {
                                title: "Search Result",
                                url: "https://example.com/search",
                                content: "Snippet text",
                            },
                        ],
                    });
                    return;
                }
                response.writeHead(404);
                response.end();
            });
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer({
            tavilyApiKey: "tvly-test",
            tavilyBaseUrl: `http://127.0.0.1:${mockPort}`,
        }).server;
        const bridgePort = await listen(bridge);

        const search = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "agent search" }),
        });
        assert.deepEqual(await search.json(), {
            success: true,
            data: {
                web: [
                    {
                        title: "Search Result",
                        url: "https://example.com/search",
                        description: "Snippet text",
                        position: 1,
                    },
                ],
            },
        });
    });

    it("provider override selects DuckDuckGo even when a Brave key exists", async () => {
        const mock = http.createServer((request, response) => {
            assert.equal(request.method, "GET");
            const url = new URL(request.url, "http://mock.local");
            assert.equal(url.pathname, "/html/");
            assert.equal(url.searchParams.get("q"), "override search");
            response.writeHead(200, { "Content-Type": "text/html" });
            response.end(`
                <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fddg">DDG Result</a>
                <div class="result__snippet">Duck result.</div>
            `);
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer({
            braveApiKey: "brave-test",
            duckDuckGoSearchUrl: `http://127.0.0.1:${mockPort}/html/`,
        }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: "duckduckgo",
                query: "override search",
                count: 1,
            }),
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data.web[0].url, "https://example.com/ddg");
    });

    it("provider override uses request-level SearXNG URL", async () => {
        const mock = http.createServer((request, response) => {
            assert.equal(request.method, "GET");
            const url = new URL(request.url, "http://mock.local");
            assert.equal(url.pathname, "/search");
            assert.equal(url.searchParams.get("q"), "request searxng");
            json(response, {
                results: [
                    {
                        title: "Request SearXNG",
                        url: "https://example.com/request-searxng",
                        content: "Request URL snippet",
                    },
                ],
            });
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer({
            braveApiKey: "",
            tavilyApiKey: "",
            searxngBaseUrl: "",
        }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: "searxng",
                searxng_url: `http://127.0.0.1:${mockPort}`,
                query: "request searxng",
            }),
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data.web[0].title, "Request SearXNG");
    });

    it("request Brave key overrides bridge env for that request", async () => {
        const mock = http.createServer((request, response) => {
            assert.equal(request.headers["x-subscription-token"], "request-brave-key");
            json(response, {
                web: {
                    results: [
                        {
                            title: "Request Brave",
                            url: "https://example.com/request-brave",
                            description: "Request key result",
                        },
                    ],
                },
            });
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer({
            braveApiKey: "bridge-brave-key",
            braveSearchUrl: `http://127.0.0.1:${mockPort}/brave`,
        }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: "brave",
                brave_api_key: "request-brave-key",
                query: "request brave",
            }),
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.data.web[0].title, "Request Brave");
    });

    it("selected provider without required key returns a clear error", async () => {
        const bridge = createBridgeServer({
            braveApiKey: "",
            tavilyApiKey: "",
            searxngBaseUrl: "",
        }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "tavily", query: "needs key" }),
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.match(body.error, /Tavily selected/);
    });

    it("normalizes SearXNG web search results", async () => {
        const mock = http.createServer((request, response) => {
            assert.equal(request.method, "GET");
            const url = new URL(request.url, "http://mock.local");
            assert.equal(url.pathname, "/search");
            assert.equal(url.searchParams.get("q"), "free agent search");
            assert.equal(url.searchParams.get("format"), "json");
            assert.equal(url.searchParams.get("language"), "en");
            assert.equal(url.searchParams.get("time_range"), "month");
            json(response, {
                results: [
                    {
                        title: "SearXNG Result",
                        url: "https://example.com/searxng",
                        content: "Metasearch snippet",
                    },
                ],
            });
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer({
            braveApiKey: "",
            tavilyApiKey: "",
            searxngBaseUrl: `http://127.0.0.1:${mockPort}`,
        }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: "free agent search",
                language: "en",
                freshness: "week",
            }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            success: true,
            data: {
                web: [
                    {
                        title: "SearXNG Result",
                        url: "https://example.com/searxng",
                        description: "Metasearch snippet",
                        position: 1,
                    },
                ],
            },
        });
    });

    it("falls back to key-free DuckDuckGo-style HTML search", async () => {
        const mock = http.createServer((request, response) => {
            assert.equal(request.method, "GET");
            const url = new URL(request.url, "http://mock.local");
            assert.equal(url.searchParams.get("q"), "agent loop");
            response.writeHead(200, { "Content-Type": "text/html" });
            response.end(`
                <html>
                  <body>
                    <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fagent">Agent &amp; Loop</a>
                    <div class="result__snippet">A key-free search result.</div>
                  </body>
                </html>
            `);
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer({
            braveApiKey: "",
            tavilyApiKey: "",
            searxngBaseUrl: "",
            duckDuckGoSearchUrl: `http://127.0.0.1:${mockPort}/html/`,
        }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "agent loop", count: 1 }),
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            success: true,
            data: {
                web: [
                    {
                        title: "Agent & Loop",
                        url: "https://example.com/agent",
                        description: "A key-free search result.",
                        position: 1,
                    },
                ],
            },
        });
    });

    it("answers CORS and private-network preflight requests", async () => {
        const bridge = createBridgeServer().server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_search`, {
            method: "OPTIONS",
            headers: {
                Origin: "https://kaush4l.github.io",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
        });

        assert.equal(response.status, 204);
        assert.equal(response.headers.get("access-control-allow-origin"), "https://kaush4l.github.io");
        assert.equal(response.headers.get("access-control-allow-private-network"), "true");
    });

    it("web_fetch returns cleaned text and the page title", async () => {
        const mock = http.createServer((request, response) => {
            response.writeHead(200, { "Content-Type": "text/html" });
            response.end(
                "<html><head><title>Doc Title</title></head><body><h1>Heading</h1><p>Body &amp; text.</p><script>ignore()</script></body></html>",
            );
        });
        const mockPort = await listen(mock);

        const bridge = createBridgeServer().server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_fetch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: `http://127.0.0.1:${mockPort}/doc` }),
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.data.title, "Doc Title");
        assert.match(body.data.text, /Heading/);
        assert.match(body.data.text, /Body & text\./);
        assert.doesNotMatch(body.data.text, /ignore\(\)/);
    });

    it("run_command is disabled unless --allow-exec is set", async () => {
        const bridge = createBridgeServer().server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/run_command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: "echo hi" }),
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.match(body.error, /--allow-exec/);
    });

    it("run_command executes allowed commands in the run root when enabled", async () => {
        const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-run-"));
        const bridge = createBridgeServer({ runRoot, allowExec: true }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/run_command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: "echo askk-ok" }),
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.data.ok, true);
        assert.equal(body.data.exit_code, 0);
        assert.match(body.data.stdout, /askk-ok/);
    });

    it("run_command blocks binaries outside the allow list", async () => {
        const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-run-"));
        const bridge = createBridgeServer({ runRoot, allowExec: true }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/run_command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: "curl https://example.com" }),
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.match(body.error, /not in the allowed binary list/);
    });

    it("fs_write, fs_read, and fs_list round-trip inside the run root", async () => {
        const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-run-"));
        const bridge = createBridgeServer({ runRoot }).server;
        const bridgePort = await listen(bridge);
        const base = `http://127.0.0.1:${bridgePort}/askk/tools`;

        const write = await fetch(`${base}/fs_write`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "src/index.ts", content: "console.log('hi')\n" }),
        });
        assert.equal((await write.json()).success, true);

        const read = await fetch(`${base}/fs_read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "src/index.ts" }),
        });
        assert.equal((await read.json()).data.content, "console.log('hi')\n");

        const list = await fetch(`${base}/fs_list`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const listed = await list.json();
        assert.equal(listed.success, true);
        assert.ok(listed.data.files.some((file) => file.path === "src/index.ts" && file.dir === false));
        assert.ok(listed.data.files.some((file) => file.path === "src" && file.dir === true));
    });

    it("fs tools refuse paths that escape the run root", async () => {
        const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-run-"));
        const bridge = createBridgeServer({ runRoot }).server;
        const bridgePort = await listen(bridge);

        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/fs_write`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "../escape.txt", content: "no" }),
        });
        const body = await response.json();
        assert.equal(body.success, false);
        assert.match(body.error, /escape/i);
    });

    it("reads workspace soul, agent, and skill Markdown files", async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-files-"));
        await fs.mkdir(path.join(workspaceRoot, "agents"), { recursive: true });
        await fs.mkdir(path.join(workspaceRoot, "skills", "research"), { recursive: true });
        await fs.writeFile(path.join(workspaceRoot, "soul.md"), "Shared soul", "utf8");
        await fs.writeFile(path.join(workspaceRoot, "agents", "planner.md"), "Planner body", "utf8");
        await fs.writeFile(
            path.join(workspaceRoot, "skills", "research", "SKILL.md"),
            "Research body",
            "utf8",
        );

        const direct = await readWorkspacePromptFiles(workspaceRoot);
        assert.equal(direct.success, true);
        assert.equal(direct.data.soul.content, "Shared soul");
        assert.deepEqual(direct.data.agents.map((file) => file.path), ["agents/planner.md"]);
        assert.deepEqual(direct.data.skills.map((file) => file.path), ["skills/research/SKILL.md"]);

        const bridge = createBridgeServer({ workspaceRoot }).server;
        const bridgePort = await listen(bridge);
        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/files`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.data.soul.content, "Shared soul");
        assert.equal(body.data.agents[0].content, "Planner body");
        assert.equal(body.data.skills[0].content, "Research body");
    });

    it("writes soul and agent Markdown files under the workspace root", async () => {
        const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-files-"));
        const bridge = createBridgeServer({ workspaceRoot }).server;
        const bridgePort = await listen(bridge);

        const soulResponse = await fetch(`http://127.0.0.1:${bridgePort}/askk/files/soul`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "Updated soul" }),
        });
        assert.equal(soulResponse.status, 200);
        assert.equal(await fs.readFile(path.join(workspaceRoot, "soul.md"), "utf8"), "Updated soul");

        const agentResponse = await fetch(`http://127.0.0.1:${bridgePort}/askk/files/agents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                agents: [{ path: "agents/builder.md", content: "Builder body" }],
            }),
        });
        assert.equal(agentResponse.status, 200);
        assert.equal(
            await fs.readFile(path.join(workspaceRoot, "agents", "builder.md"), "utf8"),
            "Builder body",
        );
    });
});

// A tiny newline-delimited JSON-RPC stdio MCP server used to exercise the relay.
// It answers initialize / tools/list / tools/call and echoes call arguments.
const STUB_MCP_SERVER = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\\n");
    while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) {
            handle(JSON.parse(line));
        }
        index = buffer.indexOf("\\n");
    }
});
function reply(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
function handle(message) {
    if (message.method === "initialize") {
        reply(message.id, {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "stub-mcp", version: "0.0.0" },
            capabilities: { tools: {} },
        });
        return;
    }
    if (message.method === "notifications/initialized") {
        return;
    }
    if (message.method === "tools/list") {
        reply(message.id, {
            tools: [{ name: "echo", description: "Echoes its arguments." }],
        });
        return;
    }
    if (message.method === "tools/call") {
        reply(message.id, {
            content: [{ type: "text", text: JSON.stringify(message.params?.arguments ?? {}) }],
        });
        return;
    }
    if (message.id != null) {
        process.stdout.write(
            JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                error: { code: -32601, message: "Method not found" },
            }) + "\\n",
        );
    }
}
`;

describe("ASKK local bridge MCP relay", () => {
    async function startMcpBridge() {
        const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-mcp-"));
        const bridge = createBridgeServer({ runRoot, allowExec: true }).server;
        const bridgePort = await listen(bridge);
        return { base: `http://127.0.0.1:${bridgePort}/askk/mcp`, runRoot };
    }

    function mcpPost(base, action, payload) {
        return fetch(`${base}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    }

    it("relays spawn, initialize, tools/list, and tools/call over stdio", async () => {
        const { base } = await startMcpBridge();
        const id = "stub-mcp";

        const spawnResponse = await mcpPost(base, "spawn", {
            id,
            command: "node",
            args: ["-e", STUB_MCP_SERVER],
        });
        assert.equal(spawnResponse.status, 200);
        assert.deepEqual(await spawnResponse.json(), { success: true, data: { id } });

        const initResponse = await mcpPost(base, "send", {
            id,
            message: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        });
        const init = await initResponse.json();
        assert.equal(initResponse.status, 200);
        assert.equal(init.success, true);
        assert.equal(init.data.id, 1);
        assert.equal(init.data.result.protocolVersion, "2024-11-05");

        const listResponse = await mcpPost(base, "send", {
            id,
            message: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        });
        const list = await listResponse.json();
        assert.equal(list.success, true);
        assert.equal(list.data.id, 2);
        assert.deepEqual(list.data.result.tools.map((tool) => tool.name), ["echo"]);

        const callResponse = await mcpPost(base, "send", {
            id,
            message: {
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: { name: "echo", arguments: { value: "askk" } },
            },
        });
        const call = await callResponse.json();
        assert.equal(call.success, true);
        assert.equal(call.data.id, 3);
        assert.deepEqual(JSON.parse(call.data.result.content[0].text), { value: "askk" });

        const killResponse = await mcpPost(base, "kill", { id });
        assert.equal(killResponse.status, 200);
        assert.deepEqual(await killResponse.json(), { success: true });
    });

    it("accepts notifications (no id) without awaiting a response", async () => {
        const { base } = await startMcpBridge();
        const id = "stub-notify";

        await mcpPost(base, "spawn", { id, command: "node", args: ["-e", STUB_MCP_SERVER] });

        const notifyResponse = await mcpPost(base, "send", {
            id,
            message: { jsonrpc: "2.0", method: "notifications/initialized" },
        });
        assert.equal(notifyResponse.status, 200);
        assert.deepEqual(await notifyResponse.json(), { success: true, data: null });

        await mcpPost(base, "kill", { id });
    });

    it("re-spawning the same id replaces the previous child", async () => {
        const { base } = await startMcpBridge();
        const id = "stub-respawn";

        await mcpPost(base, "spawn", { id, command: "node", args: ["-e", STUB_MCP_SERVER] });
        const respawn = await mcpPost(base, "spawn", {
            id,
            command: "node",
            args: ["-e", STUB_MCP_SERVER],
        });
        assert.equal(respawn.status, 200);
        assert.deepEqual(await respawn.json(), { success: true, data: { id } });

        const initResponse = await mcpPost(base, "send", {
            id,
            message: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        });
        assert.equal((await initResponse.json()).success, true);

        await mcpPost(base, "kill", { id });
    });

    it("send to an unknown id returns an error envelope", async () => {
        const { base } = await startMcpBridge();
        const response = await mcpPost(base, "send", {
            id: "missing",
            message: { jsonrpc: "2.0", id: 1, method: "initialize" },
        });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.match(body.error, /no live MCP server/);
    });

    it("send returns a timeout envelope when the server never replies", async () => {
        const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-mcp-"));
        const bridge = createBridgeServer({ runRoot, allowExec: true, execTimeoutMs: 1_000 }).server;
        const bridgePort = await listen(bridge);
        const base = `http://127.0.0.1:${bridgePort}/askk/mcp`;
        const id = "stub-silent";

        // A server that reads stdin but never writes a response.
        await fetch(`${base}/spawn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id,
                command: "node",
                args: ["-e", "process.stdin.resume()"],
            }),
        });

        const response = await fetch(`${base}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id,
                message: { jsonrpc: "2.0", id: 1, method: "initialize" },
            }),
        });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.match(body.error, /timed out/);

        await fetch(`${base}/kill`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
        });
    });

    it("spawn is rejected when allowExec is false", async () => {
        const bridge = createBridgeServer().server;
        const bridgePort = await listen(bridge);
        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/mcp/spawn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "blocked", command: "node", args: ["-e", "0"] }),
        });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.match(body.error, /--allow-exec/);
    });

    it("spawn is rejected when the command binary is not allow-listed", async () => {
        const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "askk-mcp-"));
        const bridge = createBridgeServer({ runRoot, allowExec: true }).server;
        const bridgePort = await listen(bridge);
        const response = await fetch(`http://127.0.0.1:${bridgePort}/askk/mcp/spawn`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "blocked", command: "curl", args: ["https://example.com"] }),
        });
        const body = await response.json();
        assert.equal(response.status, 400);
        assert.equal(body.success, false);
        assert.match(body.error, /not in the allowed binary list/);
    });
});

function json(response, payload) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
}

function listen(server) {
    servers.push(server);
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            resolve(server.address().port);
        });
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}
