import { buildRenewalReminders } from "../domain/teamBus.js";

const DEFAULT_OWNER_EMAIL = "jht19950420@gmail.com";
const DEFAULT_DAYS_AHEAD = 3;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function runDailyRenewalScan(options) {
  const accounts = await options.store.list();
  return sendOwnerRenewalDigest({
    accounts,
    reminderHistoryStore: options.reminderHistoryStore,
    mailer: options.mailer,
    today: options.today || todayInChina(),
    daysAhead: options.daysAhead ?? DEFAULT_DAYS_AHEAD,
    to: options.to,
    sentAt: options.sentAt,
  });
}

export async function sendOwnerRenewalDigest({
  accounts,
  reminderHistoryStore,
  mailer,
  today = todayInChina(),
  daysAhead = DEFAULT_DAYS_AHEAD,
  to = DEFAULT_OWNER_EMAIL,
  sentAt = new Date().toISOString(),
}) {
  if (!mailer?.isConfigured?.()) {
    const error = new Error("SMTP 未配置，请在服务器 .env 中设置 SMTP_USER 和 SMTP_PASS");
    error.statusCode = 400;
    throw error;
  }

  const history = reminderHistoryStore ? await reminderHistoryStore.list() : [];
  const sentKeys = new Set(history.map((record) => record.cycleKey).filter(Boolean));
  const allDue = buildRenewalReminders(accounts, { today, daysAhead });
  const pending = buildRenewalReminders(accounts, { today, daysAhead, sentKeys });
  const skipped = allDue.length - pending.length;

  if (pending.length === 0) {
    return { sent: 0, skipped, reminders: [] };
  }

  const message = buildOwnerRenewalMessage(pending, to);
  await mailer.sendRenewalReminder(message);

  if (reminderHistoryStore) {
    await reminderHistoryStore.replace([
      ...history,
      ...pending.map((reminder) => ({
        cycleKey: reminder.cycleKey,
        accountId: reminder.id,
        accountEmail: reminder.email,
        nextRenewalAt: reminder.nextRenewalAt,
        sentAt,
      })),
    ]);
  }

  return { sent: pending.length, skipped, reminders: pending };
}

export function startReminderScheduler({ store, reminderHistoryStore, mailer, env = process.env, logger = console }) {
  if (env.REMINDER_SCHEDULER === "false") return null;

  const daysAhead = Number.isFinite(Number(env.REMINDER_DAYS)) ? Number(env.REMINDER_DAYS) : DEFAULT_DAYS_AHEAD;
  const intervalMs = Number.isFinite(Number(env.REMINDER_INTERVAL_MS))
    ? Number(env.REMINDER_INTERVAL_MS)
    : DEFAULT_INTERVAL_MS;
  const startupDelayMs = Number.isFinite(Number(env.REMINDER_STARTUP_DELAY_MS))
    ? Number(env.REMINDER_STARTUP_DELAY_MS)
    : 5000;
  const to = env.REMINDER_TO || DEFAULT_OWNER_EMAIL;

  const run = async () => {
    try {
      if (!mailer?.isConfigured?.()) return;
      const result = await runDailyRenewalScan({ store, reminderHistoryStore, mailer, daysAhead, to });
      if (result.sent > 0) {
        logger.log(`Renewal reminder digest sent: ${result.sent} account(s)`);
      }
    } catch (error) {
      logger.error(`Renewal reminder digest failed: ${error.message}`);
    }
  };

  const startupTimer = setTimeout(run, startupDelayMs);
  const interval = setInterval(run, intervalMs);
  startupTimer.unref?.();
  interval.unref?.();

  return {
    run,
    stop() {
      clearTimeout(startupTimer);
      clearInterval(interval);
    },
  };
}

function buildOwnerRenewalMessage(reminders, to) {
  const renewalDates = Array.from(new Set(reminders.map((reminder) => reminder.nextRenewalAt)));
  const dateLabel = renewalDates.length === 1 ? renewalDates[0] : `${renewalDates.length} 个日期`;
  const blocks = reminders.map(formatReminderBlock);

  return {
    to,
    subject: `Team Bus 待续费清单 - ${dateLabel}`,
    text: [
      "你好，",
      "",
      `以下 ${reminders.length} 个账号将在未来进入续费窗口，请在到期日前确认。`,
      "",
      "待续费清单",
      "",
      blocks.join("\n\n"),
      "",
      "发件人：不高兴",
    ].join("\n"),
  };
}

function formatReminderBlock(reminder) {
  return [
    `账号：${reminder.email}`,
    `续费日期：${reminder.nextRenewalAt}`,
    "待续费人员：",
    "姓名 / 邮箱 / 续费价格",
    ...reminder.members.map(
      (member) => `- ${member.name} / ${member.email || "未填邮箱"} / ¥${formatMoney(member.price)}`
    ),
  ].join("\n");
}

function formatMoney(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2);
}

function todayInChina() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
