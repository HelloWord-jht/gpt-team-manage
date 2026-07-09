import {
  createAccountDraft,
  removeDraftMember,
  saveDraftMember,
} from "./accountDraft.js";

const currentMonth = localToday().slice(0, 7);

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
  accountDraft: null,
  memberEditingIndex: null,
  renewals: emptyRenewals(),
  renewalsLoaded: false,
  renewalView: "pending",
  financeView: "snapshot",
  snapshot: null,
  snapshotMonth: currentMonth,
  snapshots: [],
  backups: [],
  pendingDelete: null,
  modalFocusTriggers: new Map(),
  loading: {
    refresh: false,
    accountSave: false,
    renewals: false,
    renewalAction: "",
    sendDigest: false,
    deleteAccount: false,
    snapshot: false,
    createSnapshot: false,
    backups: false,
    createBackup: false,
    restoreBackup: false,
  },
};

const els = {
  metrics: document.querySelector("#metrics"),
  rows: document.querySelector("#accountRows"),
  empty: document.querySelector("#emptyState"),
  search: document.querySelector("#searchInput"),
  month: document.querySelector("#monthFilter"),
  region: document.querySelector("#regionFilter"),
  tabs: document.querySelector("#statusTabs"),
  form: document.querySelector("#accountForm"),
  formError: document.querySelector("#formError"),
  toast: document.querySelector("#toast"),
  newAccount: document.querySelector("#newAccountButton"),
  renewalWorkbench: document.querySelector("#renewalWorkbenchButton"),
  financeCenter: document.querySelector("#financeCenterButton"),
  pendingRenewalBadge: document.querySelector("#pendingRenewalBadge"),
  refresh: document.querySelector("#refreshButton"),
  accountModal: document.querySelector("#accountModal"),
  accountModalTitle: document.querySelector("#accountModalTitle"),
  closeAccountModal: document.querySelector("#closeAccountModalButton"),
  cancelAccount: document.querySelector("#cancelButton"),
  saveAccount: document.querySelector("#saveAccountButton"),
  saveAccountLabel: document.querySelector("#saveAccountButtonLabel"),
  addMember: document.querySelector("#addMemberButton"),
  memberRows: document.querySelector("#memberRows"),
  memberModal: document.querySelector("#memberModal"),
  memberModalTitle: document.querySelector("#memberModalTitle"),
  closeMemberModal: document.querySelector("#closeMemberModalButton"),
  cancelMember: document.querySelector("#cancelMemberButton"),
  memberForm: document.querySelector("#memberForm"),
  memberFormError: document.querySelector("#memberFormError"),
  renewalModal: document.querySelector("#renewalModal"),
  closeRenewalModal: document.querySelector("#closeRenewalModalButton"),
  renewalViewTabs: document.querySelector("#renewalViewTabs"),
  pendingRenewalCount: document.querySelector("#pendingRenewalCount"),
  allRenewalCount: document.querySelector("#allRenewalCount"),
  sendRenewalDigest: document.querySelector("#sendRenewalDigestButton"),
  sendRenewalDigestLabel: document.querySelector("#sendRenewalDigestButtonLabel"),
  renewalRows: document.querySelector("#renewalRows"),
  renewalEmpty: document.querySelector("#renewalEmptyState"),
  renewalError: document.querySelector("#renewalError"),
  financeModal: document.querySelector("#financeModal"),
  closeFinanceModal: document.querySelector("#closeFinanceModalButton"),
  financeViewTabs: document.querySelector("#financeViewTabs"),
  snapshotMonth: document.querySelector("#snapshotMonthInput"),
  financeError: document.querySelector("#financeError"),
  snapshotPanel: document.querySelector("#snapshotPanel"),
  backupPanel: document.querySelector("#backupPanel"),
  createSnapshot: document.querySelector("#createSnapshotButton"),
  createSnapshotLabel: document.querySelector("#createSnapshotButtonLabel"),
  snapshotStatus: document.querySelector("#snapshotStatus"),
  snapshotMetrics: document.querySelector("#snapshotMetrics"),
  snapshotEvents: document.querySelector("#snapshotEvents"),
  snapshotAccounts: document.querySelector("#snapshotAccounts"),
  createBackup: document.querySelector("#createBackupButton"),
  createBackupLabel: document.querySelector("#createBackupButtonLabel"),
  backupSelect: document.querySelector("#backupSelect"),
  restoreBackup: document.querySelector("#restoreBackupButton"),
  restoreBackupLabel: document.querySelector("#restoreBackupButtonLabel"),
  backupRows: document.querySelector("#backupRows"),
  confirmModal: document.querySelector("#confirmModal"),
  confirmAccountEmail: document.querySelector("#confirmAccountEmail"),
  confirmError: document.querySelector("#confirmError"),
  cancelDelete: document.querySelector("#cancelDeleteButton"),
  confirmDelete: document.querySelector("#confirmDeleteButton"),
  confirmDeleteLabel: document.querySelector("#confirmDeleteButtonLabel"),
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

const memberInputs = {
  name: document.querySelector("#memberNameInput"),
  email: document.querySelector("#memberEmailInput"),
  price: document.querySelector("#memberPriceInput"),
  paymentStatus: document.querySelector("#memberPaymentStatusInput"),
  joinedAt: document.querySelector("#memberJoinedAtInput"),
  leftAt: document.querySelector("#memberLeftAtInput"),
};

const statusLabels = {
  active: "正常",
  blocked: "封号",
  canceled: "已退订",
  refunded: "已退款",
};

const paymentLabels = {
  unpaid: "未付款",
  partial: "部分付款",
  paid: "已付款",
  refunded: "已退费",
};

installIcons();
bindEvents();
els.month.value = state.filters.month;
renderRenewalWorkbench();
void loadInitialData();

function bindEvents() {
  els.search.addEventListener("input", () => {
    state.filters.query = els.search.value;
    renderRows();
  });

  els.month.addEventListener("change", () => {
    state.filters.month = els.month.value || currentMonth;
    void Promise.allSettled([loadAccounts(), loadRenewals()]);
  });

  els.region.addEventListener("change", () => {
    state.filters.region = els.region.value;
    renderRows();
  });

  els.newAccount.addEventListener("click", (event) => openAccountModal(null, event.currentTarget));
  els.renewalWorkbench.addEventListener("click", (event) => {
    openRenewalModal(event.currentTarget);
  });
  els.financeCenter.addEventListener("click", (event) => {
    openFinanceModal(event.currentTarget);
  });
  els.refresh.addEventListener("click", refreshAll);

  els.closeAccountModal.addEventListener("click", closeAccountModal);
  els.cancelAccount.addEventListener("click", closeAccountModal);
  els.accountModal.addEventListener("click", (event) => {
    if (event.target === els.accountModal) closeAccountModal();
  });
  els.form.addEventListener("submit", saveAccount);
  els.addMember.addEventListener("click", (event) => openMemberModal(null, event.currentTarget));

  els.closeMemberModal.addEventListener("click", closeMemberModal);
  els.cancelMember.addEventListener("click", closeMemberModal);
  els.memberModal.addEventListener("click", (event) => {
    if (event.target === els.memberModal) closeMemberModal();
  });
  els.memberForm.addEventListener("submit", saveMemberDraft);

  els.closeRenewalModal.addEventListener("click", closeRenewalModal);
  els.renewalModal.addEventListener("click", (event) => {
    if (event.target === els.renewalModal) closeRenewalModal();
  });
  els.renewalViewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-renewal-view]");
    if (!button) return;
    state.renewalView = button.dataset.renewalView;
    renderRenewalWorkbench();
  });
  els.sendRenewalDigest.addEventListener("click", sendReminders);

  els.closeFinanceModal.addEventListener("click", closeFinanceModal);
  els.financeModal.addEventListener("click", (event) => {
    if (event.target === els.financeModal) closeFinanceModal();
  });
  els.financeViewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-finance-view]");
    if (!button) return;
    state.financeView = button.dataset.financeView;
    renderFinanceCenter();
    if (state.financeView === "snapshot") void loadSnapshot();
    if (state.financeView === "backups") void loadBackups();
  });
  els.snapshotMonth.addEventListener("change", () => {
    state.snapshotMonth = els.snapshotMonth.value || state.filters.month;
    void loadSnapshot();
  });
  els.createSnapshot.addEventListener("click", createSnapshot);
  els.createBackup.addEventListener("click", createBackup);
  els.restoreBackup.addEventListener("click", restoreBackup);

  els.cancelDelete.addEventListener("click", closeDeleteConfirm);
  els.confirmDelete.addEventListener("click", confirmDeleteAccount);
  els.confirmModal.addEventListener("click", (event) => {
    if (event.target === els.confirmModal) closeDeleteConfirm();
  });

  document.addEventListener("keydown", handleDocumentKeydown);
}

