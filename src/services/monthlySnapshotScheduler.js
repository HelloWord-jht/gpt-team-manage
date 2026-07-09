import { buildMonthlySnapshot, upsertMonthlySnapshot } from "../domain/monthlySnapshots.js";

export function startMonthlySnapshotScheduler({
  store,
  monthlySnapshotStore,
  exchangeRates = null,
  logger = console,
  now = () => new Date(),
}) {
  if (!store?.list || !monthlySnapshotStore?.update) return null;

  const run = async () => {
    try {
      const currentDate = now();
      const month = previousMonth(todayInChina(currentDate));
      const snapshots = await monthlySnapshotStore.list();
      if (snapshots.some((snapshot) => snapshot?.month === month)) {
        logger.log?.(`Monthly snapshot exists: ${month}`);
        return;
      }

      const accounts = await withRates(await store.list(), exchangeRates);
      const snapshot = buildMonthlySnapshot(accounts, {
        month,
        today: `${month}-01`,
        generatedAt: currentDate.toISOString(),
      });
      const result = await monthlySnapshotStore.update((snapshots) =>
        upsertMonthlySnapshot(snapshots, snapshot, { overwrite: false }).snapshots
      );
      const exists = result.some((record) => record?.month === month);
      if (exists) logger.log?.(`Monthly snapshot created: ${month}`);
    } catch (error) {
      logger.error?.("Monthly snapshot scheduler failed", error);
    }
  };

  void run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}

async function withRates(accounts, exchangeRates) {
  if (!exchangeRates?.attachRates) return accounts;
  return await exchangeRates.attachRates(accounts);
}

function previousMonth(today) {
  const [year, month] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function todayInChina(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
