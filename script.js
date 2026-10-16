"use strict";

const API_URL =
  "https://script.google.com/macros/s/AKfycbzv0PeAyT31c-NldbNP7wlVEVw3GvraFW3QUm7q3utTkVzEyKk2ahuRnqCDwD8XtiIT/exec";

const QUANTITIES = [5, 10, 15, 20, 25, 30];

let appData = {
  products: [],
  sales: [],
  todayTotal: 0,
  todayCount: 0
};

let selectedQuantity = 5;
let busy = false;
const pendingRequests = new Map();

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function yen(value) {
  return Number(value || 0).toLocaleString("ja-JP");
}

function showMessage(message, isError = false) {
  const el = $("message");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;

  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

/*
 * Apps Scriptとの通信。
 * payloadをPOSTし、応答HTMLからpostMessageを受信する。
 * パスワードや売上データをURLクエリに入れない。
 */
function apiRequest(action, values = {}) {
  return new Promise((resolve, reject) => {
    if (!API_URL.startsWith("https://script.google.com/")) {
      reject(new Error(
        "script.js の API_URL にウェブアプリURLを設定してください。"
      ));
      return;
    }

    const requestId =
      Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2) + "-" +
      Math.random().toString(36).slice(2);

    const iframeName = "tf_response_" +
      requestId.replace(/[^a-zA-Z0-9_-]/g, "");

    const iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.title = "API response";
    iframe.style.display = "none";

    const form = document.createElement("form");
    form.method = "POST";
    form.action = API_URL;
    form.target = iframeName;
    form.style.display = "none";

    const payload = {
      ...values,
      action,
      requestId
    };

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(payload);
    form.appendChild(input);

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      iframe.remove();
      form.remove();

      reject(new Error(
        "サーバーから応答がありません。URLや公開設定を確認してください。"
      ));
    }, 25000);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      iframe,
      form,
      timeout
    });

    document.body.append(iframe, form);
    form.submit();
  });
}

window.addEventListener("message", event => {
  const data = event.data;

  if (!data || typeof data.requestId !== "string") return;

  const pending = pendingRequests.get(data.requestId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingRequests.delete(data.requestId);
  pending.iframe.remove();
  pending.form.remove();

  if (data.success) {
    pending.resolve(data.data);
  } else {
    pending.reject(new Error(data.error || "処理に失敗しました。"));
  }
});

async function loadData(showErrors = true) {
  try {
    const data = await apiRequest("init");

    appData = {
      ...data,
      products: data.products || [],
      sales: data.sales || []
    };

    renderSummary();
    renderProductSelect();
    renderHistory();
    renderProducts();
    updateSalePreview();

  } catch (error) {
    if (showErrors) showMessage(error.message, true);
    throw error;
  }
}

function renderSummary() {
  $("todayTotal").textContent =
    yen(appData.todayTotal);

  $("todayCount").textContent =
    yen(appData.todayCount) + " 件";

  $("productCount").textContent =
    appData.products.filter(p => p.active).length + " 種";
}

function renderProductSelect() {
  const select = $("productSelect");
  const previous = select.value;

  const active = appData.products.filter(p => p.active);

  select.innerHTML =
    '<option value="">商品を選択してください</option>' +
    active.map(p =>
      `<option value="${escapeHTML(p.id)}">` +
      `${escapeHTML(p.name)} — ${yen(p.price)}` +
      `</option>`
    ).join("");

  if (active.some(p => p.id === previous)) {
    select.value = previous;
  } else if (active.length) {
    select.value = active[0].id;
  }

  updateSalePreview();
}

function getSelectedProduct() {
  return appData.products.find(p =>
    p.id === $("productSelect").value && p.active
  );
}

function updateSalePreview() {
  const product = getSelectedProduct();

  $("unitPrice").textContent = product
    ? yen(product.price)
    : "—";

  $("saleTotal").textContent = product
    ? yen(product.price * selectedQuantity)
    : "—";
}

function renderHistory() {
  const list = $("historyList");

  if (!appData.sales.length) {
    list.innerHTML =
      '<p class="empty">まだ売上履歴がありません。</p>';
    return;
  }

  list.innerHTML = appData.sales.map(s => `
    <article class="history-item">
      <div class="item-main">
        <div class="item-title">${escapeHTML(s.product)}</div>
        <div class="item-meta">
          ${escapeHTML(s.date)} ・
          ${escapeHTML(s.staff || "スタッフ未設定")}
        </div>
        <div class="item-meta">
          ${yen(s.price)} × ${yen(s.quantity)}個
        </div>
      </div>
      <div class="item-price">${yen(s.total)}</div>
    </article>
  `).join("");
}

function renderProducts() {
  const list = $("productList");

  if (!appData.products.length) {
    list.innerHTML =
      '<p class="empty">商品が登録されていません。</p>';
    return;
  }

  list.innerHTML = appData.products.map(p => `
    <article class="product-item">
      <div class="item-main">
        <div class="item-title">${escapeHTML(p.name)}</div>
        <div class="item-meta">単価：${yen(p.price)}</div>
        <span class="badge ${p.active ? "" : "off"}">
          ${p.active ? "販売中" : "販売停止"}
        </span>
      </div>
      <div class="item-actions">
        <button class="small-btn" type="button"
          data-edit="${escapeHTML(p.id)}">編集</button>
        <button class="small-btn ${p.active ? "danger" : ""}"
          type="button"
          data-toggle="${escapeHTML(p.id)}">
          ${p.active ? "販売停止" : "販売再開"}
        </button>
      </div>
    </article>
  `).join("");
}

function setBusy(value) {
  busy = value;
  $("saleSubmit").disabled = value;
  $("productSubmit").disabled = value;
  $("refreshHistory").disabled = value;
}

function setActiveTab(tabName) {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach(panel => {
    const active = panel.id === "panel-" + tabName;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
}

function resetProductForm() {
  $("editProductId").value = "";
  $("productName").value = "";
  $("productPrice").value = "";
  $("productSubmit").textContent = "商品を追加する";
  $("cancelEdit").hidden = true;
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.tab);
  });
});