async function loadInitialData() {
  await Promise.allSettled([loadAccounts(), loadRenewals()]);
}

async function loadAccounts() {
  const url = new URL("/api/accounts", window.location.origin);
  url.searchParams.set("month", state.filters.month);

  try {
    const payload = await requestJson(url);
    state.accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    state.summary = payload.summary || null;
    state.options = payload.filters || state.options;
    state.filters.month = payload.month || state.filters.month;
    els.month.value = state.filters.month;
    render();
    return true;
  } catch (error) {
    showToast(error.message || "账号加载失败");
    return false;
  }
}

async function loadRenewals() {
  const url = new URL("/api/renewals", window.location.origin);
  url.searchParams.set("month", state.filters.month);
  state.loading.renewals = true;
  els.renewalError.textContent = "";
  renderRenewalWorkbench();

  try {
    const payload = await requestJson(url);
    state.renewals = normalizeRenewals(payload);
    state.renewalsLoaded = true;
    renderRenewalWorkbench();
    return true;
  } catch (error) {
    const message = error.message || "续费列表加载失败";
    els.renewalError.textContent = message;
    showToast(message);
    return false;
  } finally {
    state.loading.renewals = false;
    renderRenewalWorkbench();
  }
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
    totalProfit: 0,
    usedSlots: 0,
    totalSlots: 0,
    totalRevenue: 0,
    receivable: 0,
  };
  const occupancy = summary.totalSlots
    ? Math.round((summary.usedSlots / summary.totalSlots) * 100)
    : 0;
  const dueCount = state.renewalsLoaded ? state.renewals.counts.pending : "...";
  const cards = [
    ["正常账号", summary.activeAccounts, `本月共 ${summary.totalAccounts} 个账号`],
    [
      "成员 / 车位",
      `${summary.usedSlots}/${summary.totalSlots}`,
      `使用率 ${occupancy}%`,
    ],
    [
      "真实利润",
      `¥${money(summary.totalProfit)}`,
      `收入 ¥${money(summary.totalRevenue)} / 待收 ¥${money(summary.receivable)}`,
    ],
    [
      "即将续费",
      dueCount,
      state.renewalsLoaded
        ? `${state.renewals.counts.due} 个账号将在 3 天内到期`
        : "正在同步续费周期",
    ],
  ];

  els.metrics.innerHTML = cards
    .map(
      ([label, value, helper]) => `
        <article class="metric-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(helper)}</small>
        </article>
      `
    )
    .join("");
}

