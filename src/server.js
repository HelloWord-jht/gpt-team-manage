import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./http/app.js";
import { BackupService, startBackupScheduler } from "./services/backups.js";
import { ExchangeRateService } from "./services/exchangeRates.js";
import { SmtpMailer } from "./services/mailer.js";
import { startMonthlySnapshotScheduler } from "./services/monthlySnapshotScheduler.js";
import { startReminderScheduler } from "./services/renewalReminders.js";
import { JsonStore } from "./store/jsonStore.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = process.env.DATA_PATH || path.join(rootDir, "data", "team-bus.json");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 5176);
const host = process.env.HOST || "127.0.0.1";

const store = new JsonStore(dataPath);
const reminderHistoryStore = new JsonStore(path.join(rootDir, "data", "reminder-history.json"));
const renewalActionStore = new JsonStore(path.join(rootDir, "data", "renewal-actions.json"));
const monthlySnapshotStore = new JsonStore(path.join(rootDir, "data", "monthly-snapshots.json"));
const exchangeRates = new ExchangeRateService(path.join(rootDir, "data", "exchange-rates.json"));
const mailer = new SmtpMailer();
const backupService = new BackupService(path.join(rootDir, "data"));
const server = createServer(
  createApp({
    store,
    publicDir,
    exchangeRates,
    mailer,
    reminderHistoryStore,
    renewalActionStore,
    monthlySnapshotStore,
    backupService,
  })
);

startReminderScheduler({ store, reminderHistoryStore, mailer });
startMonthlySnapshotScheduler({ store, monthlySnapshotStore, exchangeRates });
startBackupScheduler({ backupService });

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`Team Bus Manager is running at http://${displayHost}:${port}`);
});
