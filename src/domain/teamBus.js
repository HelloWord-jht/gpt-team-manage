const STATUS_DEFINITIONS = [
  { key: "active", label: "正常" },
  { key: "blocked", label: "封号" },
  { key: "canceled", label: "已退订" },
  { key: "refunded", label: "已退款" },
];

const VALID_STATUSES = new Set(STATUS_DEFINITIONS.map((status) => status.key));

export function excelSerialToISO(serial) {
  if (serial instanceof Date) {
    return serial.toISOString().slice(0, 10);
  }

  if (typeof serial === "string" && /^\d{4}-\d{2}-\d{2}$/.test(serial)) {
    return serial;
  }

  const numericSerial = Number(serial);
  if (!Number.isFinite(numericSerial)) {
    return "";
  }

  const ms = Date.UTC(1899, 11, 30) + numericSerial * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function normalizeLegacyRows(rows) {
  return rows
    .slice(1)
    .filter((row) => String(row?.[0] ?? "").trim())
    .map((row) => {
      const [email, openedAt, region, cost, member1, member1Price, member2, member2Price, profit] = row;
      const normalizedOpenedAt = excelSerialToISO(openedAt);
      const { members, notes } = normalizeMemberPairs(
        [
          [member1, member1Price],
          [member2, member2Price],
        ],
        normalizedOpenedAt
      );

      return {
        id: makeAccountId(email, normalizedOpenedAt),
        email: String(email).trim(),
        openedAt: normalizedOpenedAt,
        region: String(region ?? "").trim(),
        cost: String(cost ?? "").trim(),
        members,
        profit: toNumber(profit, 0),
        status: inferStatus(notes),
        notes,
      };
    });
}

export function summarizeAccounts(accounts) {
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const totalProfit = accounts.reduce(
    (sum, account) => sum + toNumber(account.computedProfitCny ?? account.profit, 0),
    0
  );
  const usedSlots = activeAccounts.reduce((sum, account) => sum + visibleMembers(account).length, 0);
  const statusCounts = new Map(STATUS_DEFINITIONS.map((status) => [status.key, 0]));
  const regionMap = new Map();

  accounts.forEach((account, index) => {
    statusCounts.set(account.status, (statusCounts.get(account.status) ?? 0) + 1);

    const region = account.region || "未填写";
    const current = regionMap.get(region) ?? {
      region,
      count: 0,
      activeCount: 0,
      profit: 0,
      firstSeen: index,
    };
    current.count += 1;
    current.activeCount += account.status === "active" ? 1 : 0;
    current.profit += toNumber(account.computedProfitCny ?? account.profit, 0);
    regionMap.set(region, current);
  });

  const statuses = STATUS_DEFINITIONS.map((status) => ({
    ...status,
    count: statusCounts.get(status.key) ?? 0,
  }));

  const regions = Array.from(regionMap.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
      return a.firstSeen - b.firstSeen;
    })
    .map(({ region, count, profit }) => ({ region, count, profit }));

  return {
    totalAccounts: accounts.length,
    activeAccounts: statusCounts.get("active") ?? 0,
    issueAccounts: accounts.length - (statusCounts.get("active") ?? 0),
    totalProfit,
    usedSlots,
    totalSlots: (statusCounts.get("active") ?? 0) * 2,
    statuses,
    regions,
  };
}

export function filterAccounts(accounts, filters = {}) {
  const query = String(filters.query ?? "").trim().toLowerCase();
  const status = String(filters.status ?? "all");
  const region = String(filters.region ?? "all");
  const month = String(filters.month ?? "").trim();

  return accounts.filter((account) => {
    if (month && !isAccountVisibleInMonth(account, month)) return false;
    if (status !== "all" && account.status !== status) return false;
    if (region !== "all" && account.region !== region) return false;
    if (!query) return true;

    return searchableText(account).includes(query);
  });
}

