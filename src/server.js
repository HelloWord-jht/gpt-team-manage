import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./http/app.js";
import { ExchangeRateService } from "./services/exchangeRates.js";
import { SmtpMailer } from "./services/mailer.js";
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
const exchangeRates = new ExchangeRateService(path.join(rootDir, "data", "exchange-rates.json"));
const mailer = new SmtpMailer();
const server = createServer(
  createApp({
    store,
    publicDir,
    exchangeRates,
    mailer,
    reminderHistoryStore,
    renewalActionStore,
  })
);

startReminderScheduler({ store, reminderHistoryStore, mailer });

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`Team Bus Manager is running at http://${displayHost}:${port}`);
});