document.querySelectorAll("[data-quantity]").forEach(button => {
  button.addEventListener("click", () => {
    selectedQuantity = Number(button.dataset.quantity);

    if (!QUANTITIES.includes(selectedQuantity)) return;

    document.querySelectorAll("[data-quantity]").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    updateSalePreview();
  });
});

$("productSelect").addEventListener("change", updateSalePreview);

$("saleForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;

  const product = getSelectedProduct();
  const staff = $("staffName").value.trim();

  if (!product) {
    showMessage("販売する商品を選択してください。", true);
    return;
  }

  if (!staff) {
    showMessage("スタッフ名を入力してください。", true);
    return;
  }

  if (!QUANTITIES.includes(selectedQuantity)) {
    showMessage("数量を選び直してください。", true);
    return;
  }

  if (!confirm(
    `${product.name}\n数量：${selectedQuantity}個\n` +
    `売上：${yen(product.price * selectedQuantity)}\n\n` +
    "この内容で登録しますか？"
  )) return;

  setBusy(true);

  try {
    const result = await apiRequest("saveSale", {
      productId: product.id,
      quantity: selectedQuantity,
      staff
    });

    showMessage(result.message || "売上を登録しました。");
    await loadData(false);
    $("saleForm").reset();
    selectedQuantity = 5;

    document.querySelectorAll("[data-quantity]").forEach(button => {
      button.classList.toggle(
        "active", Number(button.dataset.quantity) === 5
      );
    });

    renderProductSelect();
    updateSalePreview();

  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
});

$("refreshHistory").addEventListener("click", async () => {
  if (busy) return;

  setBusy(true);

  try {
    await loadData();
    showMessage("データを更新しました。");
  } catch (_) {
    // loadData内でエラーを表示
  } finally {
    setBusy(false);
  }
});

$("productForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;

  const adminPassword = $("adminPassword").value;
  const name = $("productName").value.trim();
  const priceText = $("productPrice").value;
  const price = Number(priceText);

  if (!adminPassword) {
    showMessage("管理者パスワードを入力してください。", true);
    return;
  }

  if (!name || name.length > 80) {
    showMessage("商品名を1〜80文字で入力してください。", true);
    return;
  }

  if (
    priceText === "" ||
    !Number.isSafeInteger(price) ||
    price < 0 ||
    price > 1000000000
  ) {
    showMessage("単価は0以上の整数で入力してください。", true);
    return;
  }

  setBusy(true);

  try {
    const result = await apiRequest("saveProduct", {
      adminPassword,
      productId: $("editProductId").value,
      name,
      price
    });

    resetProductForm();
    $("adminPassword").value = "";

    await loadData(false);
    showMessage(result.message || "商品を保存しました。");

  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
});

$("cancelEdit").addEventListener("click", resetProductForm);

$("productList").addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit]");
  const toggleButton = event.target.closest("[data-toggle]");

  if (editButton) {
    const product = appData.products.find(p =>
      p.id === editButton.dataset.edit
    );

    if (!product) return;

    $("editProductId").value = product.id;
    $("productName").value = product.name;
    $("productPrice").value = product.price;
    $("productSubmit").textContent = "商品を更新する";
    $("cancelEdit").hidden = false;
    $("productName").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (toggleButton) {
    if (busy) return;

    const product = appData.products.find(p =>
      p.id === toggleButton.dataset.toggle
    );

    if (!product) return;

    const adminPassword = $("adminPassword").value;

    if (!adminPassword) {
      showMessage(
        "先に管理者パスワードを入力してください。", true
      );
      $("adminPassword").focus();
      return;
    }

    const operation = product.active ? "販売停止" : "販売再開";

    if (!confirm(
      `${product.name} を${operation}にしますか？`
    )) return;

    setBusy(true);

    try {
      const result = await apiRequest("toggleProduct", {
        adminPassword,
        productId: product.id
      });

      $("adminPassword").value = "";
      await loadData(false);
      showMessage(result.message || "商品状態を変更しました。");

    } catch (error) {
      showMessage(error.message, true);
    } finally {
      setBusy(false);
    }
  }
});

// 初回読み込み
(async function start() {
  try {
    await loadData();
  } catch (_) {
    // 通信エラーはloadData内で表示
  }
})();
