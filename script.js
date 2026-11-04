
/* =====================================================
   THE FRIENDLY | FRONTEND
   任意個数入力（1〜30個）・売上履歴の期間検索対応版
===================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbzv0PeAyT31c-NldbNP7wlVEVw3GvraFW3QUm7q3utTkVzEyKk2ahuRnqCDwD8XtiIT/exec";

const $ = (selector) => document.querySelector(selector);

let products = [];
let sales = [];
let staffList = [];
let adminPassword = "";
let pendingRequests = new Map();
let requestCounter = 0;

let historySearchMode = "recent";
let historySearchStart = "";
let historySearchEnd = "";
let historyLoading = false;

const MIN_QUANTITY = 1;


const money = (value) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showNotice(message, type = "success") {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.hidden = false;
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearNotice() {
  $("#notice").hidden = true;
  $("#notice").textContent = "";
}

function setBusy(button, busy, label) {
  if (!button) return;

  button.disabled = busy;

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.innerHTML;
    }
    button.textContent = label || "処理中...";
  } else if (button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

/* =====================================================
   Google Apps Script API
===================================================== */

function apiCall(action, data = {}) {
  return new Promise((resolve, reject) => {
    if (
      !API_URL ||
      API_URL.includes("ここにWebアプリのURL")
    ) {
      reject(new Error("script.js の API_URL を設定してください。"));
      return;
    }

    const requestId =
      `${Date.now()}-${++requestCounter}-${Math.random().toString(36).slice(2)}`;

    const payload = {
      ...data,
      action,
      requestId
    };

    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(
        "サーバーから応答がありません。WebアプリURL・公開設定を確認してください。"
      ));
    }, 25000);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timer
    });

    $("#api-form").action = API_URL;
    $("#api-payload").value = JSON.stringify(payload);
    $("#api-form").submit();
  });
}

window.addEventListener("message", (event) => {
  const result = event.data;

  if (!result || typeof result !== "object" || !result.requestId) {
    return;
  }

  const pending = pendingRequests.get(result.requestId);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingRequests.delete(result.requestId);

  if (result.success) {
    pending.resolve(result.data);
  } else {
    pending.reject(new Error(result.error || "処理に失敗しました。"));
  }
});

/* =====================================================
   初期データ
===================================================== */

async function loadData() {
  const data = await apiCall("init");

  products = Array.isArray(data.products) ? data.products : [];
  staffList = Array.isArray(data.staff) ? data.staff : [];

  renderStaff();
  syncReportStaff();
  renderProductSelects();
  renderHistoryFilter();
  renderProductList();
  updateTotal();
  renderDashboard();

  if (historySearchMode === "period") {
    $("#history-start-date").value = historySearchStart;
    $("#history-end-date").value = historySearchEnd;
    await searchHistory(false);
  } else {
    sales = Array.isArray(data.sales) ? data.sales : [];
    renderHistory();
    updateHistoryNote();
  }
  renderDashboard();
}

function renderStaff() {
  const select = $("#staff-select");
  const previous = select.value;

  select.replaceChildren(new Option("スタッフを選択してください", ""));

  staffList.forEach((name) => {
    select.add(new Option(name, name));
  });

  const bonusSelect = $("#bonus-staff");
  if (bonusSelect) {
    const bonusPrevious = bonusSelect.value;
    bonusSelect.replaceChildren(new Option("スタッフを選択してください", ""));
    staffList.forEach(name => bonusSelect.add(new Option(name, name)));
    if (staffList.includes(bonusPrevious)) bonusSelect.value = bonusPrevious;
  }

  if (staffList.includes(previous)) {
    select.value = previous;
  }
}

/* =====================================================
   商品選択
===================================================== */

function renderProductSelects() {
  const foodSelect = $("#food-product");
  const drinkSelect = $("#drink-product");

  const previousFood = foodSelect.value;
  const previousDrink = drinkSelect.value;

  foodSelect.replaceChildren(
    new Option("食べ物を選択してください", "")
  );

  drinkSelect.replaceChildren(
    new Option("飲み物を選択してください", "")
  );

  products
    .filter(product => product.active)
    .forEach((product) => {
      const option = new Option(
        `${product.name} — ${money(product.price)}`,
        product.id
      );

      if (product.category === "食べ物") {
        foodSelect.add(option);
      } else if (product.category === "飲み物") {
        drinkSelect.add(option);
      }
    });

  if ([...foodSelect.options].some(o => o.value === previousFood)) {
    foodSelect.value = previousFood;
  }

  if ([...drinkSelect.options].some(o => o.value === previousDrink)) {
    drinkSelect.value = previousDrink;
  }

  syncQuantityControl("food");
  syncQuantityControl("drink");
  updateTotal();
}