function renderFilters() {
  const currentRegion = state.filters.region;
  const regions = Array.isArray(state.options.regions) ? state.options.regions : [];
  els.region.innerHTML = [
    `<option value="all">全部地区</option>`,
    ...regions.map(
      (region) => `<option value="${escapeAttr(region)}">${escapeHtml(region)}</option>`
    ),
  ].join("");
  els.region.value = regions.includes(currentRegion) ? currentRegion : "all";
  state.filters.region = els.region.value;

  const currentStatus = inputs.status.value;
  const statuses =
    Array.isArray(state.options.statuses) && state.options.statuses.length
      ? state.options.statuses
      : Object.entries(statusLabels).map(([key, label]) => ({ key, label }));
  inputs.status.innerHTML = statuses
    .map(
      (status) =>
        `<option value="${escapeAttr(status.key)}">${escapeHtml(status.label)}</option>`
    )
    .join("");
  inputs.status.value = statuses.some((status) => status.key === currentStatus)
    ? currentStatus
    : "active";

  renderMemberPaymentOptions(memberInputs.paymentStatus.value || "unpaid");
}

function renderMemberPaymentOptions(currentStatus = "unpaid") {
  const statuses =
    Array.isArray(state.options.paymentStatuses) && state.options.paymentStatuses.length
      ? state.options.paymentStatuses
      : Object.entries(paymentLabels).map(([key, label]) => ({ key, label }));
  memberInputs.paymentStatus.innerHTML = statuses
    .map(
      (status) =>
        `<option value="${escapeAttr(status.key)}">${escapeHtml(status.label)}</option>`
    )
    .join("");
  memberInputs.paymentStatus.value = statuses.some((status) => status.key === currentStatus)
    ? currentStatus
    : "unpaid";
}

