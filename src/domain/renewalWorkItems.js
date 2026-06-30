import { buildRenewalReminders } from "./teamBus.js";

export function buildRenewalWorkItems(accounts, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const daysAhead = Number.isFinite(Number(options.daysAhead)) ? Number(options.daysAhead) : 3;
  const sentByCycle = latestTimestampByCycle(options.reminderHistory, "sentAt");
  const handledByCycle = latestTimestampByCycle(options.actions, "handledAt");
  const all = buildRenewalReminders(accounts, { today, daysAhead: 31 })
    .map((reminder) => ({
      ...reminder,
      totalPrice: roundMoney(
        reminder.members.reduce((sum, member) => sum + Number(member.price || 0), 0)
      ),
      sentAt: sentByCycle.get(reminder.cycleKey) ?? null,
      handledAt: handledByCycle.get(reminder.cycleKey) ?? null,
    }))
    .sort(
      (a, b) =>
        a.nextRenewalAt.localeCompare(b.nextRenewalAt) || a.email.localeCompare(b.email)
    );
  const due = all.filter((item) => item.daysLeft >= 0 && item.daysLeft <= daysAhead);
  const pending = due.filter((item) => !item.handledAt);

  return {
    all,
    due,
    pending,
    counts: { all: all.length, due: due.length, pending: pending.length },
  };
}

function latestTimestampByCycle(records, field) {
  const latest = new Map();
  const latestInstants = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const cycleKey = record?.cycleKey;
    const timestamp = record?.[field];
    if (!cycleKey || !timestamp) continue;

    const instant = Date.parse(timestamp);
    if (!Number.isFinite(instant)) continue;

    if (!latestInstants.has(cycleKey) || instant > latestInstants.get(cycleKey)) {
      latest.set(cycleKey, timestamp);
      latestInstants.set(cycleKey, instant);
    }
  }

  return latest;
}

function roundMoney(value) {
  const cents = value * 100;
  return Math.round(cents + Number.EPSILON * Math.abs(cents)) / 100;
}
