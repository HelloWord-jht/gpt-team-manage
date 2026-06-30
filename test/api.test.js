import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, it } from "node:test";

import { createApp } from "../src/http/app.js";
import { JsonStoreCorruptionError } from "../src/store/jsonStore.js";

const FIXED_NOW = "2026-06-30T04:00:00.000Z";

function memoryStore(seed = []) {
  let records = structuredClone(seed);
  let updateQueue = Promise.resolve();

  return {
    async list() {
      return structuredClone(records);
    },
    async replace(nextRecords) {
      await new Promise((resolve) => setImmediate(resolve));
      records = structuredClone(nextRecords);
    },
    update(mutator) {
      const operation = updateQueue.then(async () => {
        const currentRecords = structuredClone(records);
        const result = await mutator(currentRecords);
        records = structuredClone(result === undefined ? currentRecords : result);
        return structuredClone(records);
      });

      updateQueue = operation.then(
        () => undefined,
        () => undefined
      );
      return operation;
    },
  };
}

function fixedNow() {
  return new Date(FIXED_NOW);
}

function renewalAccount(overrides = {}) {
  const openedAt = overrides.openedAt || "2026-06-02";

  return {
    id: "renewal-demo",
    email: "owner@example.com",
    openedAt,
    region: "美国",
    cost: "20U",
    members: [
      {
        name: "Renewal Member",
        email: "member@example.com",
        price: 120,
        joinedAt: openedAt,
        leftAt: "",
      },
    ],
    profit: 0,
    status: "active",
    notes: [],
    ...overrides,
  };
}

