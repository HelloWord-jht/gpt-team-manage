import { buildRenewalReminders } from "./teamBus.js";

const ISO_TIMESTAMP_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?(?<timezone>Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/;

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

    const instant = parseStrictIsoTimestamp(timestamp);
    if (instant === null) continue;

    if (
      !latestInstants.has(cycleKey) ||
      compareIsoTimestampInstants(instant, latestInstants.get(cycleKey)) > 0
    ) {
      latest.set(cycleKey, timestamp);
      latestInstants.set(cycleKey, instant);
    }
  }

  return latest;
}

function parseStrictIsoTimestamp(timestamp) {
  if (typeof timestamp !== "string") return null;

  const match = ISO_TIMESTAMP_PATTERN.exec(timestamp);
  if (!match) return null;

  const { groups } = match;
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const hour = Number(groups.hour);
  const minute = Number(groups.minute);
  const second = Number(groups.second);
  const offsetHour = Number(groups.offsetHour || 0);
  const offsetMinute = Number(groups.offsetMinute || 0);
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);

  const offsetDirection = groups.offsetSign === "-" ? -1 : 1;
  const offsetMilliseconds = offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const fractionalNanoseconds = BigInt((groups.fraction || "").padEnd(9, "0") || "0");

  return BigInt(date.getTime() - offsetMilliseconds) * 1_000_000n + fractionalNanoseconds;
}

function compareIsoTimestampInstants(left, right) {
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function roundMoney(value) {
  const cents = value * 100;
  return Math.round(cents + Number.EPSILON * Math.abs(cents)) / 100;
}
