
/* =====================================================
   THE FRIENDLY | FRONTEND
===================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbzv0PeAyT31c-NldbNP7wlVEVw3GvraFW3QUm7q3utTkVzEyKk2ahuRnqCDwD8XtiIT/exec";

const $ = (selector) => document.querySelector(selector);

let products = [];
let sales = [];
let staffList = [];
let adminPassword = "";
let pendingRequests = new Map();
let requestCounter = 0;

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
    button.dataset.originalText = button.innerHTML;
    button.textContent = label || "処理中...";
  } else if (button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

/**
 * Google Apps Script API呼び出し
 * hidden iframe + POSTフォーム方式
 */
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

/**
 * Apps Scriptのレスポンスを受け取る
 */
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

/**
 * 初期データの取得
 */
async function loadData() {
  const data = await apiCall("init");

  products = Array.isArray(data.products) ? data.products : [];
  sales = Array.isArray(data.sales) ? data.sales : [];
  staffList = Array.isArray(data.staff) ? data.staff : [];

  renderStaff();
  renderProductSelects();
  renderHistoryFilter();
  renderHistory();
  renderProductList();
  updateTotal();
}

/**
 * スタッフのプルダウン
 */
function renderStaff() {
  const select = $("#staff-select");
  const previous = select.value;

  select.replaceChildren(new Option("スタッフを選択してください", ""));

  staffList.forEach((name) => {
    select.add(new Option(name, name));
  });

  if (staffList.includes(previous)) {
    select.value = previous;
  }
}

/**
 * 食べ物・飲み物それぞれの商品プルダウンを作る
 */
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

/**
 * 商品が選ばれている場合だけ数量を選択可能にする
 */
function syncQuantityControl(type) {
  const productSelect = $(`#${type}-product`);
  const quantitySelect = $(`#${type}-quantity`);
  const priceLabel = $(`#${type}-price`);

  if (!productSelect.value) {
    quantitySelect.value = "";
    quantitySelect.disabled = true;
    priceLabel.textContent = "商品未選択";
    return;
  }

  quantitySelect.disabled = false;

  const product = products.find(
    item => item.id === productSelect.value && item.active
  );

  if (!product) {
    productSelect.value = "";
    quantitySelect.value = "";
    quantitySelect.disabled = true;
    priceLabel.textContent = "商品未選択";
    return;
  }

  const quantity = Number(quantitySelect.value) || 0;
  priceLabel.textContent = quantity
    ? `${money(product.price)} × ${quantity}個 = ${money(product.price * quantity)}`
    : `単価 ${money(product.price)} ／ 数量を選択してください`;
}

/**
 * 選択中の売上合計
 */
function getSelectedItems() {
  const selected = [];

  [
    { type: "food", category: "食べ物" },
    { type: "drink", category: "飲み物" }
  ].forEach(({ type, category }) => {
    const productId = $(`#${type}-product`).value;
    const quantityValue = $(`#${type}-quantity`).value;

    if (!productId) return;

    const product = products.find(
      item => item.id === productId && item.active
    );

    if (!product) return;

    selected.push({
      productId,
      category,
      quantity: Number(quantityValue),
      product
    });
  });

  return selected;
}

function updateTotal() {
  const selected = getSelectedItems();

  const total = selected.reduce((sum, item) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return sum;
    }
    return sum + item.product.price * item.quantity;
  }, 0);

  $("#total-amount").textContent = money(total);
}

/**
 * 売上登録
 */
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
    if (![5, 10, 15, 20, 25, 30].includes(item.quantity)) {
      showNotice("選択した商品の数量を指定してください。", "error");
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
    const result = await apiCall("saveSale", { staff, items });

    showNotice(
      `売上を登録しました！ ${result.count}件・合計 ${money(result.total)}`,
      "success"
    );

    $("#food-product").value = "";
    $("#drink-product").value = "";
    $("#food-quantity").value = "";
    $("#drink-quantity").value = "";

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

/**
 * タブ切り替え
 */
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tab => {
      tab.classList.toggle("active", tab === button);
    });

    ["sales", "history", "products"].forEach((tab) => {
      $(`#panel-${tab}`).hidden = button.dataset.tab !== tab;
    });

    clearNotice();
  });
});

/**
 * 売上履歴のスタッフ絞り込み
 */
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

function renderHistory() {
  const filter = $("#history-filter").value;
  const filtered = sales.filter(item => !filter || item.staff === filter);
  const body = $("#history-body");

  body.replaceChildren();

  const total = filtered.reduce((sum, item) => sum + item.total, 0);
  $("#history-total").textContent = money(total);
  $("#history-count").textContent = `${filtered.length}件`;

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-cell";
    cell.textContent = "売上履歴はまだありません。";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  filtered.forEach((item) => {
    const row = document.createElement("tr");

    [
      item.date,
      item.staff,
      item.category || "飲み物",
      item.productName,
      `${item.quantity}個`,
      money(item.total)
    ].forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;

      if (index === 5) cell.className = "money";
      row.appendChild(cell);
    });

    body.appendChild(row);
  });
}

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

/**
 * 管理者ログイン
 * Code.gs側の checkAdmin でパスワードを検証する
 */
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
  resetProductForm();
  showNotice("ログアウトしました。", "success");
});

/**
 * 商品一覧（管理者画面）
 */
function renderProductList() {
  const list = $("#product-list");
  list.replaceChildren();

  $("#product-count").textContent =
    `${products.length} ITEMS`;

  if (products.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "商品はまだ登録されていません。";
    list.appendChild(empty);
    return;
  }

  products.forEach((product) => {
    const item = document.createElement("div");
    item.className = `product-item${product.active ? "" : " inactive"}`;

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
    toggle.className = "small-button" + (product.active ? " danger" : "");
    toggle.textContent = product.active ? "販売停止" : "販売再開";
    toggle.addEventListener("click", () => toggleProduct(product));

    actions.append(edit, toggle);
    item.append(info, actions);
    list.appendChild(item);
  });
}

/**
 * 商品追加・編集フォーム
 */
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

/**
 * 商品の販売停止・再開
 */
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

/**
 * 商品・数量の変更イベント
 */
["food", "drink"].forEach((type) => {
  $(`#${type}-product`).addEventListener("change", () => {
    syncQuantityControl(type);
    updateTotal();
  });

  $(`#${type}-quantity`).addEventListener("change", () => {
    syncQuantityControl(type);
    updateTotal();
  });
});

/**
 * 初期化
 */
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
