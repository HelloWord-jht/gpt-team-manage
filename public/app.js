const state = {
  accounts: [],
  summary: null,
  filters: {
    query: "",
    status: "all",
    region: "all",
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
  region: document.querySelector("#regionFilter"),
  tabs: document.querySelector("#statusTabs"),
  drawer: document.querySelector("#drawer"),
  drawerTitle: document.querySelector("#drawerTitle"),
  form: document.querySelector("#accountForm"),
  formError: document.querySelector("#formError"),
  toast: document.querySelector("#toast"),
  newAccount: document.querySelector("#newAccountButton"),
  refresh: document.querySelector("#refreshButton"),
  closeDrawer: document.querySelector("#closeDrawerButton"),
  cancel: document.querySelector("#cancelButton"),
};

const inputs = {
  id: document.querySelector("#accountId"),
  email: document.querySelector("#emailInput"),
  openedAt: document.querySelector("#openedAtInput"),
  status: document.querySelector("#statusInput"),
  region: document.querySelector("#regionInput"),
  cost: document.querySelector("#costInput"),
  member1Name: document.querySelector("#member1NameInput"),
  member1Price: document.querySelector("#member1PriceInput"),
  member2Name: document.querySelector("#member2NameInput"),
  member2Price: document.querySelector("#member2PriceInput"),
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
loadAccounts();

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.filters.query = els.search.value;
    renderRows();
  });

  els.region.addEventListener("change", () => {
    state.filters.region = els.region.value;
    renderRows();
  });

  els.newAccount.addEventListener("click", () => openDrawer());
  els.refresh.addEventListener("click", () => loadAccounts({ toast: true }));
  els.closeDrawer.addEventListener("click", closeDrawer);
  els.cancel.addEventListener("click", closeDrawer);
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
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    showToast(payload.error || "加载失败");
    return;
  }

  state.accounts = payload.accounts;
  state.summary = payload.summary;
  state.options = payload.filters;
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
    ["账号总数", summary.totalAccounts, "Excel 导入记录"],
    ["正常账号", summary.activeAccounts, "可继续运营"],
    ["异常账号", summary.issueAccounts, "封号/退订/退款"],
    ["总利润", money(summary.totalProfit), `${summary.usedSlots}/${summary.totalSlots} 车位 · ${occupancy}%`],
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
  const members = account.members.length
    ? account.members
        .map(
          (member) => `
            <div class="member-line">
              <strong>${escapeHtml(member.name)}</strong>
              <span>${money(member.price)}</span>
            </div>
          `
        )
        .join("")
    : `<span class="muted">${escapeHtml(account.notes.join(" / ") || "暂无成员")}</span>`;

  const profitClass = account.profit < 0 ? "profit negative" : "profit";

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
      </td>
      <td><div class="member-list">${members}</div></td>
      <td><span class="${profitClass}">${money(account.profit)}</span></td>
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
      ...account.members.flatMap((member) => [member.name, member.price]),
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
  inputs.member1Name.value = account?.members?.[0]?.name || "";
  inputs.member1Price.value = account?.members?.[0]?.price ?? "";
  inputs.member2Name.value = account?.members?.[1]?.name || "";
  inputs.member2Price.value = account?.members?.[1]?.price ?? "";
  inputs.profit.value = account?.profit ?? 0;
  inputs.notes.value = account?.notes?.join("\n") || "";

  els.drawer.classList.add("is-open");
  els.drawer.setAttribute("aria-hidden", "false");
  inputs.email.focus();
}

function closeDrawer() {
  els.drawer.classList.remove("is-open");
  els.drawer.setAttribute("aria-hidden", "true");
  state.editing = null;
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

function formToAccount() {
  const members = [
    [inputs.member1Name.value, inputs.member1Price.value],
    [inputs.member2Name.value, inputs.member2Price.value],
  ]
    .filter(([name, price]) => name.trim() || price)
    .map(([name, price]) => ({ name: name.trim(), price: Number(price) }));

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

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 1800);
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
