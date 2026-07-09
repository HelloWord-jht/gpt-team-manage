import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMonthlySnapshot,
  snapshotMetadata,
  upsertMonthlySnapshot,
} from "../src/domain/monthlySnapshots.js";

describe("monthly snapshots", () => {
  it("freezes month totals, lifecycle events, and payment status", () => {
    const snapshot = buildMonthlySnapshot(
      [
        {
          id: "demo",
          email: "demo@example.com",
          openedAt: "2026-06-01",
          region: "美国",
          cost: "20U",
          members: [
            {
              name: "A",
              email: "a@example.com",
              price: 100,
              joinedAt: "2026-06-01",
              leftAt: "2026-06-30",
              paymentStatus: "paid",
            },
            {
              name: "B",
              email: "b@example.com",
              price: 120,
              joinedAt: "2026-07-02",
              leftAt: "",
              paymentStatus: "unpaid",
            },
            {
              name: "C",
              email: "c@example.com",
              price: 80,
              joinedAt: "2026-06-10",
              leftAt: "2026-07-05",
              paymentStatus: "partial",
            },
          ],
          profit: 0,
          status: "active",
          notes: [],
          exchangeRate: { currency: "USD", date: "2026-06-01", rateToCny: 7, source: "test" },
        },
      ],
      {
        month: "2026-07",
        today: "2026-07-01",
        generatedAt: "2026-07-31T16:00:00.000Z",
      }
    );

    assert.equal(snapshot.month, "2026-07");
    assert.equal(snapshot.generatedAt, "2026-07-31T16:00:00.000Z");
    assert.equal(snapshot.accounts.length, 1);
    assert.equal(snapshot.accounts[0].members.length, 2);
    assert.equal(snapshot.totals.revenueCny, 200);
    assert.equal(snapshot.totals.costCny, 140);
    assert.equal(snapshot.totals.profitCny, 60);
    assert.equal(snapshot.totals.receivableCny, 200);
    assert.deepEqual(snapshot.totals.paymentCounts, {
      unpaid: 1,
      partial: 1,
      paid: 0,
      refunded: 0,
    });
    assert.deepEqual(snapshot.events.joined.map((event) => event.memberName), ["B"]);
    assert.deepEqual(snapshot.events.left.map((event) => event.memberName), ["C"]);
    assert.deepEqual(snapshotMetadata(snapshot), {
      month: "2026-07",
      generatedAt: "2026-07-31T16:00:00.000Z",
      revenueCny: 200,
      costCny: 140,
      profitCny: 60,
      receivableCny: 200,
      accountCount: 1,
      activeMembers: 2,
    });
  });

  it("upserts snapshots without overwriting unless requested", () => {
    const existing = { month: "2026-07", generatedAt: "old", totals: {} };
    const replacement = { month: "2026-07", generatedAt: "new", totals: {} };

    const kept = upsertMonthlySnapshot([existing], replacement, { overwrite: false });
    const replaced = upsertMonthlySnapshot([existing], replacement, { overwrite: true });

    assert.equal(kept.snapshot.generatedAt, "old");
    assert.equal(kept.updated, false);
    assert.equal(replaced.snapshot.generatedAt, "new");
    assert.equal(replaced.updated, true);
  });
});
