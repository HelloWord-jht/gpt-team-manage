import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRenewalReminders,
  compareAccountsForDisplay,
  excelSerialToISO,
  filterAccounts,
  parseCost,
  projectAccountForMonth,
  normalizeLegacyRows,
  summarizeAccounts,
} from "../src/domain/teamBus.js";

const legacyRows = [
  ["账号", "开通日期", "地区", "成本", "成员1", "成员1价格", "成员2", "成员2价格", "利润"],
  ["df132df@163.com", 46174, "美国", "20U", "王顺泽", 100, "袁晶晶", 100, 64],
  ["dds78jkf@163.com", 46175, "哥伦比亚", "72800COP", "Lucky Fish-GPT", 100, "陈年橘皮-GPT", 100, 58],
  ["kjf89sdb@163.com", 46176, "哥伦比亚", "72800COP", "万能元元-GPT", 100, "WE ll-GPT", 90, 48],
  [null, null, null, null, null, null, null, null, null],
  ["jht19950420+gpt@gmail.com", 46191, "法国", "15.01欧", "已封号", "已退款", null, null, null],
  ["benjazo2291@gmail.com", 46176, "哥伦比亚", "72800COP", "谷歌邮箱被封急需退订", "已退订已退款", null, null, null],
  ["jht19950420+flb@gmail.com", 46195, "菲律宾", "1,201PHP", "wc-GPT", 120, "Manchi-GPT", 100, 80],
  [null, null, null, null, null, null, null, null, 250],
];

