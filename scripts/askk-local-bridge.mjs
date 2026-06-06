#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_TARGET = "http://127.0.0.1:8873/v1";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8874;
const DEFAULT_BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";
const DEFAULT_DUCKDUCKGO_SEARCH_URL = "https://html.duckduckgo.com/html/";
const DEFAULT_RUN_ROOT_DIRNAME = ".askk-workspace";
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const MAX_EXEC_OUTPUT_CHARS = 60_000;
const MAX_FETCH_CHARS = 24_000;
// Commands the agent and Workspace page may run when execution is enabled. The
// first whitespace token of a command must be on this list. This is a guardrail,
// not a sandbox: enabling execution runs real processes on the bridge machine.
const ALLOWED_EXEC_BINARIES = new Set([
    "bun",
    "bunx",
    "node",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "deno",
    "tsc",
    "vitest",
    "jest",
    "eslint",
    "prettier",
    "ls",
    "cat",
    "echo",
    "pwd",
    "mkdir",
    "rm",
    "mv",
    "cp",
    "touch",
    "git",
    "grep",
    "find",
    "sed",
    "head",
    "tail",
    "wc",
    "true",
    "false",
]);

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
        searxngBaseUrl:
            rawOptions.searxngBaseUrl ??
            process.env.SEARXNG_URL ??
            process.env.SEARXNG_BASE_URL ??
            process.env.ASKK_SEARXNG_URL ??
            "",
        duckDuckGoSearchUrl:
            rawOptions.duckDuckGoSearchUrl ??
            process.env.ASKK_DUCKDUCKGO_SEARCH_URL ??
            DEFAULT_DUCKDUCKGO_SEARCH_URL,
    };
    const runRoot = path.resolve(
        rawOptions.runRoot ??
            process.env.ASKK_RUN_ROOT ??
            path.join(workspaceRoot, DEFAULT_RUN_ROOT_DIRNAME),
    );
    const execConfig = {
        runRoot,
        allowExec: toBool(rawOptions.allowExec ?? process.env.ASKK_ALLOW_EXEC ?? false),
        execTimeoutMs: clampInt(
            rawOptions.execTimeoutMs ?? process.env.ASKK_EXEC_TIMEOUT_MS ?? DEFAULT_EXEC_TIMEOUT_MS,
            1_000,
            600_000,
        ),
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
                await handleToolRequest(request, response, toolsPath, searchConfig, execConfig);
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

    return { server, targetBase, listenBasePath, workspaceRoot, runRoot, execConfig };
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
        console.log(`Project run root (disk fs + command exec): ${bridge.runRoot}`);
        console.log(
            bridge.execConfig.allowExec
                ? `Command execution ENABLED (timeout ${bridge.execConfig.execTimeoutMs}ms). The agent can run bun/node/etc. inside the run root.`
                : "Command execution DISABLED. Pass --allow-exec (or ASKK_ALLOW_EXEC=1) to let the agent run bun/node projects.",
        );
        console.log("Agent tool endpoints:");
        console.log(`http://${host}:${port}/askk/tools/web_search`);
        console.log(`http://${host}:${port}/askk/tools/web_fetch`);
        console.log(`http://${host}:${port}/askk/tools/run_command`);
        console.log(`http://${host}:${port}/askk/tools/fs_read | fs_write | fs_list`);
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

async function handleToolRequest(request, response, toolsPath, config, execConfig) {
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
    if (toolName === "web_fetch") {
        const result = await webFetch(body);
        writeJson(response, result.success === false ? 400 : 200, result);
        return;
    }
    if (toolName === "run_command") {
        const result = await runCommand(body, execConfig);
        writeJson(response, result.success === false ? 400 : 200, result);
        return;
    }
    if (toolName === "fs_read") {
        const result = await fsRead(body, execConfig);
        writeJson(response, result.success === false ? 400 : 200, result);
        return;
    }
    if (toolName === "fs_write") {
        const result = await fsWrite(body, execConfig);
        writeJson(response, result.success === false ? 400 : 200, result);
        return;
    }
    if (toolName === "fs_list") {
        const result = await fsList(body, execConfig);
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
    const mergedConfig = mergeSearchConfig(config, body);
    const provider = normalizeSearchProvider(body?.provider ?? config.provider ?? "auto");

    if (provider === "duckduckgo") {
        return duckDuckGoSearch(query, count, mergedConfig);
    }
    if (provider === "searxng") {
        if (!mergedConfig.searxngBaseUrl) {
            return missingProviderConfig("SearXNG", "searxng_url or SEARXNG_URL");
        }
        return searxngSearch(body, query, count, mergedConfig);
    }
    if (provider === "brave") {
        if (!mergedConfig.braveApiKey) {
            return missingProviderConfig("Brave Search", "brave_api_key, BRAVE_API_KEY, or BRAVE_SEARCH_API_KEY");
        }
        return braveSearch(body, query, count, mergedConfig);
    }
    if (provider === "tavily") {
        if (!mergedConfig.tavilyApiKey) {
            return missingProviderConfig("Tavily", "tavily_api_key or TAVILY_API_KEY");
        }
        return tavilySearch(query, count, mergedConfig);
    }

    if (provider !== "auto") {
        return { success: false, error: `Unknown web_search provider: ${provider}` };
    }
    if (mergedConfig.braveApiKey) {
        return braveSearch(body, query, count, mergedConfig);
    }
    if (mergedConfig.tavilyApiKey) {
        return tavilySearch(query, count, mergedConfig);
    }
    if (mergedConfig.searxngBaseUrl) {
        return searxngSearch(body, query, count, mergedConfig);
    }
    return duckDuckGoSearch(query, count, mergedConfig);
}

export async function webFetch(body) {
    const target = requiredString(body, "url");
    let url;
    try {
        url = new URL(target);
    } catch {
        return { success: false, error: `web_fetch requires an absolute http(s) URL: ${target}` };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { success: false, error: `web_fetch only supports http(s) URLs: ${target}` };
    }

    let response;
    try {
        response = await fetch(url, {
            redirect: "follow",
            headers: {
                Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
                "User-Agent": "ASKK research agent (+https://github.com/kaush4l/ASKK)",
            },
        });
    } catch (error) {
        return {
            success: false,
            error: `web_fetch could not reach ${url.toString()}: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    if (!response.ok) {
        return providerError("web_fetch", response.status, { text: raw.slice(0, 400) });
    }

    const isHtml = contentType.includes("html") || /^\s*<(?:!doctype|html)/i.test(raw);
    const title = isHtml ? extractTitle(raw) : "";
    const text = isHtml ? htmlToText(raw) : raw.trim();
    const truncated = text.length > MAX_FETCH_CHARS;

    return {
        success: true,
        data: {
            url: response.url || url.toString(),
            status: response.status,
            content_type: contentType,
            title,
            truncated,
            text: truncated ? `${text.slice(0, MAX_FETCH_CHARS)}\n…[truncated]` : text,
        },
    };
}

export async function runCommand(body, execConfig = {}) {
    if (!execConfig.allowExec) {
        return {
            success: false,
            error:
                "Command execution is disabled. Restart the ASKK local bridge with --allow-exec (or ASKK_ALLOW_EXEC=1) to let the agent run bun/node projects in the run root.",
        };
    }

    const command = requiredString(body, "command");
    const binary = command.trim().split(/\s+/, 1)[0] ?? "";
    if (!ALLOWED_EXEC_BINARIES.has(binary)) {
        return {
            success: false,
            error: `run_command blocked: '${binary}' is not in the allowed binary list. Allowed: ${[...ALLOWED_EXEC_BINARIES].join(", ")}.`,
        };
    }

    let cwd;
    try {
        cwd = runPath(execConfig.runRoot, optionalString(body, "cwd") || ".");
        await fs.mkdir(cwd, { recursive: true });
    } catch (error) {
        return { success: false, error: `run_command invalid cwd: ${error.message}` };
    }

    const timeoutMs = clampInt(body.timeout_ms ?? execConfig.execTimeoutMs, 1_000, 600_000);
    return await new Promise((resolve) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
            if (stdout.length > MAX_EXEC_OUTPUT_CHARS * 2) {
                stdout = stdout.slice(-MAX_EXEC_OUTPUT_CHARS * 2);
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
            if (stderr.length > MAX_EXEC_OUTPUT_CHARS * 2) {
                stderr = stderr.slice(-MAX_EXEC_OUTPUT_CHARS * 2);
            }
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({ success: false, error: `run_command failed to start '${binary}': ${error.message}` });
        });
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            const exitCode = code ?? (signal ? 1 : 0);
            resolve({
                success: true,
                data: {
                    command,
                    cwd: path.relative(execConfig.runRoot, cwd) || ".",
                    exit_code: exitCode,
                    ok: exitCode === 0 && !timedOut,
                    timed_out: timedOut,
                    stdout: clampText(stdout, MAX_EXEC_OUTPUT_CHARS),
                    stderr: clampText(stderr, MAX_EXEC_OUTPUT_CHARS),
                },
            });
        });
    });
}

export async function fsRead(body, execConfig = {}) {
    const relativePath = requiredString(body, "path");
    try {
        const target = runPath(execConfig.runRoot, relativePath);
        const content = await fs.readFile(target, "utf8");
        return {
            success: true,
            data: { path: relativePath, content: clampText(content, MAX_FETCH_CHARS * 4) },
        };
    } catch (error) {
        if (error?.code === "ENOENT") {
            return { success: false, error: `fs_read: file not found: ${relativePath}` };
        }
        return { success: false, error: `fs_read failed for ${relativePath}: ${error.message}` };
    }
}

export async function fsWrite(body, execConfig = {}) {
    const relativePath = requiredString(body, "path");
    const content = optionalString(body, "content");
    try {
        const target = runPath(execConfig.runRoot, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf8");
        return {
            success: true,
            data: { path: relativePath, bytes: Buffer.byteLength(content, "utf8") },
        };
    } catch (error) {
        return { success: false, error: `fs_write failed for ${relativePath}: ${error.message}` };
    }
}

export async function fsList(body, execConfig = {}) {
    const relativeDir = optionalString(body, "path") || ".";
    try {
        const target = runPath(execConfig.runRoot, relativeDir);
        await fs.mkdir(execConfig.runRoot, { recursive: true });
        const files = await listProjectTree(target, execConfig.runRoot);
        return { success: true, data: { root: relativeDir, files } };
    } catch (error) {
        if (error?.code === "ENOENT") {
            return { success: true, data: { root: relativeDir, files: [] } };
        }
        return { success: false, error: `fs_list failed for ${relativeDir}: ${error.message}` };
    }
}

const IGNORED_TREE_DIRS = new Set(["node_modules", ".git", ".cache", "dist", "target"]);

async function listProjectTree(directory, runRoot, depth = 0) {
    if (depth > 8) {
        return [];
    }
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
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".") && entry.name !== ".gitignore") {
            continue;
        }
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(runRoot, absolute).split(path.sep).join("/");
        if (entry.isDirectory()) {
            if (IGNORED_TREE_DIRS.has(entry.name)) {
                files.push({ path: relative, dir: true, truncated: true });
                continue;
            }
            files.push({ path: relative, dir: true });
            files.push(...(await listProjectTree(absolute, runRoot, depth + 1)));
        } else if (entry.isFile()) {
            files.push({ path: relative, dir: false });
        }
    }
    return files;
}

function runPath(runRoot, relativePath) {
    const root = path.resolve(runRoot);
    const normalized = String(relativePath ?? ".")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
    if (normalized.split("/").some((part) => part === "..")) {
        throw new Error(`path escapes run root: ${relativePath}`);
    }
    const resolved = path.resolve(root, normalized || ".");
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`path escapes run root: ${relativePath}`);
    }
    return resolved;
}

function clampText(value, max) {
    const text = String(value ?? "");
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max)}\n…[truncated]`;
}

function toBool(value) {
    if (typeof value === "boolean") {
        return value;
    }
    const normalized = String(value ?? "").trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
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

async function searxngSearch(body, query, count, config) {
    const url = new URL(config.searxngBaseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/g, "")}/search`;
    url.search = "";
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    mapOptionalParam(body, url, "language", "language");
    const timeRange = searxngTimeRange(body?.freshness);
    if (timeRange) {
        url.searchParams.set("time_range", timeRange);
    }

    const response = await fetch(url, {
        headers: { Accept: "application/json" },
    });
    const raw = await readJsonResponse(response);
    if (!response.ok) {
        return providerError("SearXNG", response.status, raw);
    }
    return normalizeSearxngSearch(raw, count);
}

async function duckDuckGoSearch(query, count, config) {
    const url = new URL(config.duckDuckGoSearchUrl);
    url.searchParams.set("q", query);
    const response = await fetch(url, {
        headers: {
            Accept: "text/html,application/xhtml+xml",
            "User-Agent": "ASKK local bridge (+https://github.com/kaush4l/ASKK)",
        },
    });
    const text = await response.text();
    if (!response.ok) {
        return providerError("DuckDuckGo", response.status, { text: text.slice(0, 500) });
    }
    return normalizeDuckDuckGoHtml(text, count);
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

export function normalizeSearxngSearch(raw, count = 10) {
    return {
        success: true,
        data: {
            web: (raw.results ?? []).slice(0, count).map((result, index) => ({
                title: result.title ?? "",
                url: result.url ?? "",
                description: result.content ?? result.snippet ?? result.description ?? "",
                position: index + 1,
            })),
        },
    };
}

export function normalizeDuckDuckGoHtml(html, count = 10) {
    const results = [];
    const anchorPattern = /<a\b([^>]*\bclass=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = anchorPattern.exec(html)) && results.length < count) {
        const href = attributeValue(match[1], "href");
        const title = htmlToText(match[2]);
        const trailingHtml = html.slice(anchorPattern.lastIndex, anchorPattern.lastIndex + 2_500);
        const snippetHtml =
            trailingHtml.match(/<(?:a|div)\b[^>]*\bclass=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] ??
            "";
        const url = normalizeSearchResultUrl(href);
        if (!title || !url) {
            continue;
        }
        results.push({
            title,
            url,
            description: htmlToText(snippetHtml),
            position: results.length + 1,
        });
    }

    return { success: true, data: { web: results } };
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

const BOOLEAN_FLAGS = new Set(["allowExec"]);

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
        if (BOOLEAN_FLAGS.has(key) && inlineValue === undefined) {
            parsed[key] = true;
            continue;
        }
        const value = inlineValue ?? args[index + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for ${arg}`);
        }
        parsed[key] = BOOLEAN_FLAGS.has(key) ? toBool(value) : value;
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
  --run-root    Disk directory the agent's fs_* tools and run_command operate in.
                Default: <workspace-root>/${DEFAULT_RUN_ROOT_DIRNAME}
  --allow-exec  Enable run_command so the agent can run bun/node/etc. in the run root.
                DANGER: this runs real processes on this machine. Default: disabled.
  --exec-timeout-ms  Per-command timeout in milliseconds. Default: ${DEFAULT_EXEC_TIMEOUT_MS}

Web tool environment:
  BRAVE_API_KEY or BRAVE_SEARCH_API_KEY
  TAVILY_API_KEY
  SEARXNG_URL, SEARXNG_BASE_URL, or ASKK_SEARXNG_URL for no-key SearXNG search
  ASKK_BRAVE_SEARCH_URL, ASKK_TAVILY_BASE_URL, and ASKK_DUCKDUCKGO_SEARCH_URL for local/mock providers
  Without provider keys or SearXNG, web_search falls back to key-free DuckDuckGo HTML search.

Bridge environment:
  ASKK_BRIDGE_TARGET, ASKK_BRIDGE_HOST, ASKK_BRIDGE_PORT, ASKK_WORKSPACE_ROOT
  ASKK_RUN_ROOT, ASKK_ALLOW_EXEC, ASKK_EXEC_TIMEOUT_MS`);
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

function mergeSearchConfig(config, body = {}) {
    return {
        braveApiKey:
            optionalString(body, "brave_api_key") ||
            optionalString(body, "braveApiKey") ||
            config.braveApiKey ||
            process.env.BRAVE_API_KEY ||
            process.env.BRAVE_SEARCH_API_KEY ||
            "",
        braveSearchUrl: config.braveSearchUrl ?? process.env.ASKK_BRAVE_SEARCH_URL ?? DEFAULT_BRAVE_SEARCH_URL,
        tavilyApiKey:
            optionalString(body, "tavily_api_key") ||
            optionalString(body, "tavilyApiKey") ||
            config.tavilyApiKey ||
            process.env.TAVILY_API_KEY ||
            "",
        tavilyBaseUrl: config.tavilyBaseUrl ?? process.env.ASKK_TAVILY_BASE_URL ?? DEFAULT_TAVILY_BASE_URL,
        searxngBaseUrl:
            optionalString(body, "searxng_url") ||
            optionalString(body, "searxngBaseUrl") ||
            config.searxngBaseUrl ||
            process.env.SEARXNG_URL ||
            process.env.SEARXNG_BASE_URL ||
            process.env.ASKK_SEARXNG_URL ||
            "",
        duckDuckGoSearchUrl:
            config.duckDuckGoSearchUrl ??
            process.env.ASKK_DUCKDUCKGO_SEARCH_URL ??
            DEFAULT_DUCKDUCKGO_SEARCH_URL,
    };
}

function normalizeSearchProvider(value) {
    const provider = String(value ?? "auto").trim().toLowerCase().replace(/[_\s-]+/g, "");
    if (provider === "ddg") {
        return "duckduckgo";
    }
    if (["auto", "duckduckgo", "searxng", "brave", "tavily"].includes(provider)) {
        return provider;
    }
    return provider || "auto";
}

function missingProviderConfig(provider, required) {
    return {
        success: false,
        error: `${provider} selected for web_search, but missing ${required}. Configure it on the ASKK Tools page or bridge environment.`,
    };
}

function searxngTimeRange(freshness) {
    const value = typeof freshness === "string" ? freshness.trim().toLowerCase() : "";
    if (["day", "24h", "past_day"].includes(value)) {
        return "day";
    }
    if (["week", "7d", "past_week", "month", "past_month"].includes(value)) {
        return "month";
    }
    if (["year", "past_year"].includes(value)) {
        return "year";
    }
    return "";
}

function attributeValue(attributes, name) {
    const match = attributes.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
    return match ? decodeHtmlEntities(match[1]) : "";
}

function normalizeSearchResultUrl(href) {
    const value = decodeHtmlEntities(href);
    if (!value) {
        return "";
    }
    try {
        const parsed = new URL(value, "https://html.duckduckgo.com");
        const redirected = parsed.searchParams.get("uddg");
        return redirected ? decodeURIComponent(redirected) : parsed.toString();
    } catch {
        return value;
    }
}

function extractTitle(html) {
    return html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function htmlToText(html) {
    return decodeHtmlEntities(html)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function decodeHtmlEntities(value) {
    return String(value ?? "")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)))
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    startBridge(parseArgs(process.argv.slice(2)));
}