function renderStatusTabs() {
  const summaryStatuses = state.summary?.statuses || [];
  const tabs = [
    { key: "all", label: "全部", count: state.summary?.totalAccounts || 0 },
    ...summaryStatuses,
  ];

  els.tabs.innerHTML = tabs
    .map(
      (tab) => `
        <button
          class="status-tab ${state.filters.status === tab.key ? "is-active" : ""}"
          type="button"
          data-status="${escapeAttr(tab.key)}"
          aria-pressed="${state.filters.status === tab.key}"
        >
          <span>${escapeHtml(tab.label)}</span>
          <span>${escapeHtml(tab.count)}</span>
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
      if (account) openAccountModal(account, button);
    });
  });

  els.rows.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const account = state.accounts.find((item) => item.id === button.dataset.delete);
      if (account) openDeleteConfirm(account, button);
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
                ${paymentBadge(member.paymentStatus)}
              </div>
              <div class="member-money">
                <span>¥${money(member.price)}</span>
                <span class="muted">${escapeHtml(member.joinedAt)}${
                  member.leftAt ? ` - ${escapeHtml(member.leftAt)}` : ""
                }</span>
              </div>
            </div>
          `
        )
        .join("")
    : `<span class="muted">${escapeHtml((account.notes || []).join(" / ") || "本月无成员")}</span>`;

  const computedProfit = account.computedProfitCny ?? account.profit ?? 0;
  const profitClass = computedProfit < 0 ? "profit negative" : "profit";
  const costMeta =
    account.costCny === null || account.costCny === undefined
      ? "汇率待获取"
      : `约 ¥${money(account.costCny)} / ${escapeHtml(account.exchangeRate?.source || "")}`;
  const rowClass = account.renewal?.isDueSoon ? "is-due-soon" : "";

  return `
    <tr class="${rowClass}">
      <td>
        <div class="account-cell">
          <strong>${escapeHtml(account.email)}</strong>
        </div>
      </td>
      <td>
        <span class="badge ${escapeAttr(account.status)}">
          ${escapeHtml(statusLabels[account.status] || account.status)}
        </span>
      </td>
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
      <td>${renewalHtml(account.renewal)}</td>
      <td>${escapeHtml(account.openedAt)}</td>
      <td>
        <div class="row-actions">
          <button
            class="icon-button"
            type="button"
            data-edit="${escapeAttr(account.id)}"
            aria-label="编辑账号 ${escapeAttr(account.email)}"
            title="编辑账号"
          >
            <span aria-hidden="true" data-icon="edit"></span>
          </button>
          <button
            class="icon-button danger-icon-button"
            type="button"
            data-delete="${escapeAttr(account.id)}"
            aria-label="删除账号 ${escapeAttr(account.email)}"
            title="删除账号"
          >
            <span aria-hidden="true" data-icon="trash"></span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renewalHtml(renewal) {
  if (!renewal?.nextRenewalAt) return `<span class="muted">未计算</span>`;
  const daysText = countdownText(renewal.daysLeft);
  const badgeClass = renewal.isDueSoon ? "renewal-badge due" : "renewal-badge";

  return `
    <div class="renewal-cell">
      <strong>${escapeHtml(renewal.nextRenewalAt)}</strong>
      <span class="${badgeClass}">${escapeHtml(daysText)}</span>
    </div>
  `;
}

function paymentBadge(status) {
  const key = paymentLabels[status] ? status : "unpaid";
  return `<span class="payment-badge ${escapeAttr(key)}">${escapeHtml(paymentLabels[key])}</span>`;
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
      ...(account.members || []).flatMap((member) => [
        member.name,
        member.email,
        member.price,
        member.joinedAt,
        member.leftAt,
        member.paymentStatus,
        paymentLabels[member.paymentStatus] || "",
      ]),
      ...(account.notes || []),
      account.profit,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function openAccountModal(account = null, trigger = document.activeElement) {
  state.editing = account;
  state.accountDraft = createAccountDraft(account, localToday());
  els.accountModalTitle.textContent = account ? "编辑账号" : "新增账号";
  els.formError.textContent = "";
  writeAccountInputs(state.accountDraft);
  renderMemberSummaries();
  openLayer(els.accountModal, inputs.email, trigger);
}

function closeAccountModal() {
  if (state.loading.accountSave) return;
  if (isLayerOpen(els.memberModal)) closeMemberModal({ restoreFocus: false });
  closeLayer(els.accountModal);
  state.editing = null;
  state.accountDraft = null;
}

function writeAccountInputs(draft) {
  inputs.id.value = draft.id;
  inputs.email.value = draft.email;
  inputs.openedAt.value = draft.openedAt;
  inputs.status.value = draft.status;
  inputs.region.value = draft.region;
  inputs.cost.value = draft.cost;
  inputs.profit.value = draft.profit;
  inputs.notes.value = draft.notes.join("\n");
}

function renderMemberSummaries() {
  const members = state.accountDraft?.members || [];
  els.memberRows.innerHTML = members.length
    ? members.map(memberSummaryHtml).join("")
    : `<div class="inline-empty member-empty">还没有成员</div>`;
  installIcons();

  els.memberRows.querySelectorAll("[data-member-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      openMemberModal(Number(button.dataset.memberEdit), button);
    });
  });

  els.memberRows.querySelectorAll("[data-member-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.memberRemove);
      state.accountDraft = removeDraftMember(state.accountDraft, index);
      renderMemberSummaries();
      els.addMember.focus();
    });
  });
}

function memberSummaryHtml(member, index) {
  const lifecycle = member.leftAt
    ? `${member.joinedAt || "未填"} - ${member.leftAt}`
    : `${member.joinedAt || "未填"} 上车`;
  return `
    <article class="member-summary">
      <div class="member-summary-main">
        <strong>${escapeHtml(member.name || "未命名成员")}</strong>
        <span>${escapeHtml(member.email || "未填邮箱")}</span>
      </div>
      <div class="member-summary-meta">
        <strong>¥${money(member.price)}</strong>
        ${paymentBadge(member.paymentStatus)}
        <span>${escapeHtml(lifecycle)}</span>
      </div>
      <div class="member-summary-actions">
        <button
          class="icon-button"
          type="button"
          data-member-edit="${index}"
          aria-label="编辑成员 ${escapeAttr(member.name || `第 ${index + 1} 位成员`)}"
          title="编辑成员"
        >
          <span aria-hidden="true" data-icon="edit"></span>
        </button>
        <button
          class="icon-button danger-icon-button"
          type="button"
          data-member-remove="${index}"
          aria-label="移除成员 ${escapeAttr(member.name || `第 ${index + 1} 位成员`)}"
          title="移除成员"
        >
          <span aria-hidden="true" data-icon="trash"></span>
        </button>
      </div>
    </article>
  `;
}

function openMemberModal(index = null, trigger = document.activeElement) {
  if (!state.accountDraft) return;
  state.memberEditingIndex = Number.isInteger(index) ? index : null;
  const member =
    state.memberEditingIndex === null
      ? {
          name: "",
          email: "",
          price: "",
          paymentStatus: "unpaid",
          joinedAt: inputs.openedAt.value || localToday(),
          leftAt: "",
        }
      : state.accountDraft.members[state.memberEditingIndex];

  els.memberModalTitle.textContent =
    state.memberEditingIndex === null ? "新增成员" : "编辑成员";
  els.memberFormError.textContent = "";
  writeMemberInputs(member);
  openLayer(els.memberModal, memberInputs.name, trigger);
}

function closeMemberModal(options = {}) {
  closeLayer(els.memberModal, options);
  state.memberEditingIndex = null;
  els.memberFormError.textContent = "";
}

function writeMemberInputs(member) {
  memberInputs.name.value = member?.name || "";
  memberInputs.email.value = member?.email || "";
  memberInputs.price.value = member?.price ?? "";
  renderMemberPaymentOptions(member?.paymentStatus || "unpaid");
  memberInputs.joinedAt.value =
    member?.joinedAt || inputs.openedAt.value || localToday();
  memberInputs.leftAt.value = member?.leftAt || "";
}

function saveMemberDraft(event) {
  event.preventDefault();
  els.memberFormError.textContent = "";

  const name = memberInputs.name.value.trim();
  const email = memberInputs.email.value.trim();
  const price = memberInputs.price.valueAsNumber;
  const paymentStatus = memberInputs.paymentStatus.value;
  const joinedAt = memberInputs.joinedAt.value;
  const leftAt = memberInputs.leftAt.value;

  if (!name) {
    showMemberError("请填写成员名称", memberInputs.name);
    return;
  }
  if (email && !memberInputs.email.validity.valid) {
    showMemberError("请输入有效的成员邮箱", memberInputs.email);
    return;
  }
  if (!Number.isFinite(price) || price < 0) {
    showMemberError("续费价格必须是大于或等于 0 的数字", memberInputs.price);
    return;
  }
  if (!joinedAt) {
    showMemberError("请选择上车日期", memberInputs.joinedAt);
    return;
  }
  if (leftAt && leftAt < joinedAt) {
    showMemberError("下车日期不能早于上车日期", memberInputs.leftAt);
    return;
  }

  state.accountDraft = saveDraftMember(state.accountDraft, state.memberEditingIndex, {
    name,
    email,
    price,
    paymentStatus,
    joinedAt,
    leftAt,
  });
  closeMemberModal();
  renderMemberSummaries();
}

function showMemberError(message, input) {
  els.memberFormError.textContent = message;
  input.focus();
}

async function saveAccount(event) {
  event.preventDefault();
  if (!els.form.reportValidity()) return;

  els.formError.textContent = "";
  const isEdit = Boolean(state.editing);
  const endpoint = isEdit
    ? `/api/accounts/${encodeURIComponent(state.editing.id)}`
    : "/api/accounts";
  state.loading.accountSave = true;
  updateAccountSaveButton();

  try {
    await requestJson(endpoint, {
      method: isEdit ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formToAccount()),
    });
    state.loading.accountSave = false;
    updateAccountSaveButton();
    closeAccountModal();
    await Promise.allSettled([loadAccounts(), loadRenewals()]);
    showToast(isEdit ? "账号已更新" : "账号已新增");
  } catch (error) {
    const message = error.message || "保存失败";
    els.formError.textContent = message;
    showToast(message);
  } finally {
    state.loading.accountSave = false;
    updateAccountSaveButton();
  }
}

function formToAccount() {
  return {
    id: inputs.id.value,
    email: inputs.email.value.trim(),
    openedAt: inputs.openedAt.value,
    region: inputs.region.value.trim(),
    cost: inputs.cost.value.trim(),
    members: (state.accountDraft?.members || []).map((member) => ({ ...member })),
    profit: Number(inputs.profit.value),
    status: inputs.status.value,
    notes: inputs.notes.value
      .split("\n")
      .map((note) => note.trim())
      .filter(Boolean),
  };
}

function updateAccountSaveButton() {
  els.saveAccount.disabled = state.loading.accountSave;
  els.saveAccount.setAttribute("aria-busy", String(state.loading.accountSave));
  els.saveAccountLabel.textContent = state.loading.accountSave ? "保存中..." : "保存账号";
}

function openDeleteConfirm(account, trigger = document.activeElement) {
  state.pendingDelete = account;
  els.confirmAccountEmail.textContent = account.email;
  els.confirmError.textContent = "";
  openLayer(els.confirmModal, els.cancelDelete, trigger);
}

function closeDeleteConfirm() {
  if (state.loading.deleteAccount) return;
  closeLayer(els.confirmModal);
  state.pendingDelete = null;
  els.confirmError.textContent = "";
}

async function confirmDeleteAccount() {
  const account = state.pendingDelete;
  if (!account || state.loading.deleteAccount) return;
  state.loading.deleteAccount = true;
  updateDeleteButton();

  try {
    await requestJson(`/api/accounts/${encodeURIComponent(account.id)}`, {
      method: "DELETE",
    });
    state.loading.deleteAccount = false;
    updateDeleteButton();
    closeDeleteConfirm();
    await Promise.allSettled([loadAccounts(), loadRenewals()]);
    showToast("账号已删除");
  } catch (error) {
    const message = error.message || "删除失败";
    els.confirmError.textContent = message;
    showToast(message);
  } finally {
    state.loading.deleteAccount = false;
    updateDeleteButton();
  }
}

function updateDeleteButton() {
  els.confirmDelete.disabled = state.loading.deleteAccount;
  els.cancelDelete.disabled = state.loading.deleteAccount;
  els.confirmDelete.setAttribute("aria-busy", String(state.loading.deleteAccount));
  els.confirmDeleteLabel.textContent = state.loading.deleteAccount ? "删除中..." : "删除账号";
}

function openRenewalModal(trigger = document.activeElement) {
  state.renewalView = "pending";
  els.renewalError.textContent = "";
  renderRenewalWorkbench();
  const firstTab = els.renewalViewTabs.querySelector("[data-renewal-view='pending']");
  openLayer(els.renewalModal, firstTab, trigger);
  void loadRenewals();
}

function closeRenewalModal() {
  closeLayer(els.renewalModal);
  els.renewalError.textContent = "";
}

function openFinanceModal(trigger = document.activeElement) {
  state.financeView = "snapshot";
  state.snapshotMonth = state.filters.month;
  els.snapshotMonth.value = state.snapshotMonth;
  els.financeError.textContent = "";
  renderFinanceCenter();
  openLayer(els.financeModal, els.financeViewTabs.querySelector("[data-finance-view='snapshot']"), trigger);
  void Promise.allSettled([loadSnapshot(), loadBackups()]);
}

function closeFinanceModal() {
  if (state.loading.createSnapshot || state.loading.createBackup || state.loading.restoreBackup) return;
  closeLayer(els.financeModal);
  els.financeError.textContent = "";
}

async function loadSnapshot() {
  const url = new URL("/api/snapshots", window.location.origin);
  url.searchParams.set("month", state.snapshotMonth || state.filters.month);
  state.loading.snapshot = true;
  els.financeError.textContent = "";
  renderFinanceCenter();

  try {
    const payload = await requestJson(url);
    state.snapshot = payload.snapshot || null;
    state.snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
    state.snapshotMonth = payload.month || state.snapshotMonth;
    els.snapshotMonth.value = state.snapshotMonth;
    renderFinanceCenter();
    return true;
  } catch (error) {
    const message = error.message || "快照加载失败";
    els.financeError.textContent = message;
    showToast(message);
    return false;
  } finally {
    state.loading.snapshot = false;
    renderFinanceCenter();
  }
}

async function loadBackups() {
  state.loading.backups = true;
  renderFinanceCenter();

  try {
    const payload = await requestJson("/api/backups");
    state.backups = Array.isArray(payload.backups) ? payload.backups : [];
    renderFinanceCenter();
    return true;
  } catch (error) {
    const message = error.message || "备份加载失败";
    els.financeError.textContent = message;
    showToast(message);
    return false;
  } finally {
    state.loading.backups = false;
    renderFinanceCenter();
  }
}

function renderFinanceCenter() {
  if (!els.financeModal) return;

  els.financeViewTabs.querySelectorAll("[data-finance-view]").forEach((button) => {
    const active = button.dataset.financeView === state.financeView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  els.snapshotPanel.hidden = state.financeView !== "snapshot";
  els.backupPanel.hidden = state.financeView !== "backups";
  els.snapshotMonth.hidden = state.financeView !== "snapshot";
  renderSnapshotPanel();
  renderBackupPanel();
  installIcons();
}

function renderSnapshotPanel() {
  els.createSnapshot.disabled = state.loading.snapshot || state.loading.createSnapshot;
  els.createSnapshot.setAttribute("aria-busy", String(state.loading.createSnapshot));
  els.createSnapshotLabel.textContent = state.loading.createSnapshot ? "生成中..." : "生成快照";

  if (state.loading.snapshot && !state.snapshot) {
    els.snapshotStatus.innerHTML = `<div class="inline-loading">正在加载快照...</div>`;
    els.snapshotMetrics.innerHTML = "";
    els.snapshotEvents.innerHTML = "";
    els.snapshotAccounts.innerHTML = "";
    return;
  }

  if (!state.snapshot) {
    els.snapshotStatus.innerHTML = `<div class="inline-empty compact-empty">${escapeHtml(state.snapshotMonth)} 尚未生成快照</div>`;
    els.snapshotMetrics.innerHTML = "";
    els.snapshotEvents.innerHTML = "";
    els.snapshotAccounts.innerHTML = "";
    return;
  }

  const snapshot = state.snapshot;
  const totals = snapshot.totals || {};
  els.snapshotStatus.innerHTML = `
    <div class="snapshot-status-line">
      <strong>${escapeHtml(snapshot.month)} 月结算</strong>
      <span>${escapeHtml(formatDateTime(snapshot.generatedAt))} 生成</span>
    </div>
  `;
  els.snapshotMetrics.innerHTML = [
    ["收入", `¥${money(totals.revenueCny)}`],
    ["成本", `¥${money(totals.costCny)}`],
    ["利润", `¥${money(totals.profitCny)}`],
    ["待收", `¥${money(totals.receivableCny)}`],
  ]
    .map(
      ([label, value]) => `
        <article class="mini-metric">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");
  els.snapshotEvents.innerHTML = snapshotEventsHtml(snapshot.events || {});
  els.snapshotAccounts.innerHTML = snapshotAccountsHtml(snapshot.accounts || []);
}

