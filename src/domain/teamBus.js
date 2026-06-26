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
      const { members, notes } = normalizeMemberPairs([
        [member1, member1Price],
        [member2, member2Price],
      ]);

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
  const totalProfit = accounts.reduce((sum, account) => sum + toNumber(account.profit, 0), 0);
  const usedSlots = accounts.reduce((sum, account) => sum + account.members.length, 0);
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
    current.profit += toNumber(account.profit, 0);
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
    totalSlots: accounts.length * 2,
    statuses,
    regions,
  };
}

export function filterAccounts(accounts, filters = {}) {
  const query = String(filters.query ?? "").trim().toLowerCase();
  const status = String(filters.status ?? "all");
  const region = String(filters.region ?? "all");

  return accounts.filter((account) => {
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
        .slice(0, 2)
        .map((member) => ({
          name: String(member?.name ?? "").trim(),
          price: toNumber(member?.price, NaN),
        }))
        .filter((member) => member.name || Number.isFinite(member.price))
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
    if (!Number.isFinite(member.price)) errors.push(`成员${index + 1}价格必须是数字`);
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

function normalizeMemberPairs(pairs) {
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

    members.push({ name, price });
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
    ...account.members.flatMap((member) => [member.name, member.price]),
    ...account.notes,
    account.profit,
  ]
    .join(" ")
    .toLowerCase();
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