export function sanitizeAccount(payload, options = {}) {
  const errors = [];
  const email = String(payload?.email ?? "").trim();
  const openedAt = String(payload?.openedAt ?? "").trim();
  const region = String(payload?.region ?? "").trim();
  const cost = String(payload?.cost ?? "").trim();
  const status = String(payload?.status ?? "active").trim();
  const notes = Array.isArray(payload?.notes)
    ? payload.notes.map((note) => String(note).trim()).filter(Boolean)
    : [];
  const members = Array.isArray(payload?.members)
    ? payload.members
        .map((member) => ({
          name: String(member?.name ?? "").trim(),
          email: String(member?.email ?? "").trim(),
          price: toNumber(member?.price, NaN),
          joinedAt: String(member?.joinedAt ?? openedAt).trim(),
          leftAt: String(member?.leftAt ?? "").trim(),
        }))
        .filter((member) => member.name || member.email || Number.isFinite(member.price))
    : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("账号邮箱格式不正确");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(openedAt)) {
    errors.push("开通日期必须是 YYYY-MM-DD");
  }

  if (!region) {
    errors.push("地区不能为空");
  }

  if (!cost) {
    errors.push("成本不能为空");
  }

  if (!VALID_STATUSES.has(status)) {
    errors.push("状态不受支持");
  }

  members.forEach((member, index) => {
    if (!member.name) errors.push(`成员${index + 1}名称不能为空`);
    if (member.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)) {
      errors.push(`成员${index + 1}邮箱格式不正确`);
    }
    if (!Number.isFinite(member.price)) errors.push(`成员${index + 1}价格必须是数字`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(member.joinedAt)) {
      errors.push(`成员${index + 1}上车日期必须是 YYYY-MM-DD`);
    }
    if (member.leftAt && !/^\d{4}-\d{2}-\d{2}$/.test(member.leftAt)) {
      errors.push(`成员${index + 1}下车日期必须是 YYYY-MM-DD`);
    }
    if (member.leftAt && member.leftAt < member.joinedAt) {
      errors.push(`成员${index + 1}下车日期不能早于上车日期`);
    }
  });

  const profit = toNumber(payload?.profit, NaN);
  if (!Number.isFinite(profit)) {
    errors.push("利润必须是数字");
  }

  if (errors.length > 0) {
    const error = new Error(errors.join("；"));
    error.statusCode = 400;
    throw error;
  }

  return {
    id: options.id || String(payload?.id ?? "").trim() || makeAccountId(email, openedAt),
    email,
    openedAt,
    region,
    cost,
    members,
    profit,
    status,
    notes,
  };
}

export function statusDefinitions() {
  return STATUS_DEFINITIONS.map((status) => ({ ...status }));
}

export function parseCost(rawCost) {
  const raw = typeof rawCost === "object" && rawCost !== null ? rawCost.raw : rawCost;
  const text = String(raw ?? "").trim();
  const normalized = text.replace(/,/g, "");
  const amountMatch = normalized.match(/[\d.]+/);
  const amount = amountMatch ? Number(amountMatch[0]) : NaN;
  const upper = normalized.toUpperCase();
  let currency = "";

  if (/COP/.test(upper)) currency = "COP";
  else if (/JPY/.test(upper)) currency = "JPY";
  else if (/PHP/.test(upper)) currency = "PHP";
  else if (/SGD/.test(upper) || /(^|[^A-Z])S\$/.test(upper) || /新币|新加坡元/.test(normalized)) currency = "SGD";
  else if (/USD|USDT|US\$|U$/.test(upper)) currency = "USD";
  else if (/EUR/.test(upper) || /欧/.test(normalized)) currency = "EUR";
  else if (/CNY|RMB|人民币|元/.test(upper)) currency = "CNY";

  return {
    raw: text,
    amount: Number.isFinite(amount) ? amount : 0,
    currency,
  };
}

export function projectAccountForMonth(account, month, options = {}) {
  const normalized = normalizeAccount(account);
  const activeMembers = normalized.members.filter((member) => isMemberActiveInMonth(member, month));
  const costDetail = parseCost(normalized.cost);
  const rateToCny = normalized.exchangeRate?.rateToCny;
  const costCny =
    normalized.status === "active" && activeMembers.length > 0 && Number.isFinite(rateToCny)
      ? roundMoney(costDetail.amount * rateToCny)
      : null;
  const revenueCny = roundMoney(activeMembers.reduce((sum, member) => sum + toNumber(member.price, 0), 0));
  const computedProfitCny = costCny === null ? null : roundMoney(revenueCny - costCny);

  return {
    ...normalized,
    activeMembers,
    costDetail,
    costCny,
    revenueCny,
    computedProfitCny,
    renewal: buildRenewalInfo(normalized, options.today),
  };
}

export function buildRenewalReminders(accounts, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const daysAhead = Number.isFinite(Number(options.daysAhead)) ? Number(options.daysAhead) : 3;
  const sentKeys = new Set(options.sentKeys || []);

  return accounts
    .map(normalizeAccount)
    .filter((account) => account.status === "active")
    .map((account) => {
      const renewal = buildRenewalInfo(account, today);
      const { nextRenewalAt, daysLeft } = renewal;
      const month = nextRenewalAt.slice(0, 7);
      const activeMembers = account.members.filter((member) => isMemberActiveInMonth(member, month));
      const cycleKey = renewalCycleKey(account.id, nextRenewalAt);

      return {
        id: account.id,
        email: account.email,
        region: account.region,
        cost: account.cost,
        nextRenewalAt,
        daysLeft,
        cycleKey,
        renewal,
        members: activeMembers,
        memberEmails: activeMembers.map((member) => member.email).filter(Boolean),
      };
    })
    .filter(
      (reminder) =>
        reminder.members.length > 0 &&
        reminder.daysLeft >= 0 &&
        reminder.daysLeft <= daysAhead &&
        !sentKeys.has(reminder.cycleKey)
    )
    .sort((a, b) => a.nextRenewalAt.localeCompare(b.nextRenewalAt));
}