function snapshotEventsHtml(events) {
  const joined = Array.isArray(events.joined) ? events.joined : [];
  const left = Array.isArray(events.left) ? events.left : [];
  const eventRows = [
    ...joined.map((event) => ({ ...event, type: "上车" })),
    ...left.map((event) => ({ ...event, type: "下车" })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!eventRows.length) return `<div class="inline-empty compact-empty">本月没有上下车记录</div>`;

  return eventRows
    .map(
      (event) => `
        <div class="event-row">
          <span class="event-type">${escapeHtml(event.type)}</span>
          <div>
            <strong>${escapeHtml(event.memberName || "未命名成员")}</strong>
            <span>${escapeHtml(event.accountEmail || "")}</span>
          </div>
          <time>${escapeHtml(event.date || "")}</time>
        </div>
      `
    )
    .join("");
}

function snapshotAccountsHtml(accounts) {
  if (!accounts.length) return `<div class="inline-empty compact-empty">快照内没有账号</div>`;

  return accounts
    .map(
      (account) => `
        <article class="snapshot-account">
          <div>
            <strong>${escapeHtml(account.email)}</strong>
            <span>${escapeHtml(account.region)} / ${escapeHtml(statusLabels[account.status] || account.status)}</span>
          </div>
          <div class="snapshot-account-money">
            <span>收入 ¥${money(account.revenueCny)}</span>
            <span>成本 ¥${money(account.costCny)}</span>
            <strong>利润 ¥${money(account.profitCny)}</strong>
          </div>
        </article>
      `
    )
    .join("");
}

function renderBackupPanel() {
  const selectedBackup = els.backupSelect.value;
  els.createBackup.disabled = state.loading.createBackup || state.loading.backups;
  els.createBackup.setAttribute("aria-busy", String(state.loading.createBackup));
  els.createBackupLabel.textContent = state.loading.createBackup ? "创建中..." : "创建备份";

  const hasBackups = state.backups.length > 0;
  els.backupSelect.disabled = !hasBackups || state.loading.restoreBackup;
  els.restoreBackup.disabled = !hasBackups || state.loading.restoreBackup;
  els.restoreBackup.setAttribute("aria-busy", String(state.loading.restoreBackup));
  els.restoreBackupLabel.textContent = state.loading.restoreBackup ? "恢复中..." : "恢复备份";
  els.backupSelect.innerHTML = hasBackups
    ? state.backups
        .map(
          (backup) =>
            `<option value="${escapeAttr(backup.id)}">${escapeHtml(formatBackupLabel(backup))}</option>`
        )
        .join("")
    : `<option value="">暂无备份</option>`;
  if (hasBackups && state.backups.some((backup) => backup.id === selectedBackup)) {
    els.backupSelect.value = selectedBackup;
  }

  els.backupRows.innerHTML = state.loading.backups
    ? `<div class="inline-loading">正在加载备份...</div>`
    : hasBackups
      ? state.backups.map(backupRowHtml).join("")
      : `<div class="inline-empty compact-empty">还没有备份</div>`;
}

function backupRowHtml(backup) {
  return `
    <article class="backup-row">
      <div>
        <strong>${escapeHtml(formatBackupLabel(backup))}</strong>
        <span>${escapeHtml(backup.id)}</span>
      </div>
      <div>
        <span>${escapeHtml(backup.fileCount)} 个文件</span>
        <strong>${escapeHtml(formatBytes(backup.size))}</strong>
      </div>
    </article>
  `;
}

async function createSnapshot() {
  if (state.loading.createSnapshot) return;
  state.loading.createSnapshot = true;
  els.financeError.textContent = "";
  renderFinanceCenter();

  try {
    await requestJson("/api/snapshots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month: state.snapshotMonth, overwrite: true }),
    });
    await loadSnapshot();
    showToast("结算快照已生成");
  } catch (error) {
    const message = error.message || "快照生成失败";
    els.financeError.textContent = message;
    showToast(message);
  } finally {
    state.loading.createSnapshot = false;
    renderFinanceCenter();
  }
}

