'use strict';

// =============================================================
// delivery.js — يستخدم Firebase Compat SDK (مثل chef.js تماماً)
// db معرّف في delivery.html
// =============================================================

const ordersGrid   = document.getElementById("ordersGrid");
const emptyState   = document.getElementById("emptyState");
const searchInput  = document.getElementById("searchInput");
const filterStatus = document.getElementById("filterStatus");
const refreshBtn   = document.getElementById("refreshBtn");

let orders = [];

// ── تعريف الحالات المقبولة في صفحة الدليفري ──────────────────
// الشيف يضع الطلب "ready" ← هذه نقطة الالتقاء
const DELIVERY_STATUSES = ["ready", "out_for_delivery", "delivered"];

const statusText = {
  ready:            "جاهز للتوصيل",
  out_for_delivery: "جاري التوصيل",
  delivered:        "تم التسليم"
};

// ── تطبيع حقول الطلب (يدعم أي مصدر: index/info/chef) ─────────
function normalizeOrder(id, data) {
  // تطبيع الحالة
  const raw = data.status || "new";
  let status = raw;
  if (raw === "ready_for_delivery" || raw === "prepared")      status = "ready";
  if (raw === "delivering"         || raw === "on_delivery")   status = "out_for_delivery";
  if (raw === "completed")                                     status = "delivered";

  // تطبيع العناصر — info.html يحفظ qty بدلاً من quantity
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = rawItems.map(item => ({
    name:     item.name     || item.title    || "صنف",
    quantity: Number(item.quantity ?? item.qty ?? 1),
    price:    Number(item.price ?? 0)
  }));

  // تطبيع العنوان — info.html يحفظ district + tent
  const address = data.address ||
    [data.district && `القاطع ${data.district}`,
     data.tent     && `خيمة ${data.tent}`].filter(Boolean).join(" – ") ||
    "";

  return {
    id,
    ...data,
    status,
    customer: data.customerName ?? data.customer ?? "زبون",
    phone:    data.phone        ?? data.customerPhone ?? "",
    table:    data.tableNumber  ?? data.table ?? "-",
    address,
    district: data.district ?? "",
    tent:     data.tent     ?? "",
    total:    Number(data.total ?? data.totalPrice ?? 0),
    items
  };
}

// ── تنسيق المبلغ ──────────────────────────────────────────────
function formatMoney(v) {
  return `${Number(v).toLocaleString("ar-IQ")} د.ع`;
}

// ── تنسيق التاريخ ─────────────────────────────────────────────
function formatDate(v) {
  if (!v) return "—";
  try {
    const d = v.toDate ? v.toDate() :
              (typeof v === "string" ? new Date(v) : new Date(v));
    return d.toLocaleString("ar-IQ");
  } catch { return "—"; }
}

// ── رسم الطلبات ───────────────────────────────────────────────
function render() {
  const search = searchInput.value.trim().toLowerCase();
  const filter = filterStatus.value;

  const visible = orders.filter(o => {
    const matchStatus = filter === "all" || o.status === filter;
    const hay = `${o.id} ${o.customer} ${o.phone} ${o.address} ${o.district} ${o.tent} ${o.table}`.toLowerCase();
    return matchStatus && hay.includes(search);
  });

  ordersGrid.innerHTML = "";
  emptyState.classList.toggle("hidden", visible.length !== 0);

  for (const order of visible) {
    const card = document.createElement("article");
    card.className = "order-card";

    // عناصر الطلب
    const itemsHtml = order.items.length
      ? order.items.map(it =>
          `<div class="item">
             <span>${escapeHtml(it.name)} × ${it.quantity}</span>
             <span>${formatMoney(it.price * it.quantity)}</span>
           </div>`).join("")
      : `<div class="item"><span>تفاصيل الوجبات غير متوفرة</span></div>`;

    // أزرار الإجراء
    let actions = "";
    if (order.status === "ready") {
      actions = `<button class="primary" data-action="start" data-id="${order.id}">🚴 استلام وبدء التوصيل</button>`;
    } else if (order.status === "out_for_delivery") {
      actions = `<button class="success" data-action="deliver" data-id="${order.id}">✅ تم التسليم</button>`;
    } else {
      actions = `<button class="secondary" disabled>تم التسليم ✓</button>`;
    }

    // عنوان التوصيل
    const addressLine = order.address
      ? `<div>📍 العنوان: <b>${escapeHtml(order.address)}</b></div>`
      : "";

    // ملاحظات
    const notesLine = order.notes
      ? `<div>📝 ملاحظات: ${escapeHtml(order.notes)}</div>`
      : "";

    card.innerHTML = `
      <div class="order-head">
        <div>
          <div class="order-id">طلب #${escapeHtml(order.id.slice(-8).toUpperCase())}</div>
          <small>${formatDate(order.createdAt || order.time)}</small>
        </div>
        <span class="badge ${order.status}">${statusText[order.status] ?? order.status}</span>
      </div>
      <div class="info">
        <div>👤 الزبون: ${escapeHtml(String(order.customer))}</div>
        ${order.phone ? `<div>📞 الهاتف: ${escapeHtml(String(order.phone))}</div>` : ""}
        ${addressLine}
        ${notesLine}
        <div>💰 الإجمالي: <b>${formatMoney(order.total)}</b></div>
      </div>
      <div class="items">${itemsHtml}</div>
      <div class="actions">${actions}</div>
    `;

    ordersGrid.appendChild(card);
  }

  // إحصائيات
  document.getElementById("readyCount").textContent =
    orders.filter(o => o.status === "ready").length;
  document.getElementById("deliveryCount").textContent =
    orders.filter(o => o.status === "out_for_delivery").length;
  document.getElementById("deliveredCount").textContent =
    orders.filter(o => o.status === "delivered").length;
}

// ── تحديث حالة الطلب ─────────────────────────────────────────
async function changeStatus(id, status) {
  try {
    const update = {
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (status === "out_for_delivery") update.deliveryStartedAt = firebase.firestore.FieldValue.serverTimestamp();
    if (status === "delivered")        update.deliveredAt       = firebase.firestore.FieldValue.serverTimestamp();

    await db.collection("orders").doc(id).update(update);
    showToast(status === "delivered" ? "✅ تم تسجيل التسليم بنجاح" : "🚴 تم استلام الطلب وبدء التوصيل");
  } catch (err) {
    console.error(err);
    showToast("❌ خطأ أثناء تحديث الطلب");
  }
}

// ── تفويض أحداث الأزرار ──────────────────────────────────────
ordersGrid.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === "start")   changeStatus(id, "out_for_delivery");
  if (action === "deliver") changeStatus(id, "delivered");
});

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

// ── HTML Escape ───────────────────────────────────────────────
function escapeHtml(v) {
  return String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ── أحداث UI ─────────────────────────────────────────────────
searchInput.addEventListener("input",  render);
filterStatus.addEventListener("change", render);
refreshBtn.addEventListener("click",   () => location.reload());

// ── الاشتراك في Firestore (Compat API) ──────────────────────
// نستمع للطلبات ذات الحالات: ready, out_for_delivery, delivered
db.collection("orders")
  .where("status", "in", DELIVERY_STATUSES)
  .orderBy("createdAt", "desc")
  .onSnapshot(snapshot => {
    orders = snapshot.docs.map(d => normalizeOrder(d.id, d.data()));
    render();
  }, err => {
    console.error(err);
    showToast("❌ تعذر الاتصال بقاعدة البيانات");
  });
