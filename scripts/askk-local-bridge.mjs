#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TARGET = "http://127.0.0.1:8873/v1";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8874;
const DEFAULT_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";

export function createBridgeServer(rawOptions = {}) {
    const targetBase = normalizeBaseUrl(
        rawOptions.target ?? process.env.ASKK_BRIDGE_TARGET ?? DEFAULT_TARGET,
    );
    const listenBasePath = normalizePath(rawOptions.basePath ?? targetBase.pathname);
    const toolsPath = normalizePath(rawOptions.toolsPath ?? "/askk/tools");
    const filesPath = normalizePath(rawOptions.filesPath ?? "/askk/files");
    const workspaceRoot = path.resolve(
        rawOptions.workspaceRoot ?? process.env.ASKK_WORKSPACE_ROOT ?? process.cwd(),
    );
    const searchConfig = {
        braveApiKey:
            rawOptions.braveApiKey ??
            process.env.BRAVE_API_KEY ??
            process.env.BRAVE_SEARCH_API_KEY ??
            "",
        braveSearchUrl:
            rawOptions.braveSearchUrl ??
            process.env.ASKK_BRAVE_SEARCH_URL ??
            DEFAULT_BRAVE_SEARCH_URL,
        tavilyApiKey: rawOptions.tavilyApiKey ?? process.env.TAVILY_API_KEY ?? "",
        tavilyBaseUrl:
            rawOptions.tavilyBaseUrl ??
            process.env.ASKK_TAVILY_BASE_URL ??
            DEFAULT_TAVILY_BASE_URL,
    };

    const server = http.createServer(async (request, response) => {
        setCorsHeaders(request, response);

        if (request.method === "OPTIONS") {
            response.writeHead(204);
            response.end();
            return;
        }

        try {
            const incoming = new URL(request.url ?? "/", "http://bridge.local");
            if (incoming.pathname === filesPath || incoming.pathname.startsWith(`${filesPath}/`)) {
                await handleWorkspaceFileRequest(request, response, filesPath, workspaceRoot);
                return;
            }
            if (incoming.pathname.startsWith(`${toolsPath}/`)) {
                await handleToolRequest(request, response, toolsPath, searchConfig);
                return;
            }

            await proxyProviderRequest(request, response, targetBase, listenBasePath);
        } catch (error) {
            writeJson(response, 502, {
                error: "ASKK local bridge request failed.",
                target: targetBase.toString(),
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    });

    return { server, targetBase, listenBasePath, workspaceRoot };
}

export function startBridge(rawOptions = {}) {
    const host = rawOptions.host ?? process.env.ASKK_BRIDGE_HOST ?? DEFAULT_HOST;
    const port = Number(rawOptions.port ?? process.env.ASKK_BRIDGE_PORT ?? DEFAULT_PORT);
    const bridge = createBridgeServer(rawOptions);
    bridge.server.listen(port, host, () => {
        console.log(`ASKK local bridge listening at http://${host}:${port}${bridge.listenBasePath}`);
        console.log(`Forwarding model calls to ${bridge.targetBase.toString()}`);
        console.log("Use this ASKK Provider Base URL:");
        console.log(`http://${host}:${port}${bridge.listenBasePath}`);
        console.log(`Workspace Markdown root: ${bridge.workspaceRoot}`);
        console.log(`Workspace file endpoint: http://${host}:${port}/askk/files`);
        console.log("Web tool endpoints:");
        console.log(`http://${host}:${port}/askk/tools/web_search`);
        console.log(`http://${host}:${port}/askk/tools/web_extract`);
    });
    return bridge.server;
}

async function proxyProviderRequest(request, response, targetBase, listenBasePath) {
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
}

async function handleToolRequest(request, response, toolsPath, config) {
    if (request.method !== "POST") {
        writeJson(response, 405, { success: false, error: "Tool endpoints require POST." });
        return;
    }

    const incoming = new URL(request.url ?? "/", "http://bridge.local");
    const toolName = incoming.pathname.slice(`${toolsPath}/`.length);
    const body = await readJsonBody(request);

    if (toolName === "web_search") {
        const result = await webSearch(body, config);
        writeJson(response, result.success === false ? 400 : 200, result);
        return;
    }

    if (toolName === "web_extract") {
        const result = await webExtract(body, config);
        writeJson(response, result.success === false ? 400 : 200, result);
        return;
    }

    writeJson(response, 404, { success: false, error: `Unknown ASKK tool: ${toolName}` });
}

async function handleWorkspaceFileRequest(request, response, filesPath, workspaceRoot) {
    const incoming = new URL(request.url ?? "/", "http://bridge.local");
    const action = incoming.pathname.slice(filesPath.length).replace(/^\/+/, "");

    if (request.method === "GET" && action === "") {
        writeJson(response, 200, await readWorkspacePromptFiles(workspaceRoot));
        return;
    }

    if (request.method === "POST" && action === "soul") {
        const body = await readJsonBody(request);
        await writeWorkspaceFile(workspaceRoot, "soul.md", optionalString(body, "content"));
        writeJson(response, 200, { success: true, message: "Updated soul.md." });
        return;
    }

    if (request.method === "POST" && action === "agents") {
        const body = await readJsonBody(request);
        const agents = Array.isArray(body.agents) ? body.agents : [];
        let count = 0;
        for (const file of agents) {
            const relativePath = typeof file.path === "string" && file.path.trim()
                ? file.path.trim()
                : `agents/agent-${count + 1}.md`;
            if (!relativePath.startsWith("agents/") || !relativePath.endsWith(".md")) {
                throw new Error(`Agent file path must stay under agents/ and end with .md: ${relativePath}`);
            }
            await writeWorkspaceFile(workspaceRoot, relativePath, optionalString(file, "content"));
            count += 1;
        }
        writeJson(response, 200, { success: true, message: `Updated ${count} agent file(s).` });
        return;
    }

    writeJson(response, 404, { success: false, error: `Unknown workspace file route: ${action}` });
}

export async function readWorkspacePromptFiles(workspaceRoot = process.cwd()) {
    const root = path.resolve(workspaceRoot);
    const soul = await readOptionalWorkspaceFile(root, "soul.md");
    const agents = await readMarkdownFiles(root, "agents", false);
    const skills = await readMarkdownFiles(root, "skills", true);
    return {
        success: true,
        data: {
            root,
            soul,
            agents,
            skills,
        },
    };
}

export async function webSearch(body, config = {}) {
    const query = requiredString(body, "query");
    const count = clampInt(body.count ?? body.limit ?? 5, 1, 10);
    const mergedConfig = mergeSearchConfig(config);

    if (mergedConfig.braveApiKey) {
        return braveSearch(body, query, count, mergedConfig);
    }
    if (mergedConfig.tavilyApiKey) {
        return tavilySearch(query, count, mergedConfig);
    }

    return {
        success: false,
        error:
            "No web search provider configured. Set BRAVE_API_KEY, BRAVE_SEARCH_API_KEY, or TAVILY_API_KEY before starting the ASKK local bridge.",
    };
}

export async function webExtract(body, config = {}) {
    const urls = arrayOfStrings(body, "urls").slice(0, 5);
    if (urls.length === 0) {
        return { success: false, error: "web_extract requires at least one URL." };
    }

    const mergedConfig = mergeSearchConfig(config);
    if (mergedConfig.tavilyApiKey) {
        return tavilyExtract(urls, mergedConfig);
    }

    const documents = [];
    for (const url of urls) {
        documents.push(await fetchExtract(url));
    }
    return { success: true, data: documents };
}

async function braveSearch(body, query, count, config) {
    const url = new URL(config.braveSearchUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    mapOptionalParam(body, url, "country", "country");
    mapOptionalParam(body, url, "language", "search_lang");
    mapOptionalParam(body, url, "ui_lang", "ui_lang");
    mapOptionalParam(body, url, "freshness", "freshness");
    mapOptionalParam(body, url, "date_after", "date_after");
    mapOptionalParam(body, url, "date_before", "date_before");

    const response = await fetch(url, {
        headers: {
            Accept: "application/json",
            "X-Subscription-Token": config.braveApiKey,
        },
    });
    const raw = await readJsonResponse(response);
    if (!response.ok) {
        return providerError("Brave Search", response.status, raw);
    }
    return normalizeBraveSearch(raw);
}

async function tavilySearch(query, count, config) {
    const raw = await tavilyRequest(
        "search",
        {
            query,
            max_results: Math.min(count, 20),
            include_raw_content: false,
            include_images: false,
        },
        config,
    );
    if (raw.success === false) {
        return raw;
    }
    return normalizeTavilySearch(raw);
}

async function tavilyExtract(urls, config) {
    const raw = await tavilyRequest(
        "extract",
        {
            urls,
            include_images: false,
            extract_depth: "basic",
        },
        config,
    );
    if (raw.success === false) {
        return raw;
    }
    return { success: true, data: normalizeTavilyDocuments(raw) };
}

async function tavilyRequest(endpoint, payload, config) {
    const url = new URL(`/${endpoint.replace(/^\/+/, "")}`, config.tavilyBaseUrl);
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...payload, api_key: config.tavilyApiKey }),
    });
    const raw = await readJsonResponse(response);
    if (!response.ok) {
        return providerError("Tavily", response.status, raw);
    }
    return raw;
}

