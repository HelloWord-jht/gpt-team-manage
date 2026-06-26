import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { describe, it } from "node:test";

import { createApp } from "../src/http/app.js";

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
          body: JSON.stringify({ today: "2026-07-20", daysAhead: 3 }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.sent, 1);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].subject, "Team Bus 账号续期确认 - 2026-07-22");
        assert.match(sent[0].text, /2026-07-22/);
        assert.match(sent[0].text, /账号名称：demo@example\.com/);
        assert.match(sent[0].text, /成员上车日期：2026-06-22/);
        assert.match(sent[0].text, /如需下车，请在续期日前联系车主。/);
        assert.doesNotMatch(sent[0].text, /核对当月收款与成本/);
        assert.doesNotMatch(sent[0].text, /这是一封由你的 Team Bus 管理台发送的账户周期通知/);
      },
      {
        mailer: {
          isConfigured: () => true,
          sendRenewalReminder: async (message) => {
            sent.push(message);
          },
        },
      }
    );
  });
});