describe("team bus domain", () => {
  it("converts Excel serial dates to ISO calendar dates", () => {
    assert.equal(excelSerialToISO(46174), "2026-06-01");
    assert.equal(excelSerialToISO(46195), "2026-06-22");
  });

  it("normalizes legacy worksheet rows and skips blanks plus total footer", () => {
    const accounts = normalizeLegacyRows(legacyRows);

    assert.equal(accounts.length, 6);
    assert.deepEqual(accounts[0], {
      id: "df132df-163-com-2026-06-01",
      email: "df132df@163.com",
      openedAt: "2026-06-01",
      region: "美国",
      cost: "20U",
      members: [
        { name: "王顺泽", email: "", price: 100, joinedAt: "2026-06-01", leftAt: "" },
        { name: "袁晶晶", email: "", price: 100, joinedAt: "2026-06-01", leftAt: "" },
      ],
      profit: 64,
      status: "active",
      notes: [],
    });

    assert.equal(accounts[3].status, "blocked");
    assert.deepEqual(accounts[3].notes, ["已封号", "已退款"]);
    assert.equal(accounts[4].status, "canceled");
    assert.deepEqual(accounts[4].notes, ["谷歌邮箱被封急需退订", "已退订已退款"]);
  });

  it("summarizes totals, regions, statuses, and slot usage", () => {
    const summary = summarizeAccounts(normalizeLegacyRows(legacyRows));

    assert.equal(summary.totalAccounts, 6);
    assert.equal(summary.activeAccounts, 4);
    assert.equal(summary.issueAccounts, 2);
    assert.equal(summary.totalProfit, 250);
    assert.equal(summary.usedSlots, 8);
    assert.equal(summary.totalSlots, 12);
    assert.deepEqual(summary.statuses, [
      { key: "active", label: "正常", count: 4 },
      { key: "blocked", label: "封号", count: 1 },
      { key: "canceled", label: "已退订", count: 1 },
      { key: "refunded", label: "已退款", count: 0 },
    ]);
    assert.deepEqual(summary.regions, [
      { region: "哥伦比亚", count: 3, profit: 106 },
      { region: "美国", count: 1, profit: 64 },
      { region: "菲律宾", count: 1, profit: 80 },
      { region: "法国", count: 1, profit: 0 },
    ]);
  });

  it("filters by status, region, and fuzzy account/member text", () => {
    const accounts = normalizeLegacyRows(legacyRows);

    assert.equal(filterAccounts(accounts, { status: "active" }).length, 4);
    assert.equal(filterAccounts(accounts, { region: "哥伦比亚" }).length, 3);
    assert.equal(filterAccounts(accounts, { query: "橘皮" }).length, 1);
    assert.equal(filterAccounts(accounts, { query: "退订", status: "canceled" }).length, 1);
  });

  it("parses payment currency costs from legacy raw strings", () => {
    assert.deepEqual(parseCost("20U"), { raw: "20U", amount: 20, currency: "USD" });
    assert.deepEqual(parseCost("72800COP"), { raw: "72800COP", amount: 72800, currency: "COP" });
    assert.deepEqual(parseCost("15.01欧"), { raw: "15.01欧", amount: 15.01, currency: "EUR" });
    assert.deepEqual(parseCost("3850JPY"), { raw: "3850JPY", amount: 3850, currency: "JPY" });
    assert.deepEqual(parseCost("1,201PHP"), { raw: "1,201PHP", amount: 1201, currency: "PHP" });
  });

  it("projects accounts by month with member lifecycle and real RMB cost", () => {
    const account = {
      id: "demo",
      email: "owner@example.com",
      openedAt: "2026-06-01",
      region: "美国",
      cost: "20U",
      members: [
        { name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "2026-06-30" },
        { name: "B", email: "b@example.com", price: 110, joinedAt: "2026-07-01", leftAt: "" },
      ],
      profit: 64,
      status: "active",
      notes: [],
      exchangeRate: { currency: "USD", date: "2026-06-01", rateToCny: 7.1, source: "test" },
    };

    const june = projectAccountForMonth(account, "2026-06");
    const july = projectAccountForMonth(account, "2026-07");

    assert.equal(june.activeMembers.length, 1);
    assert.equal(june.activeMembers[0].email, "a@example.com");
    assert.equal(june.costCny, 142);
    assert.equal(june.revenueCny, 100);
    assert.equal(june.computedProfitCny, -42);

    assert.equal(july.activeMembers.length, 1);
    assert.equal(july.activeMembers[0].email, "b@example.com");
    assert.equal(july.revenueCny, 110);
  });

  it("filters account list by selected month", () => {
    const accounts = [
      {
        id: "june",
        email: "june@example.com",
        openedAt: "2026-06-01",
        region: "美国",
        cost: "20U",
        members: [{ name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "2026-06-30" }],
        profit: 0,
        status: "active",
        notes: [],
      },
      {
        id: "july",
        email: "july@example.com",
        openedAt: "2026-07-01",
        region: "日本",
        cost: "3850JPY",
        members: [{ name: "B", email: "b@example.com", price: 120, joinedAt: "2026-07-01", leftAt: "" }],
        profit: 0,
        status: "active",
        notes: [],
      },
    ];

    assert.deepEqual(filterAccounts(accounts, { month: "2026-06" }).map((account) => account.id), ["june"]);
    assert.deepEqual(filterAccounts(accounts, { month: "2026-07" }).map((account) => account.id), ["july"]);
  });

  it("builds renewal reminders from opened day and member emails", () => {
    const reminders = buildRenewalReminders(
      [
        {
          id: "demo",
          email: "owner@example.com",
          openedAt: "2026-06-22",
          region: "菲律宾",
          cost: "1,201PHP",
          members: [
            { name: "wc-GPT", email: "wc@example.com", price: 120, joinedAt: "2026-06-22", leftAt: "" },
          ],
          status: "active",
          notes: [],
        },
      ],
      { today: "2026-07-20", daysAhead: 3 }
    );

    assert.equal(reminders.length, 1);
    assert.equal(reminders[0].nextRenewalAt, "2026-07-22");
    assert.equal(reminders[0].daysLeft, 2);
    assert.equal(reminders[0].cycleKey, "demo:2026-07-22");
    assert.equal(reminders[0].memberEmails[0], "wc@example.com");

    const skipped = buildRenewalReminders(
      [
        {
          id: "demo",
          email: "owner@example.com",
          openedAt: "2026-06-22",
          region: "菲律宾",
          cost: "1,201PHP",
          members: [
            { name: "wc-GPT", email: "wc@example.com", price: 120, joinedAt: "2026-06-22", leftAt: "" },
          ],
          status: "active",
          notes: [],
        },
      ],
      { today: "2026-07-20", daysAhead: 3, sentKeys: ["demo:2026-07-22"] }
    );

    assert.equal(skipped.length, 0);
  });

  it("projects next renewal countdown and sorts due accounts before normal active accounts", () => {
    const dueSoon = projectAccountForMonth(
      {
        id: "due",
        email: "due@example.com",
        openedAt: "2026-06-01",
        region: "美国",
        cost: "20U",
        members: [{ name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "" }],
        profit: 0,
        status: "active",
        notes: [],
      },
      "2026-06",
      { today: "2026-06-29" }
    );
    const normal = projectAccountForMonth(
      {
        id: "normal",
        email: "normal@example.com",
        openedAt: "2026-06-15",
        region: "日本",
        cost: "3850JPY",
        members: [{ name: "B", email: "b@example.com", price: 120, joinedAt: "2026-06-15", leftAt: "" }],
        profit: 0,
        status: "active",
        notes: [],
      },
      "2026-06",
      { today: "2026-06-29" }
    );
    const canceled = projectAccountForMonth(
      {
        id: "canceled",
        email: "canceled@example.com",
        openedAt: "2026-06-01",
        region: "法国",
        cost: "15.01欧",
        members: [],
        profit: 0,
        status: "canceled",
        notes: [],
      },
      "2026-06",
      { today: "2026-06-29" }
    );

    assert.deepEqual(dueSoon.renewal, {
      nextRenewalAt: "2026-07-01",
      daysLeft: 2,
      isDueSoon: true,
    });
    assert.equal(normal.renewal.isDueSoon, false);
    assert.deepEqual([canceled, normal, dueSoon].sort(compareAccountsForDisplay).map((account) => account.id), [
      "due",
      "normal",
      "canceled",
    ]);
  });
}
);
