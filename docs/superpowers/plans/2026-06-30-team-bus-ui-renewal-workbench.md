# Team Bus UI And Renewal Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the account drawer with nested modal editing, refresh the full management UI, and add a persistent renewal workbench with sent and handled status.

**Architecture:** Keep the existing Node HTTP server and JSON stores. Add a pure renewal-work-item domain module and a separate action store, expose small JSON endpoints, then refactor the static ES module frontend around explicit account and member drafts. CSS remains framework-free and is rebuilt around semantic design tokens and dialog layers.

**Tech Stack:** Node.js 20, `node:test`, native HTTP server, JSON file stores, browser ES modules, HTML, CSS, Docker.

---

## File Map

- Create `src/domain/renewalWorkItems.js`: derive workbench rows from accounts, reminder history, and handled records.
- Create `public/accountDraft.js`: pure account/member draft helpers that can be tested in Node.
- Create `test/renewalWorkItems.test.js`: renewal workbench domain behavior.
- Create `test/accountDraft.test.js`: nested member editor draft behavior.
- Modify `src/http/app.js`: renewal list, mark-handled, and undo endpoints.
- Modify `src/server.js`: instantiate and inject `renewalActionStore`.
- Modify `test/api.test.js`: endpoint and persistence coverage.
- Modify `public/index.html`: top bar, account modal, member modal, renewal workbench, and delete confirmation.
- Modify `public/app.js`: modal stack, draft editing, workbench requests, and refreshed rendering.
- Modify `public/styles.css`: complete “clean operations console” visual system and responsive behavior.
- Modify `.gitignore`: ignore runtime renewal action data.
- Modify `README.md`: document the renewal workbench and persisted runtime files.

### Task 1: Renewal Work Item Domain

**Files:**
- Create: `src/domain/renewalWorkItems.js`
- Create: `test/renewalWorkItems.test.js`

- [ ] **Step 1: Write the failing work-item projection test**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRenewalWorkItems } from "../src/domain/renewalWorkItems.js";

