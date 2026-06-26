import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRenewalReminders,
  filterAccounts,
  projectAccountForMonth,
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

export function createApp({ store, publicDir = defaultPublicDir(), exchangeRates = null, mailer = null }) {
  return async function app(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");

      if (url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true });
      }

      if (url.pathname === "/api/accounts" && request.method === "GET") {
        return await handleList(request, response, store, url, exchangeRates);
      }

      if (url.pathname === "/api/accounts" && request.method === "POST") {
        return await handleCreate(request, response, store);
      }

      if (url.pathname === "/api/reminders/send" && request.method === "POST") {
        return await handleSendReminders(request, response, store, mailer);
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

async function handleList(_request, response, store, url, exchangeRates) {
  const month = normalizeMonth(url.searchParams.get("month"));
  const accounts = await withRates(await store.list(), exchangeRates);
  const monthlyAccounts = accounts
    .filter((account) => filterAccounts([account], { month }).length > 0)
    .map((account) => projectAccountForMonth(account, month));
  const filtered = filterAccounts(monthlyAccounts, {
    query: url.searchParams.get("q"),
    status: url.searchParams.get("status") || "all",
    region: url.searchParams.get("region") || "all",
  });
  const regions = Array.from(new Set(accounts.map((account) => account.region).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b, "zh-Hans-CN")
  );

  sendJson(response, 200, {
    accounts: filtered,
    summary: summarizeAccounts(monthlyAccounts),
    month,
    reminders: buildRenewalReminders(accounts, { today: `${month}-01`, daysAhead: 31 }),
    filters: {
      regions,
      statuses: statusDefinitions(),
    },
  });
}

async function handleSendReminders(request, response, store, mailer) {
  if (!mailer?.isConfigured?.()) {
    return sendJson(response, 400, { error: "SMTP 未配置，请在服务器 .env 中设置 SMTP_USER 和 SMTP_PASS" });
  }

  const payload = await readJson(request);
  const today = String(payload.today || new Date().toISOString().slice(0, 10));
  const daysAhead = Number(payload.daysAhead ?? process.env.REMINDER_DAYS ?? 3);
  const reminders = buildRenewalReminders(await store.list(), { today, daysAhead });

  if (reminders.length === 0) {
    return sendJson(response, 200, { sent: 0, reminders: [] });
  }

  const message = buildReminderMessage(reminders, payload.to || process.env.REMINDER_TO || process.env.SMTP_USER);
  await mailer.sendRenewalReminder(message);
  sendJson(response, 200, { sent: reminders.length, reminders });
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

async function withRates(accounts, exchangeRates) {
  if (!exchangeRates?.attachRates) return accounts;
  return await exchangeRates.attachRates(accounts);
}

function normalizeMonth(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  return new Date().toISOString().slice(0, 7);
}

function buildReminderMessage(reminders, to) {
  const lines = reminders.flatMap((reminder) => [
    `账号：${reminder.email}`,
    `地区：${reminder.region}`,
    `续费日期：${reminder.nextRenewalAt}（剩余 ${reminder.daysLeft} 天）`,
    `成本：${reminder.cost}`,
    `成员：${reminder.members.map((member) => `${member.name}${member.email ? ` <${member.email}>` : ""}`).join("、") || "无"}`,
    "",
  ]);

  return {
    to,
    subject: `Team Bus 续费提醒：${reminders.length} 个账号即将续费`,
    text: `以下账号即将续费：\n\n${lines.join("\n")}`,
  };
}

function defaultPublicDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
}