async function fetchExtract(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("Only http:// and https:// URLs are supported.");
        }
        const response = await fetch(parsed, { headers: { Accept: "text/html,text/plain,*/*" } });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
        }
        const title = extractTitle(text);
        const content = htmlToText(text).slice(0, 20_000);
        return {
            url: parsed.toString(),
            title,
            content,
            raw_content: content,
            metadata: { sourceURL: parsed.toString(), title },
        };
    } catch (error) {
        return {
            url,
            title: "",
            content: "",
            raw_content: "",
            error: error instanceof Error ? error.message : String(error),
            metadata: { sourceURL: url },
        };
    }
}

export function normalizeBraveSearch(raw) {
    const results = raw?.web?.results ?? raw?.results ?? [];
    return {
        success: true,
        data: {
            web: results.map((result, index) => ({
                title: result.title ?? "",
                url: result.url ?? "",
                description: result.description ?? result.snippet ?? "",
                position: index + 1,
            })),
        },
    };
}

export function normalizeTavilySearch(raw) {
    return {
        success: true,
        data: {
            web: (raw.results ?? []).map((result, index) => ({
                title: result.title ?? "",
                url: result.url ?? "",
                description: result.content ?? "",
                position: index + 1,
            })),
        },
    };
}

export function normalizeTavilyDocuments(raw, fallbackUrl = "") {
    const documents = [];
    for (const result of raw.results ?? []) {
        const url = result.url ?? fallbackUrl;
        const rawContent = result.raw_content ?? result.content ?? "";
        documents.push({
            url,
            title: result.title ?? "",
            content: rawContent,
            raw_content: rawContent,
            metadata: { sourceURL: url, title: result.title ?? "" },
        });
    }
    for (const failed of raw.failed_results ?? []) {
        documents.push({
            url: failed.url ?? fallbackUrl,
            title: "",
            content: "",
            raw_content: "",
            error: failed.error ?? "extraction failed",
            metadata: { sourceURL: failed.url ?? fallbackUrl },
        });
    }
    for (const failedUrl of raw.failed_urls ?? []) {
        const url = String(failedUrl);
        documents.push({
            url,
            title: "",
            content: "",
            raw_content: "",
            error: "extraction failed",
            metadata: { sourceURL: url },
        });
    }
    return documents;
}