const account = {
  id: "demo",
  email: "owner@example.com",
  openedAt: "2026-06-02",
  region: "美国",
  cost: "20U",
  members: [
    { name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-02", leftAt: "" },
    { name: "B", email: "b@example.com", price: 120, joinedAt: "2026-06-02", leftAt: "" },
  ],
  status: "active",
  notes: [],
};

describe("renewal work items", () => {
  it("joins sent and handled state without changing renewal data", () => {
    const result = buildRenewalWorkItems([account], {
      today: "2026-06-30",
      daysAhead: 3,
      reminderHistory: [{ cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T01:00:00.000Z" }],
      actions: [{ cycleKey: "demo:2026-07-02", handledAt: "2026-06-30T02:00:00.000Z" }],
    });

    assert.equal(result.all.length, 1);
    assert.equal(result.pending.length, 0);
    assert.equal(result.all[0].totalPrice, 220);
    assert.equal(result.all[0].sentAt, "2026-06-30T01:00:00.000Z");
    assert.equal(result.all[0].handledAt, "2026-06-30T02:00:00.000Z");
  });

  it("creates a fresh pending item for the next renewal cycle", () => {
    const result = buildRenewalWorkItems([account], {
      today: "2026-07-30",
      daysAhead: 3,
      actions: [{ cycleKey: "demo:2026-07-02", handledAt: "2026-06-30T02:00:00.000Z" }],
    });

    assert.equal(result.pending[0].cycleKey, "demo:2026-08-02");
    assert.equal(result.pending[0].handledAt, null);
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test test/renewalWorkItems.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/domain/renewalWorkItems.js`.

- [ ] **Step 3: Implement the pure work-item projection**

```js
import { buildRenewalReminders } from "./teamBus.js";

const MAX_CYCLE_DAYS = 31;

export function buildRenewalWorkItems(accounts, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const daysAhead = Number.isFinite(Number(options.daysAhead)) ? Number(options.daysAhead) : 3;
  const sentByKey = latestByCycle(options.reminderHistory || [], "sentAt");
  const handledByKey = latestByCycle(options.actions || [], "handledAt");

  const all = buildRenewalReminders(accounts, { today, daysAhead: MAX_CYCLE_DAYS })
    .map((reminder) => ({
      ...reminder,
      totalPrice: roundMoney(reminder.members.reduce((sum, member) => sum + Number(member.price || 0), 0)),
      sentAt: sentByKey.get(reminder.cycleKey)?.sentAt || null,
      handledAt: handledByKey.get(reminder.cycleKey)?.handledAt || null,
    }))
    .sort((a, b) => a.nextRenewalAt.localeCompare(b.nextRenewalAt) || a.email.localeCompare(b.email));

  const due = all.filter((item) => item.daysLeft >= 0 && item.daysLeft <= daysAhead);
  const pending = due.filter((item) => !item.handledAt);

  return {
    all,
    due,
    pending,
    counts: { all: all.length, due: due.length, pending: pending.length },
  };
}

function latestByCycle(records, dateField) {
  const result = new Map();
  for (const record of records) {
    if (!record?.cycleKey || !record?.[dateField]) continue;
    const current = result.get(record.cycleKey);
    if (!current || current[dateField] < record[dateField]) result.set(record.cycleKey, record);
  }
  return result;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
```

- [ ] **Step 4: Run domain tests and verify GREEN**

Run: `node --test test/renewalWorkItems.test.js test/teamBus.test.js test/reminders.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit the domain slice**

```bash
git add src/domain/renewalWorkItems.js test/renewalWorkItems.test.js
git commit -m "Add renewal workbench projection"
```

### Task 2: Renewal Workbench API And Persistence

**Files:**
- Modify: `src/http/app.js`
- Modify: `src/server.js`
- Modify: `test/api.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Add failing API tests for list, handle, and undo**

Add a test that injects `reminderHistoryStore` and `renewalActionStore`, requests a deterministic `today`, marks the returned encoded cycle key, and then undoes it:

```js
it("lists renewal work items and persists handled state", async () => {
  const actions = memoryStore();
  const history = memoryStore([
    { cycleKey: "demo:2026-07-02", sentAt: "2026-06-30T01:00:00.000Z" },
  ]);
  const accounts = memoryStore([renewalAccount({ id: "demo", openedAt: "2026-06-02" })]);

  await withServer(accounts, async (baseUrl) => {
    const listResponse = await fetch(`${baseUrl}/api/renewals?month=2026-06&today=2026-06-30`);
    const list = await listResponse.json();
    const cycleKey = list.pending[0].cycleKey;

    assert.equal(listResponse.status, 200);
    assert.equal(list.pending[0].sentAt, "2026-06-30T01:00:00.000Z");

    const handledResponse = await fetch(
      `${baseUrl}/api/renewals/${encodeURIComponent(cycleKey)}/handled`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ today: "2026-06-30", handledAt: "2026-06-30T02:00:00.000Z" }) }
    );
    assert.equal(handledResponse.status, 200);

    const handledList = await (await fetch(`${baseUrl}/api/renewals?month=2026-06&today=2026-06-30`)).json();
    assert.equal(handledList.pending.length, 0);
    assert.equal(handledList.all[0].handledAt, "2026-06-30T02:00:00.000Z");

    const undoResponse = await fetch(
      `${baseUrl}/api/renewals/${encodeURIComponent(cycleKey)}/handled`,
      { method: "DELETE" }
    );
    assert.equal(undoResponse.status, 200);

    const undoneList = await (await fetch(`${baseUrl}/api/renewals?month=2026-06&today=2026-06-30`)).json();
    assert.equal(undoneList.pending.length, 1);
  }, { reminderHistoryStore: history, renewalActionStore: actions });
});
```

Add a helper in the test file that returns a complete valid account:

```js
function renewalAccount(overrides = {}) {
  return {
    id: "demo",
    email: "demo@example.com",
    openedAt: "2026-06-02",
    region: "美国",
    cost: "20U",
    members: [{ name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-02", leftAt: "" }],
    profit: 0,
    status: "active",
    notes: [],
    ...overrides,
  };
}
```

- [ ] **Step 2: Run the API test and verify RED**

Run: `node --test test/api.test.js`

Expected: FAIL because `GET /api/renewals` returns 404.

- [ ] **Step 3: Inject the action store and route renewal requests**

Extend `createApp` with `renewalActionStore = null`. Add these routes before the generic `/api/` 404:

```js
if (url.pathname === "/api/renewals" && request.method === "GET") {
  return await handleListRenewals(response, store, reminderHistoryStore, renewalActionStore, url);
}

const handledMatch = url.pathname.match(/^\/api\/renewals\/([^/]+)\/handled$/);
if (handledMatch && request.method === "POST") {
  return await handleSetHandled(request, response, store, renewalActionStore, decodeURIComponent(handledMatch[1]));
}
if (handledMatch && request.method === "DELETE") {
  return await handleClearHandled(response, renewalActionStore, decodeURIComponent(handledMatch[1]));
}
```

Import `buildRenewalWorkItems` and add handlers:

```js
async function handleListRenewals(response, store, historyStore, actionStore, url) {
  const [accounts, reminderHistory, actions] = await Promise.all([
    store.list(),
    historyStore?.list?.() || [],
    actionStore?.list?.() || [],
  ]);
  const month = normalizeMonth(url.searchParams.get("month"));
  const today = normalizeDate(url.searchParams.get("today"));
  const daysAhead = Number(url.searchParams.get("daysAhead") ?? process.env.REMINDER_DAYS ?? 3);
  sendJson(response, 200, {
    month,
    ...buildRenewalWorkItems(accounts, { today, daysAhead, reminderHistory, actions }),
  });
}

async function handleSetHandled(request, response, store, actionStore, cycleKey) {
  if (!actionStore) return sendJson(response, 503, { error: "续费处理记录未配置" });
  const payload = await readJson(request);
  const accounts = await store.list();
  const valid = buildRenewalWorkItems(accounts, { today: payload.today || todayInChina() }).all
    .some((item) => item.cycleKey === cycleKey);
  if (!valid) return sendJson(response, 404, { error: "续费周期不存在" });

  const actions = (await actionStore.list()).filter((record) => record.cycleKey !== cycleKey);
  const record = { cycleKey, handledAt: payload.handledAt || new Date().toISOString() };
  await actionStore.replace([...actions, record]);
  sendJson(response, 200, { action: record });
}

async function handleClearHandled(response, actionStore, cycleKey) {
  if (!actionStore) return sendJson(response, 503, { error: "续费处理记录未配置" });
  const actions = await actionStore.list();
  const next = actions.filter((record) => record.cycleKey !== cycleKey);
  if (next.length === actions.length) return sendJson(response, 404, { error: "处理记录不存在" });
  await actionStore.replace(next);
  sendJson(response, 200, { cycleKey, handled: false });
}
```

- [ ] **Step 4: Instantiate persistent storage**

In `src/server.js`:

```js
const renewalActionStore = new JsonStore(path.join(rootDir, "data", "renewal-actions.json"));
const server = createServer(createApp({
  store,
  publicDir,
  exchangeRates,
  mailer,
  reminderHistoryStore,
  renewalActionStore,
}));
```

Add `data/renewal-actions.json` to `.gitignore`.

- [ ] **Step 5: Run API and complete test suite**

Run: `node --test test/api.test.js`

Expected: API tests pass.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit API and persistence**

```bash
git add src/http/app.js src/server.js test/api.test.js .gitignore
git commit -m "Add renewal workbench API"
```

### Task 3: Testable Account And Member Drafts

**Files:**
- Create: `public/accountDraft.js`
- Create: `test/accountDraft.test.js`

- [ ] **Step 1: Write failing draft-state tests**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAccountDraft,
  removeDraftMember,
  saveDraftMember,
} from "../public/accountDraft.js";

describe("account draft", () => {
  it("edits a cloned member without mutating the loaded account", () => {
    const account = {
      id: "demo",
      email: "demo@example.com",
      openedAt: "2026-06-01",
      members: [{ name: "A", email: "a@example.com", price: 100, joinedAt: "2026-06-01", leftAt: "" }],
    };
    const draft = createAccountDraft(account, "2026-06-30");
    const changed = saveDraftMember(draft, 0, { ...draft.members[0], name: "Changed" });

    assert.equal(account.members[0].name, "A");
    assert.equal(changed.members[0].name, "Changed");
  });

  it("adds and removes members immutably", () => {
    const draft = createAccountDraft(null, "2026-06-30");
    const added = saveDraftMember(draft, null, {
      name: "A",
      email: "a@example.com",
      price: 120,
      joinedAt: "2026-06-30",
      leftAt: "",
    });
    const removed = removeDraftMember(added, 0);

    assert.equal(draft.members.length, 0);
    assert.equal(added.members.length, 1);
    assert.equal(removed.members.length, 0);
  });
});
```

- [ ] **Step 2: Run the draft tests and verify RED**

Run: `node --test test/accountDraft.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `public/accountDraft.js`.

- [ ] **Step 3: Implement immutable draft helpers**

```js
export function createAccountDraft(account, today) {
  const openedAt = account?.openedAt || today;
  return {
    id: account?.id || "",
    email: account?.email || "",
    openedAt,
    status: account?.status || "active",
    region: account?.region || "",
    cost: account?.cost || "",
    profit: account?.profit ?? 0,
    notes: Array.isArray(account?.notes) ? [...account.notes] : [],
    members: (account?.members || []).map(cloneMember),
  };
}

export function saveDraftMember(draft, index, member) {
  const members = draft.members.map(cloneMember);
  if (Number.isInteger(index) && index >= 0 && index < members.length) {
    members[index] = cloneMember(member);
  } else {
    members.push(cloneMember(member));
  }
  return { ...draft, members };
}

export function removeDraftMember(draft, index) {
  return { ...draft, members: draft.members.filter((_, memberIndex) => memberIndex !== index).map(cloneMember) };
}

function cloneMember(member) {
  return {
    name: String(member?.name || ""),
    email: String(member?.email || ""),
    price: member?.price ?? "",
    joinedAt: String(member?.joinedAt || ""),
    leftAt: String(member?.leftAt || ""),
  };
}
```

- [ ] **Step 4: Run draft and full tests**

Run: `node --test test/accountDraft.test.js`

Expected: both tests pass.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 5: Commit draft helpers**

```bash
git add public/accountDraft.js test/accountDraft.test.js
git commit -m "Add account member draft state"
```

### Task 4: Replace Drawer With Modal Stack And Renewal Workbench

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Replace the drawer markup with four dialogs**

In `public/index.html`, remove `aside#drawer`. Add:

```html
<div class="modal-layer" id="accountModal" aria-hidden="true">
  <section class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="accountModalTitle">
    <header class="modal-header">
      <div><p class="eyebrow">Account</p><h2 id="accountModalTitle">新增账号</h2></div>
      <button class="icon-button ghost" id="closeAccountModalButton" type="button" aria-label="关闭账号弹框" title="关闭">
        <span aria-hidden="true" data-icon="close"></span>
      </button>
    </header>
    <form id="accountForm" class="account-form" autocomplete="off">
      <div class="modal-body">
        <input type="hidden" id="accountId" />
        <label class="form-span"><span>账号邮箱</span><input id="emailInput" type="email" required /></label>
        <div class="form-grid">
          <label><span>开通日期</span><input id="openedAtInput" type="date" required /></label>
          <label><span>状态</span><select id="statusInput"></select></label>
          <label><span>地区</span><input id="regionInput" required /></label>
          <label><span>成本</span><input id="costInput" required /></label>
        </div>
        <section class="member-editor">
          <div class="member-title-row">
            <div><h3>成员与上下车</h3><p>成员资料在独立弹框中编辑</p></div>
            <button class="secondary-button compact-button" id="addMemberButton" type="button">
              <span aria-hidden="true" data-icon="plus"></span>添加成员
            </button>
          </div>
          <div class="member-summary-list" id="memberRows"></div>
        </section>
        <div class="form-grid">
          <label><span>利润</span><input id="profitInput" type="number" step="0.01" required /></label>
          <label><span>备注</span><textarea id="notesInput" rows="4" placeholder="每行一条"></textarea></label>
        </div>
        <p class="form-error" id="formError" role="alert"></p>
      </div>
      <footer class="modal-actions">
        <button class="secondary-button" type="button" id="cancelButton">取消</button>
        <button class="primary-button" type="submit"><span aria-hidden="true" data-icon="save"></span>保存账号</button>
      </footer>
    </form>
  </section>
</div>

<div class="modal-layer nested-layer" id="memberModal" aria-hidden="true">
  <section class="modal member-modal" role="dialog" aria-modal="true" aria-labelledby="memberModalTitle">
    <header class="modal-header">
      <h2 id="memberModalTitle">新增成员</h2>
      <button class="icon-button ghost" id="closeMemberModalButton" type="button" aria-label="关闭成员弹框" title="关闭">
        <span aria-hidden="true" data-icon="close"></span>
      </button>
    </header>
    <form id="memberForm">
      <div class="modal-body member-form-grid">
        <label><span>成员名称</span><input id="memberNameInput" required /></label>
        <label><span>成员邮箱</span><input id="memberEmailInput" type="email" /></label>
        <label><span>续费价格</span><input id="memberPriceInput" type="number" step="0.01" required /></label>
        <label><span>上车日期</span><input id="memberJoinedAtInput" type="date" required /></label>
        <label><span>下车日期</span><input id="memberLeftAtInput" type="date" /></label>
        <p class="form-error form-span" id="memberFormError" role="alert"></p>
      </div>
      <footer class="modal-actions">
        <button class="secondary-button" id="cancelMemberButton" type="button">取消</button>
        <button class="primary-button" type="submit">确认成员</button>
      </footer>
    </form>
  </section>
</div>

<div class="modal-layer" id="renewalModal" aria-hidden="true">
  <section class="modal renewal-modal" role="dialog" aria-modal="true" aria-labelledby="renewalModalTitle">
    <header class="modal-header">
      <div><p class="eyebrow">Renewals</p><h2 id="renewalModalTitle">续费工作台</h2></div>
      <button class="icon-button ghost" id="closeRenewalModalButton" type="button" aria-label="关闭续费工作台" title="关闭">
        <span aria-hidden="true" data-icon="close"></span>
      </button>
    </header>
    <div class="modal-body">
      <div class="renewal-toolbar">
        <div class="segmented-control" id="renewalViewTabs">
          <button class="is-active" type="button" data-renewal-view="pending">待处理 <span id="pendingRenewalCount">0</span></button>
          <button type="button" data-renewal-view="all">全部周期 <span id="allRenewalCount">0</span></button>
        </div>
        <button class="secondary-button" id="sendRenewalDigestButton" type="button">
          <span aria-hidden="true" data-icon="mail"></span>发送待续费摘要
        </button>
      </div>
      <div class="renewal-list" id="renewalRows"></div>
      <div class="inline-empty" id="renewalEmptyState" hidden>当前没有待处理续费</div>
    </div>
  </section>
</div>

<div class="modal-layer nested-layer" id="confirmModal" aria-hidden="true">
  <section class="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmModalTitle">
    <header class="modal-header"><h2 id="confirmModalTitle">删除账号</h2></header>
    <div class="modal-body">
      <p>确定删除 <strong id="confirmAccountEmail"></strong> 吗？此操作无法撤销。</p>
    </div>
    <footer class="modal-actions">
      <button class="secondary-button" id="cancelDeleteButton" type="button">取消</button>
      <button class="danger-button" id="confirmDeleteButton" type="button">
        <span aria-hidden="true" data-icon="trash"></span>删除账号
      </button>
    </footer>
  </section>
</div>
```

Add icons for `check`, `undo`, `alert`, and `chevron-right` to the existing SVG template.

- [ ] **Step 2: Import the draft helpers and replace drawer state**

At the top of `public/app.js`:

```js
import { createAccountDraft, removeDraftMember, saveDraftMember } from "./accountDraft.js";

const state = {
  accounts: [],
  summary: null,
  filters: { query: "", status: "all", region: "all", month: currentMonth },
  options: { regions: [], statuses: [] },
  editing: null,
  accountDraft: null,
  memberEditingIndex: null,
  renewalView: "pending",
  renewals: { all: [], due: [], pending: [], counts: { all: 0, due: 0, pending: 0 } },
  pendingDelete: null,
};
```

Rename `openDrawer`/`closeDrawer` to `openAccountModal`/`closeAccountModal`. On open, create a cloned draft and render member summaries:

```js
function openAccountModal(account = null) {
  state.editing = account;
  state.accountDraft = createAccountDraft(account, localToday());
  writeAccountInputs(state.accountDraft);
  renderMemberSummaries();
  openLayer(els.accountModal, inputs.email);
}

function renderMemberSummaries() {
  const members = state.accountDraft?.members || [];
  els.memberRows.innerHTML = members.length
    ? members.map((member, index) => memberSummaryHtml(member, index)).join("")
    : `<div class="inline-empty">还没有成员</div>`;
  installIcons();
}
```

- [ ] **Step 3: Wire member nested editing around the tested draft helpers**

```js
function openMemberModal(index = null) {
  state.memberEditingIndex = Number.isInteger(index) ? index : null;
  const member = state.memberEditingIndex === null
    ? { name: "", email: "", price: "", joinedAt: inputs.openedAt.value || localToday(), leftAt: "" }
    : state.accountDraft.members[state.memberEditingIndex];
  writeMemberInputs(member);
  openLayer(els.memberModal, memberInputs.name);
}

function saveMemberDraft(event) {
  event.preventDefault();
  const member = readMemberInputs();
  if (member.leftAt && member.leftAt < member.joinedAt) {
    els.memberFormError.textContent = "下车日期不能早于上车日期";
    return;
  }
  state.accountDraft = saveDraftMember(state.accountDraft, state.memberEditingIndex, member);
  closeLayer(els.memberModal);
  renderMemberSummaries();
}

function removeMemberFromDraft(index) {
  state.accountDraft = removeDraftMember(state.accountDraft, index);
  renderMemberSummaries();
}
```

`formToAccount()` must use `state.accountDraft.members` and current input values. Closing the member modal must never reset `state.accountDraft`.

- [ ] **Step 4: Replace native delete confirmation**

Clicking a row delete button assigns `state.pendingDelete` and opens `confirmModal`. The destructive button calls the existing `deleteAccount`, closes the confirm modal on success, and then clears `state.pendingDelete`.

- [ ] **Step 5: Load and render renewal workbench data**

```js
async function loadRenewals() {
  const url = new URL("/api/renewals", window.location.origin);
  url.searchParams.set("month", state.filters.month);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "续费列表加载失败");
  state.renewals = payload;
  renderRenewalWorkbench();
  updateRenewalCount();
}

async function setRenewalHandled(cycleKey, handled) {
  const response = await fetch(`/api/renewals/${encodeURIComponent(cycleKey)}/handled`, {
    method: handled ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
    body: handled ? JSON.stringify({}) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "续费状态更新失败");
  await loadRenewals();
}
```

The workbench renderer uses `state.renewalView === "pending" ? state.renewals.pending : state.renewals.all`, includes member email and price, shows `sentAt`, and renders “标记已处理” or “撤销处理” per item. `sendReminders()` reloads both accounts and renewals after a successful send.

- [ ] **Step 6: Implement dialog stack keyboard behavior**

Add one document keydown handler:

```js
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (isLayerOpen(els.confirmModal)) return closeConfirmModal();
  if (isLayerOpen(els.memberModal)) return closeMemberModal();
  if (isLayerOpen(els.renewalModal)) return closeRenewalModal();
  if (isLayerOpen(els.accountModal)) closeAccountModal();
});
```

`openLayer` adds `is-open`, sets `aria-hidden="false"`, saves the triggering element, locks `document.body`, and focuses the supplied first field. `closeLayer` hides only that layer, restores focus, and unlocks body only when no modal remains open.

- [ ] **Step 7: Run syntax and complete tests**

Run: `node --check public/app.js`

Expected: exit 0.

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 8: Commit modal and workbench behavior**

```bash
git add public/index.html public/app.js
git commit -m "Replace drawer with modal workbench"
```

### Task 5: Full Visual Refresh And Responsive Polish

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Replace root tokens and application shell**

Use the approved clean operations palette:

```css
:root {
  color-scheme: light;
  --page: #edf1ef;
  --surface: #ffffff;
  --surface-subtle: #f6f8f7;
  --nav: #17231e;
  --nav-raised: #26352e;
  --text: #17211d;
  --text-muted: #66716c;
  --border: #d9e1dd;
  --border-strong: #c7d1cc;
  --primary: #167a56;
  --primary-hover: #116545;
  --primary-soft: #ddf2e9;
  --warning: #bd5b22;
  --warning-soft: #fff0df;
  --danger: #b9382d;
  --danger-soft: #fde9e7;
  --focus: #2b7bb9;
  --shadow-sm: 0 3px 10px rgba(18, 32, 26, 0.08);
  --shadow-lg: 0 24px 60px rgba(13, 24, 19, 0.22);
}

body {
  margin: 0;
  min-width: 320px;
  color: var(--text);
  background: var(--page);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.topbar-band {
  color: #fff;
  background: var(--nav);
  border-bottom: 1px solid #34433b;
}

.app-shell {
  width: min(1480px, 100%);
  margin: 0 auto;
  padding: 0 24px 28px;
}
```

- [ ] **Step 2: Restyle metrics, filters, tabs, and table**

Metrics become a compact four-column strip, the workspace uses a 6px radius and one border, table headers are sticky, and row hover does not move layout. Due-soon rows use `--warning-soft` plus a 4px warning border. All table text uses `overflow-wrap: anywhere` for emails.

Set stable sizes:

```css
.metric-card { min-height: 92px; padding: 14px 16px; border-radius: 6px; }
.toolbar :is(input, select) { min-height: 40px; }
.icon-button { width: 40px; height: 40px; }
.status-tab { min-height: 34px; border-radius: 6px; }
table { width: 100%; min-width: 1120px; table-layout: fixed; }
th { position: sticky; top: 0; z-index: 1; }
```

- [ ] **Step 3: Style modal layers and nested hierarchy**

```css
.modal-layer {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: none;
  place-items: center;
  padding: 24px;
  background: rgba(10, 18, 14, 0.52);
}

.modal-layer.is-open { display: grid; }
.nested-layer { z-index: 40; background: rgba(8, 15, 12, 0.64); }
.modal {
  width: min(900px, 100%);
  max-height: min(860px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}
.member-modal { width: min(620px, 100%); }
.renewal-modal { width: min(1040px, 100%); }
.confirm-modal { width: min(440px, 100%); }
.modal-header, .modal-actions { flex: 0 0 auto; }
.modal-body { overflow-y: auto; }
```

Member summary rows are compact repeated items, not nested cards. Renewal items use rows with a stable action column.

- [ ] **Step 4: Add focus, motion, and responsive rules**

```css
:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--focus) 40%, transparent);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .app-shell { padding-inline: 14px; }
  .topbar { align-items: flex-start; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .toolbar { align-items: stretch; flex-direction: column; }
  .form-grid, .member-form-grid { grid-template-columns: 1fr; }
  .modal-layer { padding: 10px; }
  .modal { max-height: calc(100vh - 20px); }
  .renewal-item { grid-template-columns: 1fr; }
}

@media (max-width: 420px) {
  .metrics { grid-template-columns: 1fr; }
  .topbar-actions { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Scan for obsolete drawer styles and syntax**

Run: `rg -n "drawer|border-radius:\\s*(1[0-9]|[2-9][0-9])px|letter-spacing:\\s*-" public`

Expected: no drawer selectors, no oversized rounded controls, and no negative letter spacing.

Run: `node --check public/app.js`

Expected: exit 0.

- [ ] **Step 6: Commit the visual system**

```bash
git add public/styles.css
git commit -m "Refresh Team Bus management UI"
```

### Task 6: Documentation, Browser QA, Docker Verification, And Publish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the new workflow and runtime file**

Add a “续费工作台” section explaining:

- It opens from the top bar.
- The default view shows unhandled vehicles due within three days.
- Manual send still targets `REMINDER_TO`.
- Marking handled only affects the current renewal cycle.
- `data/renewal-actions.json` persists handled state and is covered by the existing `./data:/app/data` Docker volume.

- [ ] **Step 2: Run fresh automated verification**

Run: `npm test`

Expected: all test files pass with zero failures.

Run:

```bash
node --check public/app.js
node --check src/http/app.js
node --check src/domain/renewalWorkItems.js
bash -n scripts/start-centos7.sh
```

Expected: every command exits 0.

- [ ] **Step 3: Build and run the Docker image**

Run:

```bash
docker build -t gpt-team-manage:ui-renewal .
docker run --rm -d --name gpt-team-manage-ui-test -p 5177:5176 \
  -e HOST=0.0.0.0 \
  -e REMINDER_SCHEDULER=false \
  gpt-team-manage:ui-renewal
curl --fail http://127.0.0.1:5177/api/health
```

Expected: Docker build exits 0 and health responds `{"ok":true}`.

- [ ] **Step 4: Verify desktop and mobile in the in-app browser**

At 1440×900:

- Confirm the dashboard is nonblank and the approved dark-nav/light-workspace design is visible.
- Confirm due-soon rows are pinned and visibly marked.
- Open account edit, then edit a member, cancel the member modal, and verify the account modal remains open with its draft.
- Open the renewal workbench, switch pending/all views, mark a cycle handled, and undo it.
- Confirm there are no console errors.

At 375×812 and 768×1024:

- Confirm buttons and labels do not overlap.
- Confirm modals remain inside the viewport and body content scrolls.
- Confirm the table scrolls horizontally without hiding modal actions.
- Confirm Escape closes only the topmost modal.

- [ ] **Step 5: Stop the test container**

Run: `docker stop gpt-team-manage-ui-test`

Expected: container exits and no task-owned session remains running.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md
git commit -m "Document renewal workbench"
```

- [ ] **Step 7: Review final diff and push**

Run:

```bash
git status --short
git log --oneline --decorate -8
git diff origin/main...HEAD --check
```

Expected: clean worktree, intended commits only, and no whitespace errors.

Push the current branch to `HelloWord-jht/gpt-team-manage`.
