const currentMonth = new Date().toISOString().slice(0, 7);

const state = {
  accounts: [],
  summary: null,
  filters: {
    query: "",
    status: "all",
    region: "all",
    month: currentMonth,
  },
  options: {
    regions: [],
    statuses: [],
  },
  editing: null,
};

const els = {
  metrics: document.querySelector("#metrics"),
  rows: document.querySelector("#accountRows"),
  empty: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  month: document.querySelector("#monthFilter"),
  region: document.querySelector("#regionFilter"),
  tabs: document.querySelector("#statusTabs"),
  drawer: document.querySelector("#drawer"),
  drawerTitle: document.querySelector("#drawerTitle"),
  form: document.querySelector("#accountForm"),
  formError: document.querySelector("#formError"),
  toast: document.querySelector("#toast"),
  newAccount: document.querySelector("#newAccountButton"),
  sendReminder: document.querySelector("#sendReminderButton"),
  refresh: document.querySelector("#refreshButton"),
  closeDrawer: document.querySelector("#closeDrawerButton"),
  cancel: document.querySelector("#cancelButton"),
  addMember: document.querySelector("#addMemberButton"),
  memberRows: document.querySelector("#memberRows"),
};

const inputs = {
  id: document.querySelector("#accountId"),
  email: document.querySelector("#emailInput"),
  openedAt: document.querySelector("#openedAtInput"),
  status: document.querySelector("#statusInput"),
  region: document.querySelector("#regionInput"),
  cost: document.querySelector("#costInput"),
  profit: document.querySelector("#profitInput"),
  notes: document.querySelector("#notesInput"),
};

const statusLabels = {
  active: "正常",
  blocked: "封号",
  canceled: "已退订",
  refunded: "已退款",
};

installIcons();
bindEvents();
els.month.value = state.filters.month;
loadAccounts();

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.filters.query = els.search.value;
    renderRows();
  });

  els.month.addEventListener("change", () => {
    state.filters.month = els.month.value || currentMonth;
    loadAccounts();
  });

  els.region.addEventListener("change", () => {
    state.filters.region = els.region.value;
    renderRows();
  });

  els.newAccount.addEventListener("click", () => openDrawer());
  els.sendReminder.addEventListener("click", sendReminders);
  els.refresh.addEventListener("click", () => loadAccounts({ toast: true }));
  els.closeDrawer.addEventListener("click", closeDrawer);
  els.cancel.addEventListener("click", closeDrawer);
  els.addMember.addEventListener("click", () => addMemberRow());
  els.drawer.addEventListener("click", (event) => {
    if (event.target === els.drawer) closeDrawer();
  });

  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveAccount();
  });
}

async function loadAccounts(options = {}) {
  const url = new URL("/api/accounts", window.location.origin);
  url.searchParams.set("month", state.filters.month);
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    showToast(payload.error || "加载失败");
    return;
  }

  state.accounts = payload.accounts;
  state.summary = payload.summary;
  state.options = payload.filters;
  state.filters.month = payload.month || state.filters.month;
  els.month.value = state.filters.month;
  render();
  if (options.toast) showToast("已刷新");
}

function render() {
  renderMetrics();
  renderFilters();
  renderStatusTabs();
  renderRows();
}

function renderMetrics() {
  const summary = state.summary || {
    totalAccounts: 0,
    activeAccounts: 0,
    issueAccounts: 0,
    totalProfit: 0,
    usedSlots: 0,
    totalSlots: 0,
  };
  const occupancy = summary.totalSlots ? Math.round((summary.usedSlots / summary.totalSlots) * 100) : 0;
  const cards = [
    ["本月账号", summary.totalAccounts, `${state.filters.month} 月视图`],
    ["正常账号", summary.activeAccounts, "可继续运营"],
    ["异常账号", summary.issueAccounts, "封号/退订/退款"],
    ["真实利润", `¥${money(summary.totalProfit)}`, `${summary.usedSlots}/${summary.totalSlots} 车位 · ${occupancy}%`],
  ];

  els.metrics.innerHTML = cards
    .map(
      ([label, value, helper]) => `
        <article class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(helper)}</span>
        </article>
      `
    )
    .join("");
}

function renderFilters() {
  const current = state.filters.region;
  els.region.innerHTML = [
    `<option value="all">全部地区</option>`,
    ...state.options.regions.map((region) => `<option value="${escapeAttr(region)}">${escapeHtml(region)}</option>`),
  ].join("");
  els.region.value = state.options.regions.includes(current) ? current : "all";

  inputs.status.innerHTML = state.options.statuses
    .map((status) => `<option value="${escapeAttr(status.key)}">${escapeHtml(status.label)}</option>`)
    .join("");
}