async function readOptionalWorkspaceFile(workspaceRoot, relativePath) {
    try {
        return {
            path: relativePath,
            content: await fs.readFile(workspacePath(workspaceRoot, relativePath), "utf8"),
        };
    } catch (error) {
        if (error?.code === "ENOENT") {
            return { path: relativePath, content: "" };
        }
        throw error;
    }
}

async function readMarkdownFiles(workspaceRoot, relativeDir, recursive) {
    const directory = workspacePath(workspaceRoot, relativeDir);
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error?.code === "ENOENT") {
            return [];
        }
        throw error;
    }

    const files = [];
    for (const entry of entries) {
        const relativePath = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory() && recursive) {
            const nested = await readMarkdownFiles(workspaceRoot, relativePath, true);
            files.push(...nested);
            continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
            continue;
        }
        files.push({
            path: relativePath,
            content: await fs.readFile(workspacePath(workspaceRoot, relativePath), "utf8"),
        });
    }

    return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function writeWorkspaceFile(workspaceRoot, relativePath, content) {
    const destination = workspacePath(workspaceRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, "utf8");
}

function workspacePath(workspaceRoot, relativePath) {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const root = path.resolve(workspaceRoot);
    const resolved = path.resolve(root, normalized);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Workspace path escapes root: ${relativePath}`);
    }
    return resolved;
}

function normalizeWorkspaceRelativePath(relativePath) {
    const normalized = String(relativePath ?? "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
    if (!normalized || normalized.split("/").some((part) => part === "..")) {
        throw new Error(`Invalid workspace relative path: ${relativePath}`);
    }
    return normalized;
}

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
  --workspace-root  Root containing soul.md, agents/, and skills/. Default: current directory

Web tool environment:
  BRAVE_API_KEY or BRAVE_SEARCH_API_KEY
  TAVILY_API_KEY
  ASKK_BRAVE_SEARCH_URL and ASKK_TAVILY_BASE_URL for local/mock providers

Bridge environment:
  ASKK_BRIDGE_TARGET, ASKK_BRIDGE_HOST, ASKK_BRIDGE_PORT, ASKK_WORKSPACE_ROOT`);
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