async function createBackup() {
  if (state.loading.createBackup) return;
  state.loading.createBackup = true;
  els.financeError.textContent = "";
  renderFinanceCenter();

  try {
    await requestJson("/api/backups", { method: "POST" });
    await loadBackups();
    showToast("数据备份已创建");
  } catch (error) {
    const message = error.message || "备份创建失败";
    els.financeError.textContent = message;
    showToast(message);
  } finally {
    state.loading.createBackup = false;
    renderFinanceCenter();
  }
}

async function restoreBackup() {
  const backupId = els.backupSelect.value;
  if (!backupId || state.loading.restoreBackup) return;
  if (!window.confirm(`确定恢复备份 ${formatBackupLabel({ id: backupId })} 吗？当前 data JSON 会被覆盖。`)) return;

  state.loading.restoreBackup = true;
  els.financeError.textContent = "";
  renderFinanceCenter();

  try {
    await requestJson(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
      method: "POST",
    });
    await Promise.allSettled([loadAccounts(), loadRenewals(), loadSnapshot(), loadBackups()]);
    showToast("数据已从备份恢复");
  } catch (error) {
    const message = error.message || "恢复失败";
    els.financeError.textContent = message;
    showToast(message);
  } finally {
    state.loading.restoreBackup = false;
    renderFinanceCenter();
  }
}

