import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRenewalReminders,
  compareAccountsForDisplay,
  filterAccounts,
  paymentStatusDefinitions,
  projectAccountForMonth,
  sanitizeAccount,
  statusDefinitions,
  summarizeAccounts,
} from "../domain/teamBus.js";
import {
  buildMonthlySnapshot,
  snapshotMetadata,
  upsertMonthlySnapshot,
} from "../domain/monthlySnapshots.js";
import { buildRenewalWorkItems } from "../domain/renewalWorkItems.js";
import { sendOwnerRenewalDigest } from "../services/renewalReminders.js";
import { JsonStoreCorruptionError } from "../store/jsonStore.js";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function createApp({
  store,
  publicDir = defaultPublicDir(),
  exchangeRates = null,
  mailer = null,
  reminderHistoryStore = null,
  renewalActionStore = null,
  monthlySnapshotStore = null,
  backupService = null,
  now = () => new Date(),
  logger = console,
}) {
  return async function app(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");

      if (url.pathname === "/api/health") {
        return sendJson(response, 200, { ok: true });
      }

      if (url.pathname === "/api/accounts" && request.method === "GET") {
        return await handleList(request, response, store, url, exchangeRates, now());
      }

      if (url.pathname === "/api/accounts" && request.method === "POST") {
        return await handleCreate(request, response, store);
      }

      if (url.pathname === "/api/reminders/send" && request.method === "POST") {
        return await handleSendReminders(
          request,
          response,
          store,
          mailer,
          reminderHistoryStore,
          now()
        );
      }

      if (url.pathname === "/api/snapshots" && request.method === "GET") {
        return await handleListSnapshots(response, monthlySnapshotStore, url, now());
      }

      if (url.pathname === "/api/snapshots" && request.method === "POST") {
        return await handleCreateSnapshot(
          request,
          response,
          store,
          monthlySnapshotStore,
          exchangeRates,
          now()
        );
      }

      if (url.pathname === "/api/backups" && request.method === "GET") {
        return await handleListBackups(response, backupService);
      }

      if (url.pathname === "/api/backups" && request.method === "POST") {
        return await handleCreateBackup(response, backupService, now());
      }

      const backupRestoreMatch = url.pathname.match(/^\/api\/backups\/([^/]+)\/restore$/);
      if (backupRestoreMatch && request.method === "POST") {
        return await handleRestoreBackup(
          response,
          backupService,
          decodePathSegment(backupRestoreMatch[1])
        );
      }

      if (url.pathname === "/api/renewals" && request.method === "GET") {
        return await handleListRenewals(
          response,
          store,
          reminderHistoryStore,
          renewalActionStore,
          url,
          now()
        );
      }

      const renewalActionMatch = url.pathname.match(/^\/api\/renewals\/([^/]+)\/handled$/);
      if (renewalActionMatch && request.method === "POST") {
        return await handleMarkRenewalHandled(
          request,
          response,
          store,
          renewalActionStore,
          decodePathSegment(renewalActionMatch[1]),
          now()
        );
      }

      if (renewalActionMatch && request.method === "DELETE") {
        return await handleDeleteRenewalAction(
          response,
          store,
          renewalActionStore,
          decodePathSegment(renewalActionMatch[1]),
          now()
        );
      }

      const accountMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/);
      if (accountMatch && request.method === "PUT") {
        return await handleUpdate(request, response, store, decodePathSegment(accountMatch[1]));
      }

      if (accountMatch && request.method === "DELETE") {
        return await handleDelete(response, store, decodePathSegment(accountMatch[1]));
      }

      if (url.pathname.startsWith("/api/")) {
        return sendJson(response, 404, { error: "接口不存在" });
      }

      if (publicDir) {
        return await serveStatic(response, publicDir, url.pathname);
      }

      sendJson(response, 404, { error: "页面不存在" });
    } catch (error) {
      if (!error.statusCode) {
        try {
          logger?.error?.(error);
        } catch {
          // Logging must not replace the original response.
        }
      }

      sendJson(response, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : error instanceof JsonStoreCorruptionError
            ? "数据文件损坏，请检查服务器数据文件并恢复为有效的 JSON 数组"
            : "服务暂时不可用",
      });
    }
  };
}