function renderStatusTabs() {
  const summaryStatuses = state.summary?.statuses || [];
  const tabs = [{ key: "all", label: "全部", count: state.summary?.totalAccounts || 0 }, ...summaryStatuses];

  els.tabs.innerHTML = tabs
    .map(
      (tab) => `
        <button class="status-tab ${state.filters.status === tab.key ? "is-active" : ""}" type="button" data-status="${escapeAttr(tab.key)}">
          ${escapeHtml(tab.label)} ${tab.count}
        </button>
      `
    )
    .join("");

  els.tabs.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.status = button.dataset.status;
      renderStatusTabs();
      renderRows();
    });
  });
}

function renderRows() {
  const rows = filteredAccounts();
  els.empty.hidden = rows.length > 0;
  els.rows.innerHTML = rows.map(rowHtml).join("");
  installIcons();

  els.rows.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const account = state.accounts.find((item) => item.id === button.dataset.edit);
      openDrawer(account);
    });
  });

  els.rows.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const account = state.accounts.find((item) => item.id === button.dataset.delete);
      if (!account) return;
      if (!window.confirm(`删除 ${account.email}？`)) return;
      await deleteAccount(account.id);
    });
  });
}

function rowHtml(account) {
  const activeMembers = account.activeMembers || account.members || [];
  const members = activeMembers.length
    ? activeMembers
        .map(
          (member) => `
            <div class="member-line rich">
              <div>
                <strong>${escapeHtml(member.name)}</strong>
                <span class="muted">${escapeHtml(member.email || "未填邮箱")}</span>
              </div>
              <div class="member-money">
                <span>¥${money(member.price)}</span>
                <span class="muted">${escapeHtml(member.joinedAt)}${member.leftAt ? ` - ${escapeHtml(member.leftAt)}` : ""}</span>
              </div>
            </div>
          `
        )
        .join("")
    : `<span class="muted">${escapeHtml(account.notes.join(" / ") || "本月无成员")}</span>`;

  const computedProfit = account.computedProfitCny ?? account.profit ?? 0;
  const profitClass = computedProfit < 0 ? "profit negative" : "profit";
  const costMeta =
    account.costCny === null || account.costCny === undefined
      ? "汇率待获取"
      : `约 ¥${money(account.costCny)} · ${escapeHtml(account.exchangeRate?.source || "")}`;

  return `
    <tr>
      <td>
        <div class="account-cell">
          <strong>${escapeHtml(account.email)}</strong>
          <span class="muted">${escapeHtml(account.id)}</span>
        </div>
      </td>
      <td><span class="badge ${escapeAttr(account.status)}">${escapeHtml(statusLabels[account.status] || account.status)}</span></td>
      <td>
        <strong>${escapeHtml(account.region)}</strong>
        <div class="muted">${escapeHtml(account.cost)}</div>
        <div class="muted">${costMeta}</div>
      </td>
      <td><div class="member-list">${members}</div></td>
      <td>
        <span class="${profitClass}">¥${money(computedProfit)}</span>
        <div class="muted">收入 ¥${money(account.revenueCny || 0)}</div>
      </td>
      <td>${escapeHtml(account.openedAt)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-button" type="button" data-edit="${escapeAttr(account.id)}" title="编辑">
            <span aria-hidden="true" data-icon="edit"></span>
          </button>
          <button class="icon-button" type="button" data-delete="${escapeAttr(account.id)}" title="删除">
            <span aria-hidden="true" data-icon="trash"></span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function filteredAccounts() {
  const query = state.filters.query.trim().toLowerCase();
  return state.accounts.filter((account) => {
    if (state.filters.status !== "all" && account.status !== state.filters.status) return false;
    if (state.filters.region !== "all" && account.region !== state.filters.region) return false;
    if (!query) return true;
    return [
      account.email,
      account.openedAt,
      account.region,
      account.cost,
      account.status,
      ...account.members.flatMap((member) => [member.name, member.email, member.price, member.joinedAt, member.leftAt]),
      ...account.notes,
      account.profit,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function openDrawer(account = null) {
  state.editing = account;
  els.drawerTitle.textContent = account ? "编辑账号" : "新增账号";
  els.formError.textContent = "";

  inputs.id.value = account?.id || "";
  inputs.email.value = account?.email || "";
  inputs.openedAt.value = account?.openedAt || new Date().toISOString().slice(0, 10);
  inputs.status.value = account?.status || "active";
  inputs.region.value = account?.region || "";
  inputs.cost.value = account?.cost || "";
  inputs.profit.value = account?.profit ?? 0;
  inputs.notes.value = account?.notes?.join("\n") || "";

  els.memberRows.innerHTML = "";
  const members = account?.members?.length ? account.members : [emptyMember(), emptyMember()];
  members.forEach((member) => addMemberRow(member));

  els.drawer.classList.add("is-open");
  els.drawer.setAttribute("aria-hidden", "false");
  inputs.email.focus();
}

function closeDrawer() {
  els.drawer.classList.remove("is-open");
  els.drawer.setAttribute("aria-hidden", "true");
  state.editing = null;
}

function addMemberRow(member = emptyMember()) {
  const row = document.createElement("div");
  row.className = "member-row";
  row.innerHTML = `
    <label>
      <span>姓名</span>
      <input data-member-field="name" type="text" value="${escapeAttr(member.name || "")}" />
    </label>
    <label>
      <span>邮箱</span>
      <input data-member-field="email" type="email" value="${escapeAttr(member.email || "")}" />
    </label>
    <label>
      <span>月费</span>
      <input data-member-field="price" type="number" step="0.01" value="${escapeAttr(member.price ?? "")}" />
    </label>
    <label>
      <span>上车</span>
      <input data-member-field="joinedAt" type="date" value="${escapeAttr(member.joinedAt || inputs.openedAt.value || "")}" />
    </label>
    <label>
      <span>下车</span>
      <input data-member-field="leftAt" type="date" value="${escapeAttr(member.leftAt || "")}" />
    </label>
    <button class="icon-button" type="button" title="移除成员">
      <span aria-hidden="true" data-icon="trash"></span>
    </button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  els.memberRows.append(row);
  installIcons();
}

