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

function makeAccount({ id, email, openedAt }) {
  return {
    id,
    email,
    openedAt,
    region: "US",
    cost: "20U",
    members: [
      {
        name: `${id} member`,
        email: `${id}@members.example.com`,
        price: 100,
        joinedAt: openedAt,
        leftAt: "",
      },
    ],
    profit: 0,
    status: "active",
    notes: [],
  };
}

test("sorts all items by renewal date then email and derives due memberships and counts", () => {
  const result = buildRenewalWorkItems(
    [
      makeAccount({ id: "later", email: "middle@example.com", openedAt: "2026-06-05" }),
      makeAccount({ id: "same-z", email: "zeta@example.com", openedAt: "2026-06-01" }),
      makeAccount({ id: "same-a", email: "alpha@example.com", openedAt: "2026-06-01" }),
    ],
    {
      today: "2026-06-30",
      daysAhead: 3,
      actions: [
        {
          cycleKey: "same-z:2026-07-01",
          handledAt: "2026-06-30T01:00:00.000Z",
        },
      ],
    }
  );

  assert.deepEqual(
    result.all.map((item) => [item.nextRenewalAt, item.email]),
    [
      ["2026-07-01", "alpha@example.com"],
      ["2026-07-01", "zeta@example.com"],
      ["2026-07-05", "middle@example.com"],
    ]
  );
  assert.deepEqual(result.due.map((item) => item.id), ["same-a", "same-z"]);
  assert.deepEqual(result.pending.map((item) => item.id), ["same-a"]);
  assert.deepEqual(result.counts, { all: 3, due: 2, pending: 1 });
});

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

test("selects duplicate records by chronological instant across ISO timestamp offsets", () => {
  const result = buildRenewalWorkItems(accounts, {
    today: "2026-06-30",
    reminderHistory: [
      { cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T02:00:00+02:00" },
      { cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T01:30:00Z" },
    ],
  });

  assert.equal(result.all[0].sentAt, "2026-06-30T01:30:00Z");
});

test("selects duplicate records by chronological instant across fractional precision", () => {
  const result = buildRenewalWorkItems(accounts, {
    today: "2026-06-30",
    actions: [
      { cycleKey: "demo:2026-07-02", handledAt: "2026-06-30T01:00:00Z" },
      { cycleKey: "demo:2026-07-02", handledAt: "2026-06-30T01:00:00.001Z" },
    ],
  });

  assert.equal(result.all[0].handledAt, "2026-06-30T01:00:00.001Z");
});

test("ignores impossible calendar timestamps when a valid record exists", () => {
  const result = buildRenewalWorkItems(accounts, {
    today: "2026-06-30",
    actions: [
      { cycleKey: "demo:2026-07-02", handledAt: "2026-02-28T23:00:00Z" },
      { cycleKey: "demo:2026-07-02", handledAt: "2026-02-30T23:00:00Z" },
    ],
  });

  assert.equal(result.all[0].handledAt, "2026-02-28T23:00:00Z");
});

test("selects duplicate records beyond millisecond fractional precision", () => {
  const result = buildRenewalWorkItems(accounts, {
    today: "2026-06-30",
    reminderHistory: [
      { cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T01:00:00.0001Z" },
      { cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T01:00:00.0002Z" },
    ],
  });

  assert.equal(result.all[0].sentAt, "2026-06-30T01:00:00.0002Z");
});

test("ignores malformed duplicate timestamps when a valid record exists", () => {
  const result = buildRenewalWorkItems(accounts, {
    today: "2026-06-30",
    reminderHistory: [
      { cycleKey: "demo:2026-07-02", sentAt: "not-a-timestamp" },
      { cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T01:00:00Z" },
    ],
    actions: [
      { cycleKey: "demo:2026-07-02", handledAt: "2026-06-30T02:00:00Z" },
      { cycleKey: "demo:2026-07-02", handledAt: "not-a-timestamp" },
    ],
  });

  assert.equal(result.all[0].sentAt, "2026-06-30T01:00:00Z");
  assert.equal(result.all[0].handledAt, "2026-06-30T02:00:00Z");
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

test("rounds renewal totals to the nearest cent", () => {
  const roundingAccount = structuredClone(accounts[0]);
  roundingAccount.members[0].price = 1;
  roundingAccount.members[1].price = 0.005;

  const result = buildRenewalWorkItems([roundingAccount], {
    today: "2026-06-30",
  });

  assert.equal(result.all[0].totalPrice, 1.01);
});