async function handleList(_request, response, store, url, exchangeRates, currentDate) {
  const defaultToday = todayInChina(currentDate);
  const today = normalizeDate(url.searchParams.get("today"), defaultToday);
  const month = normalizeMonth(url.searchParams.get("month"), today.slice(0, 7));
  const accounts = await withRates(await store.list(), exchangeRates);
  const monthlyAccounts = accounts
    .filter((account) => filterAccounts([account], { month }).length > 0)
    .map((account) => projectAccountForMonth(account, month, { today }));
  const filtered = filterAccounts(monthlyAccounts, {
    query: url.searchParams.get("q"),
    status: url.searchParams.get("status") || "all",
    region: url.searchParams.get("region") || "all",
  }).sort(compareAccountsForDisplay);
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
      paymentStatuses: paymentStatusDefinitions(),
    },
  });
}

async function handleListSnapshots(response, monthlySnapshotStore, url, currentDate) {
  const defaultToday = todayInChina(currentDate);
  const month = normalizeMonth(url.searchParams.get("month"), defaultToday.slice(0, 7));
  const snapshots = await listOptionalStore(monthlySnapshotStore);
  const snapshot = snapshots.find((record) => record?.month === month) || null;

  sendJson(response, 200, {
    month,
    snapshot,
    snapshots: snapshots.map(snapshotMetadata),
  });
}

async function handleCreateSnapshot(
  request,
  response,
  store,
  monthlySnapshotStore,
  exchangeRates,
  currentDate
) {
  if (!isWritableStore(monthlySnapshotStore)) {
    return sendJson(response, 503, { error: "月度结算快照存储不可用" });
  }

  const payload = await readJson(request);
  const defaultToday = todayInChina(currentDate);
  const month = normalizeMonth(payload.month, defaultToday.slice(0, 7));
  const overwrite = payload.overwrite !== false;
  const accounts = await withRates(await store.list(), exchangeRates);
  const snapshot = buildMonthlySnapshot(accounts, {
    month,
    today: `${month}-01`,
    generatedAt: currentDate.toISOString(),
  });
  let result = null;

  await monthlySnapshotStore.update((snapshots) => {
    result = upsertMonthlySnapshot(snapshots, snapshot, { overwrite });
    return result.snapshots;
  });

  sendJson(response, result.created ? 201 : 200, {
    snapshot: result.snapshot,
    created: result.created,
    updated: result.updated,
  });
}

async function handleListBackups(response, backupService) {
  if (!backupService?.listBackups) {
    return sendJson(response, 503, { error: "数据备份服务不可用" });
  }

  sendJson(response, 200, { backups: await backupService.listBackups() });
}

async function handleCreateBackup(response, backupService, currentDate) {
  if (!backupService?.createBackup) {
    return sendJson(response, 503, { error: "数据备份服务不可用" });
  }

  const backup = await backupService.createBackup({ now: currentDate });
  sendJson(response, 201, { backup });
}

async function handleRestoreBackup(response, backupService, backupId) {
  if (!backupService?.restoreBackup) {
    return sendJson(response, 503, { error: "数据备份服务不可用" });
  }

  const restore = await backupService.restoreBackup(backupId);
  sendJson(response, 200, { restore });
}

async function handleSendReminders(
  request,
  response,
  store,
  mailer,
  reminderHistoryStore,
  currentDate
) {
  if (!mailer?.isConfigured?.()) {
    return sendJson(response, 400, { error: "SMTP 未配置，请在服务器 .env 中设置 SMTP_USER 和 SMTP_PASS" });
  }

  const payload = await readJson(request);
  const today = String(payload.today || todayInChina(currentDate));
  const daysAhead = Number(payload.daysAhead ?? process.env.REMINDER_DAYS ?? 3);
  const accounts = await store.list();
  const result = await sendOwnerRenewalDigest({
    accounts,
    reminderHistoryStore,
    mailer,
    today,
    daysAhead,
    to: payload.to || process.env.REMINDER_TO || "jht19950420@gmail.com",
  });

  sendJson(response, 200, result);
}