async function saveAccount() {
  els.formError.textContent = "";
  const account = formToAccount();
  const isEdit = Boolean(state.editing);
  const endpoint = isEdit ? `/api/accounts/${encodeURIComponent(state.editing.id)}` : "/api/accounts";
  const response = await fetch(endpoint, {
    method: isEdit ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(account),
  });
  const payload = await response.json();

  if (!response.ok) {
    els.formError.textContent = payload.error || "保存失败";
    return;
  }

  await loadAccounts();
  closeDrawer();
  showToast(isEdit ? "已更新" : "已新增");
}

async function deleteAccount(id) {
  const response = await fetch(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });

  if (!response.ok) {
    const payload = await response.json();
    showToast(payload.error || "删除失败");
    return;
  }

  await loadAccounts();
  showToast("已删除");
}

async function sendReminders() {
  const response = await fetch("/api/reminders/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ daysAhead: 7 }),
  });
  const payload = await response.json();

  if (!response.ok) {
    showToast(payload.error || "发送失败");
    return;
  }

  showToast(payload.sent ? `已发送 ${payload.sent} 条续费提醒` : "未来 7 天没有续费账号");
}

function formToAccount() {
  const members = Array.from(els.memberRows.querySelectorAll(".member-row"))
    .map((row) => {
      const value = (field) => row.querySelector(`[data-member-field="${field}"]`)?.value?.trim() || "";
      const priceText = value("price");
      return {
        name: value("name"),
        email: value("email"),
        priceText,
        price: Number(priceText),
        joinedAt: value("joinedAt") || inputs.openedAt.value,
        leftAt: value("leftAt"),
      };
    })
    .filter((member) => member.name || member.email || member.priceText)
    .map(({ priceText, ...member }) => member);

  return {
    id: inputs.id.value,
    email: inputs.email.value,
    openedAt: inputs.openedAt.value,
    region: inputs.region.value,
    cost: inputs.cost.value,
    members,
    profit: Number(inputs.profit.value),
    status: inputs.status.value,
    notes: inputs.notes.value
      .split("\n")
      .map((note) => note.trim())
      .filter(Boolean),
  };
}

function emptyMember() {
  return {
    name: "",
    email: "",
    price: "",
    joinedAt: inputs.openedAt?.value || new Date().toISOString().slice(0, 10),
    leftAt: "",
  };
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 2200);
}

function money(value) {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function installIcons() {
  const source = document.querySelector("#icons");
  const icons = new Map(
    Array.from(source.content.querySelectorAll("svg")).map((svg) => [svg.dataset.name, svg.outerHTML])
  );

  document.querySelectorAll("[data-icon]").forEach((target) => {
    target.innerHTML = icons.get(target.dataset.icon) || "";
  });
}