/* =====================================================
   数量取得・1〜30個の制限
===================================================== */

/**
 * 任意入力がある場合は任意入力を優先。
 * 空欄の場合は数量プルダウンを使用。
 * 数量は1〜30の整数のみ有効。
 */
function getQuantityInfo(type) {
  const customInput = $(`#${type}-custom-quantity`);
  const quantitySelect = $(`#${type}-quantity`);

  const customValue = customInput.value.trim();
  const selectedValue = quantitySelect.value;

  const usingCustom = customValue !== "";
  const rawValue = usingCustom ? customValue : selectedValue;

  if (rawValue === "") {
    return {
      quantity: 0,
      provided: false,
      valid: false,
      usingCustom
    };
  }

  const quantity = Number(rawValue);

  const valid =
  Number.isSafeInteger(quantity) &&
  quantity >= 1;

  return {
    quantity,
    provided: true,
    valid,
    usingCustom
  };
}

/**
 * 商品選択に応じて数量入力を有効化し、
 * 単価・小計を表示する。
 */
function syncQuantityControl(type) {
  const productSelect = $(`#${type}-product`);
  const quantitySelect = $(`#${type}-quantity`);
  const customInput = $(`#${type}-custom-quantity`);
  const priceLabel = $(`#${type}-price`);

  // 入力欄にもブラウザ側の制限を設定
  customInput.min = String(MIN_QUANTITY);
  
  customInput.step = "1";

  const product = products.find(
    item => item.id === productSelect.value && item.active
  );

  if (!product) {
    quantitySelect.value = "";
    quantitySelect.disabled = true;
    customInput.value = "";
    customInput.disabled = true;
    priceLabel.textContent = "商品未選択";
    return;
  }

  quantitySelect.disabled = false;
  customInput.disabled = false;

  const info = getQuantityInfo(type);

  if (!info.provided) {
    priceLabel.textContent =
      `単価 ${money(product.price)} ／ 数量を選択または1個以上で入力してください`;
    return;
  }

  if (!info.valid) {
  priceLabel.textContent =
    `単価 ${money(product.price)} ／ 個数は1個以上の整数で入力してください`;
  return;
}

  priceLabel.textContent =
    `${money(product.price)} × ${info.quantity}個 = ${money(product.price * info.quantity)}`;
}

/* =====================================================
   合計計算・売上登録
===================================================== */

function getSelectedItems() {
  const selected = [];

  [
    { type: "food", category: "食べ物" },
    { type: "drink", category: "飲み物" }
  ].forEach(({ type, category }) => {
    const productId = $(`#${type}-product`).value;

    if (!productId) return;

    const product = products.find(
      item => item.id === productId && item.active
    );

    if (!product) return;

    const info = getQuantityInfo(type);

    selected.push({
      productId,
      category,
      quantity: info.quantity,
      quantityProvided: info.provided,
      quantityValid: info.valid,
      product
    });
  });

  return selected;
}

function updateTotal() {
  const selected = getSelectedItems();

  const total = selected.reduce((sum, item) => {
    if (!item.quantityValid) return sum;
    return sum + item.product.price * item.quantity;
  }, 0);

  $("#total-amount").textContent = money(total);
}

