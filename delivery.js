/* لوحة الدليفري - Firebase Firestore */
(() => {
  'use strict';

  const state = {
    orders: [],
    unsubscribe: null,
    loading: false
  };

  const $ = (id) => document.getElementById(id);

  const STATUS = {
    ready: 'ready',
    out: 'out_for_delivery',
    delivered: 'delivered'
  };

  // حالات النظام السابقة التي قد تكون موجودة في Firestore
  const READY_STATUSES = new Set(['ready', 'prepared', 'جاهز', 'جاهز للتوصيل']);
  const OUT_STATUSES = new Set(['out_for_delivery', 'delivering', 'delivery', 'جاري التوصيل']);
  const DELIVERED_STATUSES = new Set(['delivered', 'تم التسليم', 'مسلّم', 'تم التوصيل']);

  function normalizeStatus(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (READY_STATUSES.has(s)) return STATUS.ready;
    if (OUT_STATUSES.has(s)) return STATUS.out;
    if (DELIVERED_STATUSES.has(s)) return STATUS.delivered;
    return s || 'unknown';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return value == null ? '—' : escapeHtml(value);
    return `${n.toLocaleString('ar-IQ')} د.ع`;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const date = value?.toDate ? value.toDate() : new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return date.toLocaleString('ar-IQ');
    } catch (_) {
      return '—';
    }
  }

  function getItems(order) {
    const items = order.items ?? order.cart ?? order.meals ?? order.products ?? [];
    if (Array.isArray(items)) return items;
    if (items && typeof items === 'object') return Object.values(items);
    return [];
  }

  function itemName(item) {
    return item?.name ?? item?.mealName ?? item?.title ?? item?.productName ?? 'صنف';
  }

  function itemQty(item) {
    return Number(item?.quantity ?? item?.qty ?? 1) || 1;
  }

  function orderTotal(order) {
    const value = order.total ?? order.totalPrice ?? order.grandTotal ?? order.amount ?? order.price;
    if (value != null && value !== '') return Number(value) || 0;
    return getItems(order).reduce((sum, item) => {
      const price = Number(item?.price ?? item?.unitPrice ?? 0) || 0;
      return sum + price * itemQty(item);
    }, 0);
  }

  function orderSearchText(order) {
    return [
      order.id,
      order.orderId,
      order.customerName,
      order.name,
      order.customer,
      order.phone,
      order.customerPhone,
      order.section,
      order.block,
      order.camp,
      order.area,
      order.district,
      order.tableNumber,
      order.table,
      order.address
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function statusLabel(status) {
    if (status === STATUS.ready) return 'جاهز للتوصيل';
    if (status === STATUS.out) return 'جاري التوصيل';
    if (status === STATUS.delivered) return 'تم التسليم';
    return 'غير معروف';
  }

  function showToast(message, error = false) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    el.style.background = error ? '#b91c1c' : '#111827';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function setConnectionStatus(ok, message) {
    const existing = $('dbStatus');
    if (!existing) return;
    existing.textContent = message;
    existing.className = ok ? 'db-status connected' : 'db-status disconnected';
  }

  function render() {
    const grid = $('ordersGrid');
    const empty = $('emptyState');
    if (!grid) return;

    const search = String($('searchInput')?.value ?? '').trim().toLowerCase();
    const filter = $('filterStatus')?.value ?? 'all';

    const filtered = state.orders.filter(order => {
      const status = normalizeStatus(order.status ?? order.orderStatus ?? order.state);
      const matchesStatus = filter === 'all' || status === filter;
      const matchesSearch = !search || orderSearchText(order).includes(search);
      return matchesStatus && matchesSearch;
    });

    grid.innerHTML = filtered.map(renderOrder).join('');
    empty?.classList.toggle('hidden', filtered.length !== 0);
    updateStats();
  }

  function renderOrder(order) {
    const id = order.__id || order.id || order.orderId || '—';
    const status = normalizeStatus(order.status ?? order.orderStatus ?? order.state);
    const customer = order.customerName ?? order.name ?? order.customer ?? 'غير محدد';
    const phone = order.phone ?? order.customerPhone ?? '';
    const area = order.section ?? order.block ?? order.camp ?? order.area ?? order.district ?? order.address ?? 'غير محدد';
    const table = order.tableNumber ?? order.table ?? '';
    const items = getItems(order);
    const total = orderTotal(order);
    const date = order.createdAt ?? order.timestamp ?? order.date ?? order.createdDate;

    const itemsHtml = items.length
      ? items.map(item => `<div class="item"><span>${escapeHtml(itemName(item))}</span><strong>× ${itemQty(item)}</strong></div>`).join('')
      : '<div class="item"><span>لا توجد تفاصيل أصناف</span></div>';

    let actions = '';
    if (status === STATUS.ready) {
      actions = `<button class="primary" onclick="startDelivery('${escapeHtml(id)}')">🚴 بدء التوصيل</button>`;
    } else if (status === STATUS.out) {
      actions = `<button class="success" onclick="completeDelivery('${escapeHtml(id)}')">✅ تم التسليم</button>`;
    }

    return `
      <article class="order-card">
        <div class="order-head">
          <div class="order-id">طلب #${escapeHtml(id)}</div>
          <span class="badge ${escapeHtml(status)}">${statusLabel(status)}</span>
        </div>
        <div class="info">
          <div>👤 الزبون: <strong>${escapeHtml(customer)}</strong></div>
          ${phone ? `<div>📞 الهاتف: <strong>${escapeHtml(phone)}</strong></div>` : ''}
          <div>📍 المنطقة/القاطع: <strong>${escapeHtml(area)}</strong></div>
          ${table ? `<div>🪑 الطاولة: <strong>${escapeHtml(table)}</strong></div>` : ''}
          <div>💰 المجموع: <strong>${formatMoney(total)}</strong></div>
          <div>🕒 وقت الطلب: <strong>${formatDate(date)}</strong></div>
        </div>
        <div class="items">${itemsHtml}</div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
      </article>`;
  }

  function updateStats() {
    let ready = 0, out = 0, delivered = 0;
    for (const order of state.orders) {
      const status = normalizeStatus(order.status ?? order.orderStatus ?? order.state);
      if (status === STATUS.ready) ready++;
      else if (status === STATUS.out) out++;
      else if (status === STATUS.delivered) delivered++;
    }
    if ($('readyCount')) $('readyCount').textContent = ready;
    if ($('deliveryCount')) $('deliveryCount').textContent = out;
    if ($('deliveredCount')) $('deliveredCount').textContent = delivered;
  }

  async function updateOrderStatus(id, newStatus) {
    if (!id) return;
    try {
      state.loading = true;
      const ref = db.collection('orders').doc(String(id));
      const snap = await ref.get();
      if (!snap.exists) throw new Error('لم يتم العثور على الطلب في قاعدة البيانات.');

      await ref.update({
        status: newStatus,
        orderStatus: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      showToast(newStatus === STATUS.out ? 'تم نقل الطلب إلى جاري التوصيل' : 'تم تسجيل الطلب كمُسلَّم');
    } catch (error) {
      console.error('updateOrderStatus:', error);
      showToast(`فشل تحديث الطلب: ${error.message}`, true);
    } finally {
      state.loading = false;
    }
  }

  window.startDelivery = (id) => updateOrderStatus(id, STATUS.out);
  window.completeDelivery = (id) => updateOrderStatus(id, STATUS.delivered);

  window.clearAllDelivered = async () => {
    const delivered = state.orders.filter(o => normalizeStatus(o.status ?? o.orderStatus ?? o.state) === STATUS.delivered);
    if (!delivered.length) {
      showToast('لا توجد طلبات مُسلَّمة لمسحها');
      return;
    }
    if (!confirm(`هل تريد حذف ${delivered.length} طلب/طلبات مُسلَّمة من Firestore؟`)) return;

    try {
      const batch = db.batch();
      delivered.forEach(order => batch.delete(db.collection('orders').doc(order.__id)));
      await batch.commit();
      showToast('تم حذف الطلبات المُسلَّمة من قاعدة البيانات');
    } catch (error) {
      console.error('clearAllDelivered:', error);
      showToast(`فشل الحذف: ${error.message}`, true);
    }
  };

  function subscribeToOrders() {
    if (state.unsubscribe) state.unsubscribe();

    setConnectionStatus(false, 'جاري الاتصال بقاعدة البيانات…');

    // لا نستخدم orderBy هنا لتجنب الحاجة إلى إنشاء Composite Index في Firestore.
    state.unsubscribe = db.collection('orders').onSnapshot(snapshot => {
      state.orders = snapshot.docs.map(doc => ({ __id: doc.id, ...doc.data() }));
      state.orders.sort((a, b) => {
        const av = a.createdAt?.toMillis?.() ?? a.timestamp?.toMillis?.() ?? 0;
        const bv = b.createdAt?.toMillis?.() ?? b.timestamp?.toMillis?.() ?? 0;
        return bv - av;
      });
      setConnectionStatus(true, `متصل بقاعدة البيانات • ${state.orders.length} طلب`);
      render();
    }, error => {
      console.error('Firestore listener:', error);
      setConnectionStatus(false, 'تعذر الاتصال بقاعدة البيانات');
      showToast(`خطأ Firestore: ${error.message}`, true);
      render();
    });
  }

  async function refresh() {
    try {
      const snapshot = await db.collection('orders').get();
      state.orders = snapshot.docs.map(doc => ({ __id: doc.id, ...doc.data() }));
      render();
      showToast('تم تحديث الطلبات');
    } catch (error) {
      console.error('refresh:', error);
      showToast(`فشل التحديث: ${error.message}`, true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('refreshBtn')?.addEventListener('click', refresh);
    $('searchInput')?.addEventListener('input', render);
    $('filterStatus')?.addEventListener('change', render);

    if (typeof firebase === 'undefined' || typeof db === 'undefined') {
      setConnectionStatus(false, 'Firebase غير محمّل');
      showToast('لم يتم تحميل Firebase', true);
      return;
    }

    subscribeToOrders();
  });
})();
