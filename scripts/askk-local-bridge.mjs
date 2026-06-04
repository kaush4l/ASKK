#!/usr/bin/env node

import http from "node:http";

const DEFAULT_TARGET = "http://127.0.0.1:8873/v1";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8874;

const options = parseArgs(process.argv.slice(2));
const targetBase = normalizeBaseUrl(options.target ?? process.env.ASKK_BRIDGE_TARGET ?? DEFAULT_TARGET);
const host = options.host ?? process.env.ASKK_BRIDGE_HOST ?? DEFAULT_HOST;
const port = Number(options.port ?? process.env.ASKK_BRIDGE_PORT ?? DEFAULT_PORT);
const listenBasePath = normalizePath(options.basePath ?? targetBase.pathname);

const server = http.createServer(async (request, response) => {
    setCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }

    try {
        const upstream = buildUpstreamUrl(request.url ?? "/", targetBase, listenBasePath);
        const upstreamResponse = await fetch(upstream, {
            method: request.method,
            headers: forwardedHeaders(request),
            body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
            duplex: "half",
        });

        response.statusCode = upstreamResponse.status;
        upstreamResponse.headers.forEach((value, key) => {
            if (!isHopByHopHeader(key) && !key.toLowerCase().startsWith("access-control-")) {
                response.setHeader(key, value);
            }
        });
        setCorsHeaders(request, response);

        if (!upstreamResponse.body) {
            response.end();
            return;
        }

        for await (const chunk of upstreamResponse.body) {
            response.write(chunk);
        }
        response.end();
    } catch (error) {
        response.writeHead(502, { "Content-Type": "application/json" });
        response.end(
            JSON.stringify(
                {
                    error: "ASKK local bridge could not reach upstream provider.",
                    target: targetBase.toString(),
                    detail: error instanceof Error ? error.message : String(error),
                },
                null,
                2,
            ),
        );
    }
});

server.listen(port, host, () => {
    console.log(`ASKK local bridge listening at http://${host}:${port}${listenBasePath}`);
    console.log(`Forwarding to ${targetBase.toString()}`);
    console.log("Use this ASKK Provider Base URL:");
    console.log(`http://${host}:${port}${listenBasePath}`);
});

function parseArgs(args) {
    const parsed = {};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
        if (!arg.startsWith("--")) {
            throw new Error(`Unexpected argument: ${arg}`);
        }
        const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
        const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const value = inlineValue ?? args[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for ${arg}`);
        }
        parsed[key] = value;
        if (inlineValue === undefined) {
            index += 1;
        }
    }
    return parsed;
}

function printHelp() {
    console.log(`Usage:
  node scripts/askk-local-bridge.mjs --target http://192.168.11.154:8873/v1 --port 8874

Options:
  --target      Upstream OpenAI-compatible provider base URL. Default: ${DEFAULT_TARGET}
  --host        Local host to bind. Default: ${DEFAULT_HOST}
  --port        Local port to bind. Default: ${DEFAULT_PORT}
  --base-path   Path exposed by the bridge. Default: target URL path

Environment:
  ASKK_BRIDGE_TARGET, ASKK_BRIDGE_HOST, ASKK_BRIDGE_PORT`);
}

function normalizeBaseUrl(raw) {
    const value = raw.trim().replace(/\/+$/, "");
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Bridge target must use http:// or https://");
    }
    return url;
}

function normalizePath(path) {
    if (!path || path === "/") {
        return "";
    }
    return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

function buildUpstreamUrl(rawRequestUrl, base, basePath) {
    const incoming = new URL(rawRequestUrl, "http://bridge.local");
    const incomingPath = incoming.pathname;
    const suffix = basePath && incomingPath.startsWith(`${basePath}/`)
        ? incomingPath.slice(basePath.length)
        : incomingPath === basePath
            ? ""
            : incomingPath;
    const target = new URL(base.toString());
    target.pathname = `${target.pathname.replace(/\/+$/g, "")}${suffix}`;
    target.search = incoming.search;
    return target;
}

function forwardedHeaders(request) {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
        if (!value || isHopByHopHeader(key) || key.toLowerCase() === "host") {
            continue;
        }
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    return headers;
}

function setCorsHeaders(request, response) {
    const origin = request.headers.origin ?? "*";
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Access-Control-Max-Age", "86400");
    response.setHeader("Vary", "Origin, Access-Control-Request-Private-Network");
}

function isHopByHopHeader(name) {
    return [
        "connection",
        "content-length",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ].includes(name.toLowerCase());
}