async function withServer(store, testFn, options = {}) {
  const server = createServer(createApp({ store, publicDir: null, ...options }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    await testFn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}

describe("team bus API", () => {
  it("serves accounts with summary data", async () => {
    await withServer(
      memoryStore([
        {
          id: "demo",
          email: "demo@example.com",
          openedAt: "2026-06-01",
          region: "美国",
          cost: "20U",
          members: [{ name: "成员A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "" }],
          profit: 64,
          status: "active",
          notes: [],
        },
      ]),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.accounts.length, 1);
        assert.equal(payload.summary.totalProfit, 64);
      }
    );
  });

  it("creates, updates, and deletes an account through JSON endpoints", async () => {
    await withServer(memoryStore(), async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "new@example.com",
          openedAt: "2026-06-20",
          region: "日本",
          cost: "3850JPY",
          members: [{ name: "Alpha-GPT", email: "alpha@example.com", price: 120, joinedAt: "2026-06-20", leftAt: "" }],
          profit: 50,
          status: "active",
          notes: [],
        }),
      });
      const created = await createResponse.json();

      assert.equal(createResponse.status, 201);
      assert.equal(created.account.region, "日本");
      assert.equal(created.account.members[0].email, "alpha@example.com");

      const updateResponse = await fetch(`${baseUrl}/api/accounts/${created.account.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...created.account, profit: 75, notes: ["补差价"] }),
      });
      const updated = await updateResponse.json();

      assert.equal(updateResponse.status, 200);
      assert.equal(updated.account.profit, 75);
      assert.deepEqual(updated.account.notes, ["补差价"]);

      const deleteResponse = await fetch(`${baseUrl}/api/accounts/${created.account.id}`, {
        method: "DELETE",
      });

      assert.equal(deleteResponse.status, 204);

      const finalResponse = await fetch(`${baseUrl}/api/accounts`);
      const finalPayload = await finalResponse.json();

      assert.equal(finalPayload.accounts.length, 0);
    });
  });

  it("rejects invalid account payloads with actionable errors", async () => {
    await withServer(memoryStore(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email", region: "" }),
      });
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.match(payload.error, /账号邮箱/);
      assert.match(payload.error, /地区/);
    });
  });

  it("serves month-scoped account projections", async () => {
    await withServer(
      memoryStore([
        {
          id: "demo",
          email: "demo@example.com",
          openedAt: "2026-06-01",
          region: "美国",
          cost: "20U",
          members: [
            { name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "2026-06-30" },
            { name: "B", email: "b@example.com", price: 120, joinedAt: "2026-07-01", leftAt: "" },
          ],
          profit: 64,
          status: "active",
          notes: [],
        },
      ]),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/accounts?month=2026-07`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.month, "2026-07");
        assert.equal(payload.accounts.length, 1);
        assert.equal(payload.accounts[0].activeMembers.length, 1);
        assert.equal(payload.accounts[0].activeMembers[0].email, "b@example.com");
      },
      {
        exchangeRates: {
          async attachRates(accounts) {
            return accounts.map((account) => ({
              ...account,
              exchangeRate: { currency: "USD", date: "2026-06-01", rateToCny: 7, source: "test" },
            }));
          },
        },
      }
    );
  });

  it("sends renewal reminders through injected mailer", async () => {
    const sent = [];
    const reminderHistoryStore = memoryStore();

    await withServer(
      memoryStore([
        {
          id: "demo",
          email: "demo@example.com",
          openedAt: "2026-06-22",
          region: "菲律宾",
          cost: "1,201PHP",
          members: [{ name: "wc-GPT", email: "wc@example.com", price: 120, joinedAt: "2026-06-22", leftAt: "" }],
          profit: 80,
          status: "active",
          notes: [],
        },
      ]),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/reminders/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ today: "2026-07-20", daysAhead: 3, to: "jht19950420@gmail.com" }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.sent, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, "jht19950420@gmail.com");
        assert.equal(sent[0].subject, "Team Bus 待续费清单 - 2026-07-22");
        assert.match(sent[0].text, /2026-07-22/);
        assert.match(sent[0].text, /待续费人员/);
        assert.match(sent[0].text, /wc-GPT/);
        assert.match(sent[0].text, /wc@example\.com/);
        assert.match(sent[0].text, /¥120/);

        const secondResponse = await fetch(`${baseUrl}/api/reminders/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ today: "2026-07-20", daysAhead: 3, to: "jht19950420@gmail.com" }),
        });
        const secondPayload = await secondResponse.json();

        assert.equal(secondResponse.status, 200);
        assert.equal(secondPayload.sent, 0);
        assert.equal(secondPayload.skipped, 1);
        assert.equal(sent.length, 1);
      },
      {
        reminderHistoryStore,
        mailer: {
          isConfigured: () => true,
          sendRenewalReminder: async (message) => {
            sent.push(message);
          },
        },
      }
    );
  });

  it("serves deterministic renewal work items joined with reminder history", async () => {
    const sentAt = "2026-06-30T01:00:00.000Z";
    const reminderHistoryStore = memoryStore([
      { cycleKey: "renewal-demo:2026-07-02", sentAt },
    ]);

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/renewals?month=2026-07&today=2026-06-30&daysAhead=invalid`
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.month, "2026-07");
        assert.deepEqual(payload.counts, { all: 1, due: 1, pending: 1 });
        assert.equal(payload.all[0].cycleKey, "renewal-demo:2026-07-02");
        assert.equal(payload.all[0].sentAt, sentAt);
        assert.equal(payload.all[0].handledAt, null);
      },
      { reminderHistoryStore }
    );
  });

  it("marks a renewal handled, replaces its prior action, and returns it in the list", async () => {
    const cycleKey = "renewal-demo:2026-07-02";
    const handledAt = "2026-06-30T08:30:00.000Z";
    const unrelatedAction = {
      cycleKey: "another-account:2026-07-01",
      handledAt: "2026-06-29T01:00:00.000Z",
    };
    const renewalActionStore = memoryStore([
      { cycleKey, handledAt: "2026-06-29T08:30:00.000Z" },
      unrelatedAction,
    ]);

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/renewals/${encodeURIComponent(cycleKey)}/handled`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ today: "2026-06-30", handledAt }),
          }
        );
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload.action, { cycleKey, handledAt });
        assert.deepEqual(await renewalActionStore.list(), [
          unrelatedAction,
          { cycleKey, handledAt },
        ]);

        const listResponse = await fetch(
          `${baseUrl}/api/renewals?month=2026-07&today=2026-06-30&daysAhead=3`
        );
        const listPayload = await listResponse.json();

        assert.equal(listResponse.status, 200);
        assert.deepEqual(listPayload.counts, { all: 1, due: 1, pending: 0 });
        assert.equal(listPayload.pending.length, 0);
        assert.equal(listPayload.all[0].handledAt, handledAt);
      },
      { renewalActionStore, now: fixedNow }
    );
  });

  it("defaults an omitted handledAt but rejects an explicitly invalid value", async () => {
    const cycleKey = "renewal-demo:2026-07-02";
    const renewalActionStore = memoryStore();

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const actionUrl = `${baseUrl}/api/renewals/${encodeURIComponent(cycleKey)}/handled`;
        const defaultResponse = await fetch(actionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ today: "2026-06-30" }),
        });
        const defaultPayload = await defaultResponse.json();

        assert.equal(defaultResponse.status, 200);
        assert.equal(
          new Date(defaultPayload.action.handledAt).toISOString(),
          defaultPayload.action.handledAt
        );
        assert.equal(defaultPayload.action.handledAt, FIXED_NOW);
        const actionsAfterDefault = await renewalActionStore.list();

        const invalidResponse = await fetch(actionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ today: "2026-06-30", handledAt: null }),
        });

        assert.equal(invalidResponse.status, 400);
        assert.deepEqual(await renewalActionStore.list(), actionsAfterDefault);
      },
      { renewalActionStore, now: fixedNow }
    );
  });

  it("deletes a handled action and restores the renewal to pending", async () => {
    const cycleKey = "renewal-demo:2026-07-02";
    const renewalActionStore = memoryStore([
      { cycleKey, handledAt: "2026-06-30T08:30:00.000Z" },
    ]);

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const actionUrl = `${baseUrl}/api/renewals/${encodeURIComponent(cycleKey)}/handled`;
        const response = await fetch(actionUrl, { method: "DELETE" });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload, { cycleKey, handled: false });
        assert.deepEqual(await renewalActionStore.list(), []);

        const listResponse = await fetch(
          `${baseUrl}/api/renewals?month=2026-07&today=2026-06-30&daysAhead=3`
        );
        const listPayload = await listResponse.json();

        assert.equal(listResponse.status, 200);
        assert.deepEqual(listPayload.counts, { all: 1, due: 1, pending: 1 });
        assert.equal(listPayload.pending[0].cycleKey, cycleKey);
        assert.equal(listPayload.all[0].handledAt, null);

        const missingResponse = await fetch(actionUrl, { method: "DELETE" });
        const missingPayload = await missingResponse.json();

        assert.equal(missingResponse.status, 404);
        assert.equal(missingPayload.error, "处理记录不存在");

        const postResponse = await fetch(actionUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handledAt: "2026-06-30T09:00:00.000Z" }),
        });
        const postPayload = await postResponse.json();

        assert.equal(postResponse.status, 200);
        assert.deepEqual(postPayload.action, {
          cycleKey,
          handledAt: "2026-06-30T09:00:00.000Z",
        });
        assert.deepEqual(await renewalActionStore.list(), [postPayload.action]);
      },
      { renewalActionStore, now: fixedNow }
    );
  });

  it("rejects invalid renewal actions without writing", async () => {
    const existingAction = {
      cycleKey: "another-account:2026-07-01",
      handledAt: "2026-06-29T01:00:00.000Z",
    };
    const renewalActionStore = memoryStore([existingAction]);

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const missingResponse = await fetch(
          `${baseUrl}/api/renewals/${encodeURIComponent("missing:2026-07-02")}/handled`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              today: "2026-06-30",
              handledAt: "2026-06-30T08:30:00.000Z",
            }),
          }
        );
        const missingPayload = await missingResponse.json();

        assert.equal(missingResponse.status, 404);
        assert.equal(missingPayload.error, "续费周期不存在");
        assert.deepEqual(await renewalActionStore.list(), [existingAction]);

        const invalidResponse = await fetch(
          `${baseUrl}/api/renewals/${encodeURIComponent("renewal-demo:2026-07-02")}/handled`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              today: "2026-06-30",
              handledAt: "2026-06-30T16:30:00+08:00",
            }),
          }
        );
        const invalidPayload = await invalidResponse.json();

        assert.equal(invalidResponse.status, 400);
        assert.match(invalidPayload.error, /handledAt/);
        assert.match(invalidPayload.error, /UTC/);
        assert.deepEqual(await renewalActionStore.list(), [existingAction]);
      },
      { renewalActionStore, now: fixedNow }
    );
  });

  it("returns 503 when renewal action persistence is unavailable", async () => {
    const cycleKey = encodeURIComponent("renewal-demo:2026-07-02");

    await withServer(memoryStore([renewalAccount()]), async (baseUrl) => {
      const postResponse = await fetch(`${baseUrl}/api/renewals/${cycleKey}/handled`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ today: "2026-06-30" }),
      });
      const deleteResponse = await fetch(`${baseUrl}/api/renewals/${cycleKey}/handled`, {
        method: "DELETE",
      });

      assert.equal(postResponse.status, 503);
      assert.equal(deleteResponse.status, 503);
    });
  });

  it("derives omitted renewal dates and month from the injected Shanghai clock", async () => {
    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/renewals`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.month, "2026-07");
        assert.equal(payload.all[0].cycleKey, "renewal-demo:2026-07-02");
        assert.equal(payload.all[0].daysLeft, 1);
      },
      { now: () => new Date("2026-06-30T16:30:00.000Z") }
    );
  });

  it("rejects invalid renewal query dates without changing actions", async () => {
    const existingAction = {
      cycleKey: "renewal-demo:2026-07-02",
      handledAt: "2026-06-30T08:30:00.000Z",
    };
    const renewalActionStore = memoryStore([existingAction]);

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const invalidTodayResponse = await fetch(
          `${baseUrl}/api/renewals?today=2026-02-30`
        );
        const invalidTodayPayload = await invalidTodayResponse.json();
        const invalidMonthResponse = await fetch(
          `${baseUrl}/api/renewals?today=2026-06-30&month=2026-13`
        );
        const invalidMonthPayload = await invalidMonthResponse.json();

        assert.equal(invalidTodayResponse.status, 400);
        assert.equal(invalidTodayPayload.error, "today 必须是有效的 YYYY-MM-DD 日期");
        assert.equal(invalidMonthResponse.status, 400);
        assert.equal(invalidMonthPayload.error, "month 必须是有效的 YYYY-MM 月份");
        assert.deepEqual(await renewalActionStore.list(), [existingAction]);
      },
      { renewalActionStore, now: fixedNow }
    );
  });

  it("rejects a future renewal cycle even when the POST body supplies a future date", async () => {
    const renewalActionStore = memoryStore();
    const futureCycleKey = "renewal-demo:2026-08-02";

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/renewals/${encodeURIComponent(futureCycleKey)}/handled`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              today: "2026-07-30",
              handledAt: "2026-06-30T08:30:00.000Z",
            }),
          }
        );
        const payload = await response.json();

        assert.equal(response.status, 404);
        assert.equal(payload.error, "续费周期不存在");
        assert.deepEqual(await renewalActionStore.list(), []);
      },
      { renewalActionStore, now: fixedNow }
    );
  });

  it("rejects deleting a stale handled cycle without changing actions", async () => {
    const staleAction = {
      cycleKey: "renewal-demo:2026-07-02",
      handledAt: "2026-06-30T08:30:00.000Z",
    };
    const renewalActionStore = memoryStore([staleAction]);

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/renewals/${encodeURIComponent(staleAction.cycleKey)}/handled`,
          { method: "DELETE" }
        );
        const payload = await response.json();

        assert.equal(response.status, 404);
        assert.equal(payload.error, "续费周期不存在");
        assert.deepEqual(await renewalActionStore.list(), [staleAction]);
      },
      {
        renewalActionStore,
        now: () => new Date("2026-07-30T04:00:00.000Z"),
      }
    );
  });

  it("persists concurrent marks for two current renewal cycles", async () => {
    const renewalActionStore = memoryStore();
    const accounts = [
      renewalAccount({ id: "renewal-one", email: "one@example.com" }),
      renewalAccount({ id: "renewal-two", email: "two@example.com" }),
    ];
    const marks = [
      {
        cycleKey: "renewal-one:2026-07-02",
        handledAt: "2026-06-30T08:30:00.000Z",
      },
      {
        cycleKey: "renewal-two:2026-07-02",
        handledAt: "2026-06-30T08:31:00.000Z",
      },
    ];

    await withServer(
      memoryStore(accounts),
      async (baseUrl) => {
        const responses = await Promise.all(
          marks.map(({ cycleKey, handledAt }) =>
            fetch(`${baseUrl}/api/renewals/${encodeURIComponent(cycleKey)}/handled`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ handledAt }),
            })
          )
        );

        assert.deepEqual(
          responses.map((response) => response.status),
          [200, 200]
        );
        assert.deepEqual(
          (await renewalActionStore.list()).sort((a, b) =>
            a.cycleKey.localeCompare(b.cycleKey)
          ),
          marks
        );
      },
      { renewalActionStore, now: fixedNow }
    );
  });

  it("logs corrupt store errors and returns an actionable safe response", async () => {
    const corruptionError = new JsonStoreCorruptionError(
      "/private/data/team-bus.json",
      "invalid JSON"
    );
    const logged = [];
    const corruptStore = {
      async list() {
        throw corruptionError;
      },
    };

    await withServer(
      corruptStore,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/renewals?today=2026-06-30`);
        const payload = await response.json();

        assert.equal(response.status, 500);
        assert.equal(
          payload.error,
          "数据文件损坏，请检查服务器数据文件并恢复为有效的 JSON 数组"
        );
        assert.equal(logged.length, 1);
        assert.ok(logged[0].includes(corruptionError));
      },
      {
        logger: {
          error(...args) {
            logged.push(args);
          },
        },
        now: fixedNow,
      }
    );
  });

  it("returns 400 for malformed path encoding without changing actions", async () => {
    const existingAction = {
      cycleKey: "renewal-demo:2026-07-02",
      handledAt: "2026-06-30T08:30:00.000Z",
    };
    const renewalActionStore = memoryStore([existingAction]);

    await withServer(
      memoryStore([renewalAccount()]),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/renewals/%E0%A4%A/handled`, {
          method: "DELETE",
        });
        const payload = await response.json();

        assert.equal(response.status, 400);
        assert.equal(payload.error, "路径参数编码不正确");
        assert.deepEqual(await renewalActionStore.list(), [existingAction]);
      },
      { renewalActionStore, now: fixedNow }
    );
  });
});
