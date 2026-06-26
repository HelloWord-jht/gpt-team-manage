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

async function withServer(store, testFn) {
  const server = createServer(createApp({ store, publicDir: null }));
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
          members: [{ name: "成员A", price: 100 }],
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
          members: [{ name: "Alpha-GPT", price: 120 }],
          profit: 50,
          status: "active",
          notes: [],
        }),
      });
      const created = await createResponse.json();

      assert.equal(createResponse.status, 201);
      assert.equal(created.account.region, "日本");

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
});
