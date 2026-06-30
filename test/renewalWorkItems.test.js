import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRenewalWorkItems } from "../src/domain/renewalWorkItems.js";

const accounts = [
  {
    id: "demo",
    email: "owner@example.com",
    openedAt: "2026-06-02",
    region: "US",
    cost: "20U",
    members: [
      { name: "Member A", email: "a@example.com", price: 100, joinedAt: "2026-06-02", leftAt: "" },
      { name: "Member B", email: "b@example.com", price: 120, joinedAt: "2026-06-02", leftAt: "" },
    ],
    profit: 0,
    status: "active",
    notes: [],
  },
];

test("joins reminder history and handled actions into the current renewal cycle", () => {
  const reminderHistory = [
    { cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T01:00:00.000Z" },
  ];
  const actions = [
    { cycleKey: "demo:2026-07-02", handledAt: "2026-06-30T02:00:00.000Z" },
  ];
  const sourceSnapshot = structuredClone({ accounts, reminderHistory, actions });

  const result = buildRenewalWorkItems(accounts, {
    today: "2026-06-30",
    daysAhead: 3,
    reminderHistory,
    actions,
  });

  assert.equal(result.all.length, 1);
  assert.equal(result.pending.length, 0);
  assert.equal(result.all[0].totalPrice, 220);
  assert.equal(result.all[0].sentAt, "2026-06-30T01:00:00.000Z");
  assert.equal(result.all[0].handledAt, "2026-06-30T02:00:00.000Z");
  assert.deepEqual({ accounts, reminderHistory, actions }, sourceSnapshot);
});

test("does not carry a handled action into a later renewal cycle", () => {
  const result = buildRenewalWorkItems(accounts, {
    today: "2026-07-30",
    actions: [
      { cycleKey: "demo:2026-07-02", handledAt: "2026-06-30T02:00:00.000Z" },
    ],
  });

  assert.equal(result.pending[0].cycleKey, "demo:2026-08-02");
  assert.equal(result.pending[0].handledAt, null);
});