$("#sales-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();

  const button = $("#submit-sale");
  const staff = $("#staff-select").value;
  const selected = getSelectedItems();

  if (!staff) {
    showNotice("スタッフ名を選択してください。", "error");
    return;
  }

  if (selected.length === 0) {
    showNotice("食べ物または飲み物の商品を選択してください。", "error");
    return;
  }

  for (const item of selected) {
    if (!item.quantityProvided) {
      showNotice(
        `${item.category}の数量を選択するか、任意の個数を入力してください。`,
        "error"
      );
      return;
    }

    if (!item.quantityValid) {
  showNotice(
    `${item.category}の個数は1個以上の整数で入力してください。`,
    "error"
  );
  return;
}
  }

  const items = selected.map(item => ({
    productId: item.productId,
    category: item.category,
    quantity: item.quantity
  }));

  setBusy(button, true, "登録中...");

  try {
    const memo = $("#sale-memo").value.trim();
    const result = await apiCall("saveSale", { staff, items, memo });

    showNotice(
      `売上を登録しました！ ${result.count}件・合計 ${money(result.total)}`,
      "success"
    );

    $("#food-product").value = "";
    $("#drink-product").value = "";

    $("#food-quantity").value = "";
    $("#drink-quantity").value = "";

    $("#food-custom-quantity").value = "";
    $("#drink-custom-quantity").value = "";
    $("#sale-memo").value = "";

    syncQuantityControl("food");
    syncQuantityControl("drink");
    updateTotal();

    await loadData();

  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

/* =====================================================
   画面切り替え
===================================================== */
function activateTab(tabName) {
  const allowed = ["dashboard", "sales", "history", "bonus", "resident-report", "products", "report-management"];
  if (!allowed.includes(tabName)) return;
  if (tabName === "report-management" && !adminPassword) {
    showNotice("注意報告の閲覧には管理者ログインが必要です。", "error");
    return;
  }
  document.querySelectorAll(".tab[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  allowed.forEach(name => {
    const panel = $(`#panel-${name}`);
    if (panel) panel.hidden = name !== tabName;
  });
  clearNotice();
  if (tabName === "dashboard") renderDashboard();
  if (tabName === "report-management" && adminPassword) loadResidentReports();
}
document.querySelectorAll(".tab[data-tab]").forEach(button => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});
document.querySelectorAll("[data-go-tab]").forEach(button => {
  button.addEventListener("click", () => activateTab(button.dataset.goTab));
});

/* =====================================================
   売上履歴
===================================================== */

function renderHistoryFilter() {
  const select = $("#history-filter");
  const previous = select.value;

  select.replaceChildren(new Option("すべてのスタッフ", ""));

  staffList.forEach((name) => {
    select.add(new Option(name, name));
  });

  if (staffList.includes(previous)) {
    select.value = previous;
  }
}

function updateHistoryNote() {
  const note = $("#history-note");
  if (!note) return;

  if (historySearchMode === "recent") {
    note.textContent =
      "直近200件を表示しています。期間を指定して検索すると、該当する全件を取得します。";
    return;
  }

  if (!historySearchStart && !historySearchEnd) {
    note.textContent =
      `全期間の売上履歴を表示しています（${sales.length}件）。スタッフを選択すると、さらに絞り込めます。`;
    return;
  }

  const startText = historySearchStart || "指定なし";
  const endText = historySearchEnd || "指定なし";

  note.textContent =
    `${startText} ～ ${endText} の売上履歴を表示しています（${sales.length}件）。日付の両端を含みます。`;
}

function renderHistory() {
  const filter = $("#history-filter").value;
  const filtered = sales.filter(item => !filter || item.staff === filter);
  const body = $("#history-body");

  body.replaceChildren();

  const total = filtered.reduce(
    (sum, item) => sum + (Number(item.total) || 0),
    0
  );

  $("#history-total").textContent = money(total);
  $("#history-count").textContent = `${filtered.length}件`;

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 7;
    cell.className = "empty-cell";
    cell.textContent = "条件に一致する売上履歴はありません。";

    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement("tr");

    [
      item.date || "",
      item.staff || "",
      item.category || "飲み物",
      item.productName || "",
      `${Number(item.quantity) || 0}個`,
      money(item.total),
      item.memo || "—"
    ].forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;

      if (index === 5) cell.className = "money";
      if (index === 6) cell.className = "report-content-cell";
      row.appendChild(cell);
    });

    body.appendChild(row);
  });
}

