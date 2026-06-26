import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  excelSerialToISO,
  filterAccounts,
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
        { name: "王顺泽", price: 100 },
        { name: "袁晶晶", price: 100 },
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
}
);