function renderRenewalWorkbench() {
  const counts = state.renewals.counts;
  const rows =
    state.renewalView === "pending" ? state.renewals.pending : state.renewals.all;
  const isInitialLoading = state.loading.renewals && !state.renewalsLoaded;

  els.pendingRenewalCount.textContent = counts.pending;
  els.allRenewalCount.textContent = counts.all;
  els.pendingRenewalBadge.textContent = counts.pending;
  els.pendingRenewalBadge.setAttribute(
    "aria-label",
    `${counts.pending} 个待处理续费`
  );

  els.renewalViewTabs.querySelectorAll("[data-renewal-view]").forEach((button) => {
    const active = button.dataset.renewalView === state.renewalView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  els.renewalRows.setAttribute("aria-busy", String(state.loading.renewals));
  els.renewalRows.innerHTML = isInitialLoading
    ? `<div class="inline-loading">正在加载续费数据...</div>`
    : rows.map(renewalRowHtml).join("");
  els.renewalEmpty.hidden = isInitialLoading || rows.length > 0;
  els.renewalEmpty.textContent =
    state.renewalView === "pending"
      ? "当前没有待处理续费"
      : "当前月份没有可展示的续费周期";

  const sendDisabled =
    counts.pending === 0 || state.loading.sendDigest || state.loading.renewals;
  els.sendRenewalDigest.disabled = sendDisabled;
  els.sendRenewalDigest.setAttribute(
    "aria-busy",
    String(state.loading.sendDigest)
  );
  els.sendRenewalDigestLabel.textContent = state.loading.sendDigest
    ? "发送中..."
    : "发送待续费摘要";

  installIcons();
  els.renewalRows.querySelectorAll("[data-renewal-cycle]").forEach((button) => {
    button.addEventListener("click", () => {
      void setRenewalHandled(
        button.dataset.renewalCycle,
        button.dataset.renewalHandled === "true"
      );
    });
  });
  renderMetrics();
}

function renewalRowHtml(item) {
  const isHandled = Boolean(item.handledAt);
  const isLoading = state.loading.renewalAction === item.cycleKey;
  const members = (item.members || [])
    .map(
      (member) => `
        <div class="renewal-member">
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <span>${escapeHtml(member.email || "未填邮箱")}</span>
          </div>
          <span>¥${money(member.price)}</span>
        </div>
      `
    )
    .join("");
  const actionLabel = isLoading
    ? "更新中..."
    : isHandled
      ? "撤销处理"
      : "标记已处理";
  const actionIcon = isHandled ? "undo" : "check";

  return `
    <article class="renewal-item ${isHandled ? "is-handled" : ""}">
      <div class="renewal-account">
        <div class="renewal-account-title">
          <strong>${escapeHtml(item.email)}</strong>
          <span>${escapeHtml(item.region)}</span>
        </div>
        <div class="renewal-date">
          <span>${escapeHtml(item.nextRenewalAt)}</span>
          <span aria-hidden="true" data-icon="chevron-right"></span>
          <strong>${escapeHtml(countdownText(item.daysLeft))}</strong>
        </div>
      </div>

      <div class="renewal-members">
        ${members || `<span class="muted">没有在车成员</span>`}
      </div>

      <div class="renewal-total">
        <span>${escapeHtml((item.members || []).length)} 位成员</span>
        <strong>合计 ¥${money(item.totalPrice)}</strong>
      </div>

      <div class="renewal-statuses">
        <span class="${item.sentAt ? "status-line is-complete" : "status-line"}">
          ${item.sentAt ? "已发送" : "未发送"}
          <small>${item.sentAt ? escapeHtml(formatDateTime(item.sentAt)) : "尚未发送摘要"}</small>
        </span>
        <span class="${isHandled ? "status-line is-complete" : "status-line is-warning"}">
          ${isHandled ? "已处理" : "待处理"}
          <small>${isHandled ? escapeHtml(formatDateTime(item.handledAt)) : "等待确认本周期"}</small>
        </span>
      </div>

      <div class="renewal-action">
        <button
          class="${isHandled ? "secondary-button" : "primary-button"} stable-renewal-button"
          type="button"
          data-renewal-cycle="${escapeAttr(item.cycleKey)}"
          data-renewal-handled="${!isHandled}"
          ${state.loading.renewalAction ? "disabled" : ""}
          aria-busy="${isLoading}"
        >
          <span aria-hidden="true" data-icon="${actionIcon}"></span>
          <span>${actionLabel}</span>
        </button>
      </div>
    </article>
  `;
}

async function setRenewalHandled(cycleKey, handled) {
  if (state.loading.renewalAction) return;
  state.loading.renewalAction = cycleKey;
  els.renewalError.textContent = "";
  renderRenewalWorkbench();

  try {
    await requestJson(`/api/renewals/${encodeURIComponent(cycleKey)}/handled`, {
      method: handled ? "POST" : "DELETE",
      headers: handled ? { "content-type": "application/json" } : undefined,
      body: handled ? JSON.stringify({}) : undefined,
    });
    await loadRenewals();
    showToast(handled ? "续费已标记处理" : "已撤销处理状态");
  } catch (error) {
    const message = error.message || "续费状态更新失败";
    els.renewalError.textContent = message;
    showToast(message);
  } finally {
    state.loading.renewalAction = "";
    renderRenewalWorkbench();
  }
}

async function sendReminders() {
  if (
    state.loading.sendDigest ||
    state.loading.renewals ||
    state.renewals.counts.pending === 0
  ) {
    return;
  }

  state.loading.sendDigest = true;
  els.renewalError.textContent = "";
  renderRenewalWorkbench();

  try {
    const payload = await requestJson("/api/reminders/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ daysAhead: 3 }),
    });
    await Promise.allSettled([loadAccounts(), loadRenewals()]);
    showToast(
      payload.sent
        ? `已发送 ${payload.sent} 个账号续费提醒`
        : "未来 3 天没有新的待续费账号"
    );
  } catch (error) {
    const message = error.message || "发送失败";
    els.renewalError.textContent = message;
    showToast(message);
  } finally {
    state.loading.sendDigest = false;
    renderRenewalWorkbench();
  }
}

async function refreshAll() {
  if (state.loading.refresh) return;
  state.loading.refresh = true;
  els.refresh.disabled = true;
  els.refresh.setAttribute("aria-busy", "true");

  const [accountsLoaded, renewalsLoaded] = await Promise.all([
    loadAccounts(),
    loadRenewals(),
  ]);

  state.loading.refresh = false;
  els.refresh.disabled = false;
  els.refresh.setAttribute("aria-busy", "false");
  if (accountsLoaded && renewalsLoaded) showToast("账号与续费数据已刷新");
}

function openLayer(layer, focusTarget, trigger = document.activeElement) {
  if (!isLayerOpen(layer)) {
    state.modalFocusTriggers.set(layer.id, trigger);
  }
  layer.classList.add("is-open");
  layer.setAttribute("aria-hidden", "false");
  updateBodyLock();
  window.requestAnimationFrame(() => focusTarget?.focus());
}

function closeLayer(layer, options = {}) {
  if (!isLayerOpen(layer)) return;
  layer.classList.remove("is-open");
  layer.setAttribute("aria-hidden", "true");
  const trigger = state.modalFocusTriggers.get(layer.id);
  state.modalFocusTriggers.delete(layer.id);
  updateBodyLock();

  if (options.restoreFocus !== false) {
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }
}

function isLayerOpen(layer) {
  return layer.classList.contains("is-open");
}

function updateBodyLock() {
  const anyOpen = [
    els.accountModal,
    els.memberModal,
    els.renewalModal,
    els.financeModal,
    els.confirmModal,
  ].some(isLayerOpen);
  document.body.classList.toggle("modal-open", anyOpen);
}

function handleDocumentKeydown(event) {
  const topLayer = topOpenLayer();
  if (!topLayer) return;

  if (event.key === "Escape") {
    event.preventDefault();
    if (topLayer === els.confirmModal) return closeDeleteConfirm();
    if (topLayer === els.memberModal) return closeMemberModal();
    if (topLayer === els.financeModal) return closeFinanceModal();
    if (topLayer === els.renewalModal) return closeRenewalModal();
    if (topLayer === els.accountModal) closeAccountModal();
    return;
  }

  if (event.key === "Tab") trapFocus(event, topLayer);
}

function topOpenLayer() {
  return [els.confirmModal, els.memberModal, els.financeModal, els.renewalModal, els.accountModal].find(
    isLayerOpen
  );
}

function trapFocus(event, layer) {
  const focusable = Array.from(
    layer.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function requestJson(input, options) {
  const response = await fetch(input, options);
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  return payload;
}

function normalizeRenewals(payload) {
  const all = Array.isArray(payload.all) ? payload.all : [];
  const due = Array.isArray(payload.due) ? payload.due : [];
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  return {
    all,
    due,
    pending,
    counts: {
      all: Number(payload.counts?.all ?? all.length),
      due: Number(payload.counts?.due ?? due.length),
      pending: Number(payload.counts?.pending ?? pending.length),
    },
  };
}

function emptyRenewals() {
  return {
    all: [],
    due: [],
    pending: [],
    counts: { all: 0, due: 0, pending: 0 },
  };
}

function countdownText(daysLeft) {
  const days = Number(daysLeft);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  return `${days} 天`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatBackupLabel(backup) {
  const date = backup.createdAt ? formatDateTime(backup.createdAt) : backup.id || "";
  return date || String(backup.id || "");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function localToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 2600);
}

function money(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
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
    Array.from(source.content.querySelectorAll("svg")).map((svg) => [
      svg.dataset.name,
      svg.outerHTML,
    ])
  );

  document.querySelectorAll("[data-icon]").forEach((target) => {
    target.innerHTML = icons.get(target.dataset.icon) || "";
  });
}