async function handleListRenewals(
  response,
  store,
  reminderHistoryStore,
  renewalActionStore,
  url,
  currentDate
) {
  const defaultToday = todayInChina(currentDate);
  const today = normalizeDate(url.searchParams.get("today"), defaultToday);
  const month = normalizeMonth(url.searchParams.get("month"), today.slice(0, 7));
  const daysAhead = url.searchParams.get("daysAhead") ?? undefined;
  const [accounts, reminderHistory, actions] = await Promise.all([
    store.list(),
    listOptionalStore(reminderHistoryStore),
    listOptionalStore(renewalActionStore),
  ]);

  sendJson(response, 200, {
    month,
    ...buildRenewalWorkItems(accounts, {
      today,
      daysAhead,
      reminderHistory,
      actions,
    }),
  });
}

async function handleMarkRenewalHandled(
  request,
  response,
  store,
  renewalActionStore,
  cycleKey,
  currentDate
) {
  if (!isWritableStore(renewalActionStore)) {
    return sendJson(response, 503, { error: "续费处理记录存储不可用" });
  }

  const payload = await readJson(request);
  const today = todayInChina(currentDate);
  const accounts = await store.list();
  const exists = buildRenewalWorkItems(accounts, { today }).all.some(
    (item) => item.cycleKey === cycleKey
  );

  if (!exists) {
    return sendJson(response, 404, { error: "续费周期不存在" });
  }

  const handledAt =
    payload?.handledAt === undefined ? currentDate.toISOString() : payload.handledAt;
  if (!isCanonicalUtcTimestamp(handledAt)) {
    return sendJson(response, 400, {
      error:
        "handledAt 必须是 Date#toISOString() 生成的标准 UTC 时间，例如 2026-06-30T08:30:00.000Z",
    });
  }

  const record = { cycleKey, handledAt };
  await renewalActionStore.update((actions) => [
    ...actions.filter((action) => action?.cycleKey !== cycleKey),
    record,
  ]);

  sendJson(response, 200, { action: record });
}

async function handleDeleteRenewalAction(
  response,
  store,
  renewalActionStore,
  cycleKey,
  currentDate
) {
  if (!isWritableStore(renewalActionStore)) {
    return sendJson(response, 503, { error: "续费处理记录存储不可用" });
  }

  const today = todayInChina(currentDate);
  const accounts = await store.list();
  const exists = buildRenewalWorkItems(accounts, { today }).all.some(
    (item) => item.cycleKey === cycleKey
  );

  if (!exists) {
    return sendJson(response, 404, { error: "续费周期不存在" });
  }

  const missingAction = {};
  try {
    await renewalActionStore.update((actions) => {
      const nextActions = actions.filter((action) => action?.cycleKey !== cycleKey);
      if (nextActions.length === actions.length) throw missingAction;
      return nextActions;
    });
  } catch (error) {
    if (error === missingAction) {
      return sendJson(response, 404, { error: "处理记录不存在" });
    }
    throw error;
  }

  sendJson(response, 200, { cycleKey, handled: false });
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

async function listOptionalStore(store) {
  return typeof store?.list === "function" ? await store.list() : [];
}

function isWritableStore(store) {
  return typeof store?.update === "function";
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

async function withRates(accounts, exchangeRates) {
  if (!exchangeRates?.attachRates) return accounts;
  return await exchangeRates.attachRates(accounts);
}

function normalizeMonth(value, fallback) {
  if (value === null || value === undefined) return fallback;

  const text = String(value).trim();
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(text)) return text;
  throw requestError(400, "month 必须是有效的 YYYY-MM 月份");
}

function normalizeDate(value, fallback) {
  if (value === null || value === undefined) return fallback;

  const text = String(value).trim();
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text
  ) {
    return text;
  }

  throw requestError(400, "today 必须是有效的 YYYY-MM-DD 日期");
}

function todayInChina(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      throw requestError(400, "路径参数编码不正确");
    }
    throw error;
  }
}

function requestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function defaultPublicDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
}