async function readJsonBody(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.trim()) {
        return {};
    }
    return JSON.parse(raw);
}

async function readJsonResponse(response) {
    const text = await response.text();
    if (!text.trim()) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch {
        return { text };
    }
}

function writeJson(response, status, payload) {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload, null, 2));
}

function providerError(provider, status, raw) {
    return {
        success: false,
        error: `${provider} returned HTTP ${status}: ${JSON.stringify(raw)}`,
    };
}

function requiredString(body, key) {
    const value = body?.[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Missing required string field: ${key}`);
    }
    return value.trim();
}

function optionalString(body, key) {
    const value = body?.[key];
    if (typeof value !== "string") {
        return "";
    }
    return value;
}

function arrayOfStrings(body, key) {
    const value = body?.[key];
    if (!Array.isArray(value)) {
        throw new Error(`Missing required array field: ${key}`);
    }
    return value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
}

function clampInt(value, min, max) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) {
        return min;
    }
    return Math.max(min, Math.min(max, parsed));
}

function mapOptionalParam(body, url, source, target) {
    const value = body?.[source];
    if (typeof value === "string" && value.trim()) {
        url.searchParams.set(target, value.trim());
    }
}

function mergeSearchConfig(config) {
    return {
        braveApiKey: config.braveApiKey ?? process.env.BRAVE_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY ?? "",
        braveSearchUrl: config.braveSearchUrl ?? process.env.ASKK_BRAVE_SEARCH_URL ?? DEFAULT_BRAVE_SEARCH_URL,
        tavilyApiKey: config.tavilyApiKey ?? process.env.TAVILY_API_KEY ?? "",
        tavilyBaseUrl: config.tavilyBaseUrl ?? process.env.ASKK_TAVILY_BASE_URL ?? DEFAULT_TAVILY_BASE_URL,
    };
}

function extractTitle(html) {
    return html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function htmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    startBridge(parseArgs(process.argv.slice(2)));
}
