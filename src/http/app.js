import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  filterAccounts,
  sanitizeAccount,
  statusDefinitions,
  summarizeAccounts,
} from "../domain/teamBus.js";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function createApp({ store, publicDir = defaultPublicDir() }) {
  return async function app(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");

      if (url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true });
      }

      if (url.pathname === "/api/accounts" && request.method === "GET") {
        return await handleList(request, response, store, url);
      }

      if (url.pathname === "/api/accounts" && request.method === "POST") {
        return await handleCreate(request, response, store);
      }

      const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
      if (accountMatch && request.method === "PUT") {
        return await handleUpdate(request, response, store, decodeURIComponent(accountMatch[1]));
      }

      if (accountMatch && request.method === "DELETE") {
        return await handleDelete(response, store, decodeURIComponent(accountMatch[1]));
      }

      if (url.pathname.startsWith("/api/")) {
        return sendJson(response, 404, { error: "接口不存在" });
      }

      if (publicDir) {
        return await serveStatic(response, publicDir, url.pathname);
      }

      sendJson(response, 404, { error: "页面不存在" });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "服务暂时不可用",
      });
    }
  };
}

async function handleList(_request, response, store, url) {
  const accounts = await store.list();
  const filtered = filterAccounts(accounts, {
    query: url.searchParams.get("q"),
    status: url.searchParams.get("status") || "all",
    region: url.searchParams.get("region") || "all",
  });
  const regions = Array.from(new Set(accounts.map((account) => account.region).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "zh-Hans-CN")
  );

  sendJson(response, 200, {
    accounts: filtered,
    summary: summarizeAccounts(accounts),
    filters: {
      regions,
      statuses: statusDefinitions(),
    },
  });
}

async function handleCreate(request, response, store) {
  const payload = await readJson(request);
  const accounts = await store.list();
  const account = sanitizeAccount(payload);

  if (accounts.some((item) => item.id === account.id)) {
    account.id = `${account.id}-${Date.now().toString(36)}`;
  }

  accounts.unshift(account);
  await store.replace(accounts);
  sendJson(response, 201, { account, summary: summarizeAccounts(accounts) });
}

async function handleUpdate(request, response, store, id) {
  const payload = await readJson(request);
  const accounts = await store.list();
  const index = accounts.findIndex((account) => account.id === id);

  if (index === -1) {
    return sendJson(response, 404, { error: "账号不存在" });
  }

  const account = sanitizeAccount(payload, { id });
  accounts[index] = account;
  await store.replace(accounts);
  sendJson(response, 200, { account, summary: summarizeAccounts(accounts) });
}

async function handleDelete(response, store, id) {
  const accounts = await store.list();
  const nextAccounts = accounts.filter((account) => account.id !== id);

  if (nextAccounts.length === accounts.length) {
    return sendJson(response, 404, { error: "账号不存在" });
  }

  await store.replace(nextAccounts);
  response.writeHead(204);
  response.end();
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("JSON 格式不正确");
    error.statusCode = 400;
    throw error;
  }
}

async function serveStatic(response, publicDir, requestPath) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const resolved = path.resolve(publicDir, `.${safePath}`);
  const root = path.resolve(publicDir);

  if (!resolved.startsWith(root)) {
    return sendJson(response, 403, { error: "禁止访问" });
  }

  try {
    const body = await fs.readFile(resolved);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(resolved)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "页面不存在" });
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function defaultPublicDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
}