/* =====================================================
   ボーナス付与想定金額（月間売上の40%）
===================================================== */
function initializeBonusMonth() {
  const input = $("#bonus-month");
  if (!input || input.value) return;
  const now = new Date();
  input.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

initializeBonusMonth();

$("#calculate-bonus").addEventListener("click", async () => {
  const month = $("#bonus-month").value;
  const staff = $("#bonus-staff").value;
  const button = $("#calculate-bonus");
  if (!month || !staff) {
    showNotice("対象月とスタッフを選択してください。", "error");
    return;
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;
  setBusy(button, true, "計算中...");
  try {
    const result = await apiCall("getSalesByPeriod", { startDate, endDate });
    const monthlySales = (Array.isArray(result.sales) ? result.sales : [])
      .filter(item => item.staff === staff);
    const total = monthlySales.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    const bonus = Math.floor(total * 0.4);
    $("#bonus-amount").textContent = money(bonus);
    $("#bonus-breakdown").textContent = `${staff} ／ ${year}年${monthNumber}月
売上登録合計：${money(total)}（${monthlySales.length}件） × 40%`;
    showNotice("ボーナス付与想定金額を計算しました。", "success");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

/* =====================================================
   期間検索
===================================================== */

async function searchHistory(showMessage = true) {
  if (historyLoading) return;

  const startDate = $("#history-start-date").value;
  const endDate = $("#history-end-date").value;

  if (startDate && endDate && startDate > endDate) {
    showNotice("開始日は終了日以前の日付を指定してください。", "error");
    return;
  }

  const button = $("#search-history");
  historyLoading = true;
  setBusy(button, true, "検索中...");

  try {
    const result = await apiCall("getSalesByPeriod", {
      startDate,
      endDate
    });

    sales = Array.isArray(result.sales) ? result.sales : [];
    historySearchMode = "period";
    historySearchStart = startDate;
    historySearchEnd = endDate;

    renderHistory();
    updateHistoryNote();

    if (showMessage) {
      let periodLabel = "全期間";

      if (startDate || endDate) {
        periodLabel =
          `${startDate || "指定なし"} ～ ${endDate || "指定なし"}`;
      }

      showNotice(
        `売上履歴を検索しました。${periodLabel}／取得 ${sales.length}件`,
        "success"
      );
    }
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    historyLoading = false;
    setBusy(button, false);
  }
}

$("#search-history").addEventListener("click", () => {
  searchHistory(true);
});

$("#reset-history-period").addEventListener("click", async () => {
  $("#history-start-date").value = "";
  $("#history-end-date").value = "";

  historySearchStart = "";
  historySearchEnd = "";

  await searchHistory(true);
});

$("#history-filter").addEventListener("change", renderHistory);

$("#refresh-history").addEventListener("click", async () => {
  const button = $("#refresh-history");
  setBusy(button, true, "更新中...");

  try {
    await loadData();
    showNotice("売上履歴を更新しました。", "success");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

/* =====================================================
   管理者ログイン
===================================================== */

$("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();

  const password = $("#admin-password").value;
  const button = event.submitter || $("#admin-login-form button");

  setBusy(button, true, "確認中...");

  try {
    await apiCall("checkAdmin", { adminPassword: password });

    adminPassword = password;
    $("#admin-login").hidden = true;
    $("#admin-content").hidden = false;
    $("#admin-password").value = "";

    renderProductList();
    $(".admin-only-nav").hidden = false;
    $("#report-management-login").hidden = true;
    $("#report-management-content").hidden = false;
    showNotice("管理者としてログインしました。", "success");

  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

$("#admin-logout").addEventListener("click", () => {
  adminPassword = "";
  $("#admin-login").hidden = false;
  $("#admin-content").hidden = true;
  $(".admin-only-nav").hidden = true;
  $("#report-management-login").hidden = false;
  $("#report-management-content").hidden = true;
  resetProductForm();
  if ($("#panel-report-management") && !$("#panel-report-management").hidden) activateTab("dashboard");
  showNotice("ログアウトしました。", "success");
});

/* =====================================================
   商品管理
===================================================== */

function renderProductList() {
  const list = $("#product-list");
  list.replaceChildren();

  $("#product-count").textContent = `${products.length} ITEMS`;

  if (products.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "商品はまだ登録されていません。";
    list.appendChild(empty);
    return;
  }

  products.forEach((product) => {
    const item = document.createElement("div");
    item.className =
      `product-item${product.active ? "" : " inactive"}`;

    const info = document.createElement("div");
    info.className = "product-info";

    const name = document.createElement("strong");
    name.textContent = product.name;

    const detail = document.createElement("span");
    detail.textContent =
      `${product.category} · ${money(product.price)} · ` +
      (product.active ? "販売中" : "販売停止中");

    info.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "product-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "small-button";
    edit.textContent = "編集";
    edit.addEventListener("click", () => startEditProduct(product));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className =
      "small-button" + (product.active ? " danger" : "");
    toggle.textContent = product.active ? "販売停止" : "販売再開";
    toggle.addEventListener("click", () => toggleProduct(product));

    actions.append(edit, toggle);
    item.append(info, actions);
    list.appendChild(item);
  });
}

function startEditProduct(product) {
  $("#edit-product-id").value = product.id;
  $("#product-name").value = product.name;
  $("#product-category").value = product.category;
  $("#product-price").value = product.price;
  $("#product-form-title").textContent = "商品を編集";
  $("#save-product").querySelector("span").textContent = "変更を保存";
  $("#cancel-edit").hidden = false;

  $("#product-form").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function resetProductForm() {
  $("#product-form").reset();
  $("#edit-product-id").value = "";
  $("#product-form-title").textContent = "新しい商品を追加";
  $("#save-product").querySelector("span").textContent = "商品を保存";
  $("#cancel-edit").hidden = true;
}

$("#cancel-edit").addEventListener("click", resetProductForm);

$("#product-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();

  if (!adminPassword) {
    showNotice("先に管理者ログインをしてください。", "error");
    return;
  }

  const button = $("#save-product");
  setBusy(button, true, "保存中...");

  try {
    await apiCall("saveProduct", {
      adminPassword,
      productId: $("#edit-product-id").value,
      name: $("#product-name").value.trim(),
      category: $("#product-category").value,
      price: Number($("#product-price").value)
    });

    resetProductForm();
    await loadData();
    showNotice("商品情報を保存しました。", "success");

  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

async function toggleProduct(product) {
  if (!adminPassword) {
    showNotice("先に管理者ログインをしてください。", "error");
    return;
  }

  const action = product.active ? "販売停止" : "販売再開";

  if (!window.confirm(`${product.name} を${action}しますか？`)) {
    return;
  }

  try {
    await apiCall("toggleProduct", {
      adminPassword,
      productId: product.id
    });

    await loadData();
    showNotice(`${product.name} を${action}しました。`, "success");

  } catch (error) {
    showNotice(error.message, "error");
  }
}

/* =====================================================
   数量入力イベント
===================================================== */

["food", "drink"].forEach((type) => {
  const customInput = $(`#${type}-custom-quantity`);

  // 任意入力は1個以上の整数（上限なし）
  customInput.min = String(MIN_QUANTITY);
  customInput.removeAttribute("max");
  customInput.step = "1";

  $(`#${type}-product`).addEventListener("change", () => {
    syncQuantityControl(type);
    updateTotal();
  });

  $(`#${type}-quantity`).addEventListener("change", () => {
    syncQuantityControl(type);
    updateTotal();
  });

  customInput.addEventListener("input", () => {
    syncQuantityControl(type);
    updateTotal();
  });

  customInput.addEventListener("change", () => {
    syncQuantityControl(type);
    updateTotal();
  });
});


/* =====================================================
   DASHBOARD
===================================================== */
function renderDashboard() {
  const total = sales.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  $("#dash-sales-total").textContent = money(total);
  $("#dash-sales-count").textContent = `${sales.length}件`;
  $("#dash-product-count").textContent = `${products.length}件`;
  $("#dash-active-count").textContent = `${products.filter(p => p.active).length}件`;
  $("#dashboard-date").textContent = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short"
  }).format(new Date());
  const list = $("#dashboard-recent");
  if (!list) return;
  list.replaceChildren();
  const recent = sales.slice(0, 5);
  if (!recent.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "売上履歴はまだありません。";
    list.appendChild(empty);
    return;
  }
  recent.forEach(item => {
    const row = document.createElement("div");
    row.className = "recent-item";
    const left = document.createElement("span");
    left.textContent = `${item.date || ""} · ${item.staff || ""} · ${item.productName || ""}`;
    const right = document.createElement("strong");
    right.textContent = money(item.total);
    row.append(left, right);
    list.appendChild(row);
  });
}

/* =====================================================
   住民の注意報告
===================================================== */
$("#resident-report-form").addEventListener("submit", async event => {
  event.preventDefault();
  clearNotice();
  const button = $("#submit-resident-report");
  const payload = {
    staff: $("#report-staff").value,
    residentId: $("#resident-id").value.trim(),
    residentName: $("#resident-name").value.trim(),
    content: $("#resident-report-content").value.trim()
  };
  if (!payload.staff || !payload.residentId || !payload.residentName || !payload.content) {
    showNotice("すべての項目を入力してください。", "error");
    return;
  }
  setBusy(button, true, "送信中...");
  try {
    const result = await apiCall("submitResidentReport", payload);
    $("#resident-report-form").reset();
    showNotice(result.message || "注意報告を送信しました。", "success");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

function syncReportStaff() {
  const select = $("#report-staff");
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(new Option("スタッフを選択してください", ""));
  staffList.forEach(name => select.add(new Option(name, name)));
  if (staffList.includes(previous)) select.value = previous;
}

async function loadResidentReports() {
  if (!adminPassword) return;
  const body = $("#report-management-body");
  body.innerHTML = '<tr><td colspan="7" class="empty-cell">読み込み中...</td></tr>';
  try {
    const result = await apiCall("getResidentReports", { adminPassword });
    const reports = Array.isArray(result.reports) ? result.reports : [];
    const pending = reports.filter(r => r.status !== "対応済み").length;
    $("#report-pending-count").textContent = `${pending}件`;
    $("#report-done-count").textContent = `${reports.length - pending}件`;
    renderResidentReports(reports);
  } catch (error) {
    body.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-cell";
    cell.textContent = error.message;
    row.appendChild(cell);
    body.appendChild(row);
  }
}

let cachedResidentReports = [];
function renderResidentReports(reports) {
  cachedResidentReports = reports;
  const filter = $("#report-status-filter").value;
  const filtered = reports.filter(r => !filter || r.status === filter);
  const body = $("#report-management-body");
  body.replaceChildren();
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty-cell";
    cell.textContent = "該当する注意報告はありません。";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }
  filtered.forEach(report => {
    const row = document.createElement("tr");
    const values = [report.date, report.staff, report.residentId, report.residentName];
    values.forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value || "";
      row.appendChild(cell);
    });
    const content = document.createElement("td");
    content.className = "report-content-cell";
    content.textContent = report.content || "";
    row.appendChild(content);
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge${report.status === "対応済み" ? " done" : ""}`;
    badge.textContent = report.status || "未対応";
    statusCell.appendChild(badge);
    row.appendChild(statusCell);
    const actions = document.createElement("td");
    const actionWrap = document.createElement("div");
    actionWrap.className = "report-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "small-button";
    toggle.textContent = report.status === "対応済み" ? "未対応に戻す" : "対応済みにする";
    toggle.addEventListener("click", () => updateResidentReportStatus(report.reportId, report.status === "対応済み" ? "未対応" : "対応済み"));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "small-button danger";
    del.textContent = "削除";
    del.addEventListener("click", () => deleteResidentReport(report.reportId));
    actionWrap.append(toggle, del);
    actions.appendChild(actionWrap);
    row.appendChild(actions);
    body.appendChild(row);
  });
}

async function updateResidentReportStatus(reportId, status) {
  if (!adminPassword) return;
  try {
    await apiCall("updateResidentReportStatus", { adminPassword, reportId, status });
    await loadResidentReports();
    showNotice("対応状況を更新しました。", "success");
  } catch (error) { showNotice(error.message, "error"); }
}

async function deleteResidentReport(reportId) {
  if (!adminPassword) return;
  if (!confirm("この注意報告を削除しますか？この操作は取り消せません。")) return;
  try {
    await apiCall("deleteResidentReport", { adminPassword, reportId });
    await loadResidentReports();
    showNotice("注意報告を削除しました。", "success");
  } catch (error) { showNotice(error.message, "error"); }
}

$("#refresh-reports").addEventListener("click", loadResidentReports);
$("#report-status-filter").addEventListener("change", () => renderResidentReports(cachedResidentReports));

/* =====================================================
   起動
===================================================== */

(async function start() {
  try {
    await loadData();
  } catch (error) {
    showNotice(
      `初期データを取得できませんでした。${error.message}`,
      "error"
    );
  }
})();
