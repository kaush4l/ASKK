import http from "node:http";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBridgeServer } from "./askk-local-bridge.mjs";

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

    it("normalizes Tavily search and extract results", async () => {
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
                if (request.url === "/extract") {
                    assert.deepEqual(payload.urls, ["https://example.com/search"]);
                    json(response, {
                        results: [
                            {
                                title: "Extracted Page",
                                url: "https://example.com/search",
                                raw_content: "Full page text",
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

        const extract = await fetch(`http://127.0.0.1:${bridgePort}/askk/tools/web_extract`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: ["https://example.com/search"] }),
        });
        assert.deepEqual(await extract.json(), {
            success: true,
            data: [
                {
                    url: "https://example.com/search",
                    title: "Extracted Page",
                    content: "Full page text",
                    raw_content: "Full page text",
                    metadata: {
                        sourceURL: "https://example.com/search",
                        title: "Extracted Page",
                    },
                },
            ],
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
