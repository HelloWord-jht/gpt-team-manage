import {
  filterAccounts,
  projectAccountForMonth,
  summarizeAccounts,
} from "./teamBus.js";

export function buildMonthlySnapshot(accounts, options = {}) {
  const month = requireMonth(options.month);
  const generatedAt = String(options.generatedAt || new Date().toISOString());
  const today = String(options.today || `${month}-01`);
  const monthlyAccounts = accounts
    .filter((account) => filterAccounts([account], { month }).length > 0)
    .map((account) => projectAccountForMonth(account, month, { today }));
  const summary = summarizeAccounts(monthlyAccounts);
  const events = buildLifecycleEvents(monthlyAccounts, month);
  const paymentCounts = summary.paymentStatuses.reduce(
    (counts, status) => ({ ...counts, [status.key]: status.count }),
    {}
  );

  return {
    id: month,
    month,
    generatedAt,
    version: 1,
    summary,
    totals: {
      revenueCny: roundMoney(summary.totalRevenue),
      costCny: roundMoney(summary.totalCost),
      profitCny: roundMoney(summary.totalProfit),
      receivableCny: roundMoney(summary.receivable),
      activeMembers: summary.usedSlots,
      paymentCounts,
    },
    events,
    accounts: monthlyAccounts.map(snapshotAccount),
  };
}

export function upsertMonthlySnapshot(snapshots, snapshot, options = {}) {
  const records = Array.isArray(snapshots) ? snapshots : [];
  const index = records.findIndex((record) => record?.month === snapshot.month);

  if (index >= 0 && !options.overwrite) {
    return {
      snapshots: records,
      snapshot: records[index],
      created: false,
      updated: false,
    };
  }

  const nextRecords =
    index >= 0
      ? records.map((record, recordIndex) => (recordIndex === index ? snapshot : record))
      : [...records, snapshot];

  nextRecords.sort((a, b) => String(b.month).localeCompare(String(a.month)));

  return {
    snapshots: nextRecords,
    snapshot,
    created: index === -1,
    updated: index >= 0,
  };
}

export function snapshotMetadata(snapshot) {
  return {
    month: snapshot.month,
    generatedAt: snapshot.generatedAt,
    revenueCny: snapshot.totals?.revenueCny ?? snapshot.summary?.totalRevenue ?? 0,
    costCny: snapshot.totals?.costCny ?? snapshot.summary?.totalCost ?? 0,
    profitCny: snapshot.totals?.profitCny ?? snapshot.summary?.totalProfit ?? 0,
    receivableCny: snapshot.totals?.receivableCny ?? snapshot.summary?.receivable ?? 0,
    accountCount: snapshot.summary?.totalAccounts ?? snapshot.accounts?.length ?? 0,
    activeMembers: snapshot.totals?.activeMembers ?? snapshot.summary?.usedSlots ?? 0,
  };
}

function snapshotAccount(account) {
  return {
    id: account.id,
    email: account.email,
    status: account.status,
    region: account.region,
    cost: account.cost,
    costCny: account.costCny,
    revenueCny: account.revenueCny,
    profitCny: account.computedProfitCny,
    openedAt: account.openedAt,
    exchangeRate: account.exchangeRate,
    members: (account.activeMembers || []).map((member) => ({
      name: member.name,
      email: member.email,
      price: member.price,
      joinedAt: member.joinedAt,
      leftAt: member.leftAt,
      paymentStatus: member.paymentStatus,
    })),
    notes: Array.isArray(account.notes) ? [...account.notes] : [],
  };
}

function buildLifecycleEvents(accounts, month) {
  const joined = [];
  const left = [];

  accounts.forEach((account) => {
    (account.members || []).forEach((member) => {
      const event = {
        accountId: account.id,
        accountEmail: account.email,
        memberName: member.name,
        memberEmail: member.email,
        price: member.price,
        paymentStatus: member.paymentStatus,
      };

      if (String(member.joinedAt || "").startsWith(month)) {
        joined.push({ ...event, date: member.joinedAt });
      }

      if (String(member.leftAt || "").startsWith(month)) {
        left.push({ ...event, date: member.leftAt });
      }
    });
  });

  return {
    joined: joined.sort(compareEvents),
    left: left.sort(compareEvents),
  };
}

function compareEvents(a, b) {
  const byDate = String(a.date).localeCompare(String(b.date));
  if (byDate !== 0) return byDate;
  return String(a.accountEmail).localeCompare(String(b.accountEmail));
}

function requireMonth(month) {
  const text = String(month || "").trim();
  if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(text)) return text;
  throw new Error("month must be YYYY-MM");
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