export function compareAccountsForDisplay(a, b) {
  const rankA = accountDisplayRank(a);
  const rankB = accountDisplayRank(b);
  if (rankA !== rankB) return rankA - rankB;

  if (rankA === 0) {
    const daysA = toNumber(a.renewal?.daysLeft, Number.POSITIVE_INFINITY);
    const daysB = toNumber(b.renewal?.daysLeft, Number.POSITIVE_INFINITY);
    if (daysA !== daysB) return daysA - daysB;
  }

  return 0;
}

export function normalizeAccount(account) {
  const openedAt = excelSerialToISO(account.openedAt) || "";
  return {
    id: account.id || makeAccountId(account.email, openedAt),
    email: String(account.email ?? "").trim(),
    openedAt,
    region: String(account.region ?? "").trim(),
    cost: typeof account.cost === "object" && account.cost !== null ? account.cost.raw : String(account.cost ?? "").trim(),
    members: Array.isArray(account.members)
      ? account.members.map((member) => normalizeMember(member, openedAt))
      : [],
    profit: toNumber(account.profit, 0),
    status: VALID_STATUSES.has(account.status) ? account.status : "active",
    notes: Array.isArray(account.notes) ? account.notes.map((note) => String(note).trim()).filter(Boolean) : [],
    exchangeRate: account.exchangeRate || null,
  };
}

function normalizeMemberPairs(pairs, openedAt = "") {
  const members = [];
  const notes = [];

  pairs.forEach(([nameValue, priceValue]) => {
    const name = String(nameValue ?? "").trim();
    const price = toNumber(priceValue, NaN);
    const priceNote = String(priceValue ?? "").trim();

    if (!name && !priceNote) return;

    if (isOperationalNote(name) || !Number.isFinite(price)) {
      if (name) notes.push(name);
      if (priceNote) notes.push(priceNote);
      return;
    }

    members.push({ name, email: "", price, joinedAt: openedAt, leftAt: "" });
  });

  return { members, notes: unique(notes) };
}

function inferStatus(notes) {
  const text = notes.join(" ");
  if (/退订/.test(text)) return "canceled";
  if (/封号|被封/.test(text)) return "blocked";
  if (/退款/.test(text)) return "refunded";
  return "active";
}

function isOperationalNote(value) {
  return /封号|被封|退款|退订|已主动/.test(value);
}

function searchableText(account) {
  return [
    account.email,
    account.openedAt,
    account.region,
    account.cost,
    account.status,
    ...visibleMembers(account).flatMap((member) => [member.name, member.email, member.price, member.joinedAt, member.leftAt]),
    ...account.notes,
    account.profit,
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeMember(member, openedAt) {
  return {
    name: String(member?.name ?? "").trim(),
    email: String(member?.email ?? "").trim(),
    price: toNumber(member?.price, 0),
    joinedAt: String(member?.joinedAt || openedAt).trim(),
    leftAt: String(member?.leftAt ?? "").trim(),
  };
}

function isAccountVisibleInMonth(account, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return true;
  const normalized = normalizeAccount(account);
  if (!normalized.openedAt || normalized.openedAt > monthEnd(month)) return false;
  if (normalized.members.some((member) => isMemberActiveInMonth(member, month))) return true;
  return normalized.openedAt.startsWith(month);
}

function isMemberActiveInMonth(member, month) {
  const start = monthStart(month);
  const end = monthEnd(month);
  const joinedAt = member.joinedAt || start;
  const leftAt = member.leftAt || "9999-12-31";
  return joinedAt <= end && leftAt >= start;
}

function visibleMembers(account) {
  return Array.isArray(account.activeMembers) ? account.activeMembers : account.members || [];
}

function buildRenewalInfo(account, today = new Date().toISOString().slice(0, 10)) {
  const nextRenewalAt = nextRenewalDate(account.openedAt, today);
  const daysLeft = diffDays(today, nextRenewalAt);
  return {
    nextRenewalAt,
    daysLeft,
    isDueSoon: account.status === "active" && daysLeft >= 0 && daysLeft <= 3,
  };
}

function renewalCycleKey(accountId, nextRenewalAt) {
  return `${accountId}:${nextRenewalAt}`;
}

function accountDisplayRank(account) {
  if (account.status === "active" && account.renewal?.isDueSoon) return 0;
  if (account.status === "active") return 1;
  return 2;
}

function nextRenewalDate(openedAt, today) {
  const openedDay = Number(openedAt.slice(8, 10));
  const current = new Date(`${today}T00:00:00Z`);
  let candidate = dateWithDay(current.getUTCFullYear(), current.getUTCMonth() + 1, openedDay);
  if (candidate < today) {
    const nextMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
    candidate = dateWithDay(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, openedDay);
  }
  return candidate;
}

function dateWithDay(year, month, day) {
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, maxDay)).padStart(2, "0")}`;
}

function diffDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function monthStart(month) {
  return `${month}-01`;
}

function monthEnd(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const maxDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(maxDay).padStart(2, "0")}`;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function makeAccountId(email, openedAt) {
  return `${email}-${openedAt}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toNumber(value, fallback) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function unique(values) {
  return Array.from(new Set(values));
}
