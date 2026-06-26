import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDailyRenewalScan } from "../src/services/renewalReminders.js";

function memoryStore(seed = []) {
  let records = structuredClone(seed);

  return {
    async list() {
      return structuredClone(records);
    },
    async replace(nextRecords) {
      records = structuredClone(nextRecords);
    },
  };
}

describe("renewal reminder service", () => {
  it("sends one owner digest per renewal cycle and records sent cycle keys", async () => {
    const sent = [];
    const historyStore = memoryStore();
    const accountStore = memoryStore([
      {
        id: "bus-1",
        email: "bus@example.com",
        openedAt: "2026-06-01",
        region: "美国",
        cost: "20U",
        members: [
          { name: "成员A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "" },
          { name: "成员B", email: "b@example.com", price: 120, joinedAt: "2026-06-01", leftAt: "" },
        ],
        profit: 0,
        status: "active",
        notes: [],
      },
    ]);
    const mailer = {
      isConfigured: () => true,
      sendRenewalReminder: async (message) => {
        sent.push(message);
      },
    };

    const first = await runDailyRenewalScan({
      store: accountStore,
      reminderHistoryStore: historyStore,
      mailer,
      today: "2026-06-28",
      daysAhead: 3,
      to: "jht19950420@gmail.com",
    });
    const second = await runDailyRenewalScan({
      store: accountStore,
      reminderHistoryStore: historyStore,
      mailer,
      today: "2026-06-28",
      daysAhead: 3,
      to: "jht19950420@gmail.com",
    });

    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
    assert.equal(second.skipped, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "jht19950420@gmail.com");
    assert.match(sent[0].text, /成员A/);
    assert.match(sent[0].text, /a@example\.com/);
    assert.match(sent[0].text, /¥100/);
    assert.match(sent[0].text, /成员B/);
    assert.match(sent[0].text, /b@example\.com/);
    assert.match(sent[0].text, /¥120/);
    assert.deepEqual(
      (await historyStore.list()).map((record) => record.cycleKey),
      ["bus-1:2026-07-01"]
    );
  });
});
