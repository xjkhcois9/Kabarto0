'use strict';

const ordersContainer = document.getElementById('ordersContainer');
const template = document.getElementById('orderTemplate');
const searchInput = document.getElementById('search');
const refreshBtn = document.getElementById('refreshBtn');

let orders = [];
let unsubscribeOrders = null;
let timerIntervals = new Map();
let currentSearch = '';
let isUpdating = false;

const ACTIVE_STATUSES = ['new', 'preparing', 'ready'];

function clearAllTimers() {
    timerIntervals.forEach(interval => clearInterval(interval));
    timerIntervals.clear();
}

function loadOrders() {
    clearAllTimers();

    if (unsubscribeOrders) {
        unsubscribeOrders();
        unsubscribeOrders = null;
    }

    ordersContainer.innerHTML = '<div class="empty-msg" style="grid-column:1/-1;text-align:center;padding:40px;color:#9ca3af;font-size:1.1rem;background:#1c2536;border-radius:12px;">جاري تحميل الطلبات…</div>';

    // نعرض فقط الطلبات التي ما زالت تحتاج إلى إجراء من الشيف.
    // هذا يمنع الطلبات المقدمة من البقاء في شاشة الشيف.
    unsubscribeOrders = db.collection('orders')
        .where('status', 'in', ACTIVE_STATUSES)
        .onSnapshot(snapshot => {
            orders = snapshot.docs.map(doc => ({
                ...doc.data(),
                firebaseId: doc.id
            }));

            // الطلبات الجديدة (new) تظهر أولاً، ثم قيد التحضير، ثم الجاهزة
            // وداخل كل حالة: الأحدث في الأعلى
            const statusPriority = { new: 0, preparing: 1, ready: 2 };
            orders.sort((a, b) => {
                const pa = statusPriority[a.status] ?? 9;
                const pb = statusPriority[b.status] ?? 9;
                if (pa !== pb) return pa - pb;
                return getTimestamp(b.createdAt || b.time) - getTimestamp(a.createdAt || a.time);
            });

            displayOrders();
            updateStatistics();
        }, error => {
            console.error('Firebase orders error:', error);
            orders = [];
            clearAllTimers();
            ordersContainer.innerHTML = '<div class="empty-msg" style="grid-column:1/-1;text-align:center;padding:40px;color:#ef4444;font-size:1.1rem;background:#1c2536;border-radius:12px;">تعذر تحميل الطلبات من Firebase. تحقق من الاتصال وقواعد Firestore.</div>';
        });
}

function getTimestamp(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
}

function getItemName(item) {
    if (!item) return 'صنف غير معروف';
    if (typeof item === 'string') return item;
    if (typeof item === 'object') {
        return item.name || item.title || item.itemName || item.foodName || item.productName || item.item || 'صنف غير مسمى';
    }
    return String(item);
}

function getItemQuantity(item) {
    if (typeof item === 'object' && item !== null) {
        const quantity = item.quantity ?? item.qty ?? item.count ?? item.amount;
        const number = Number(quantity);
        return Number.isFinite(number) && number > 0 ? number : 1;
    }
    return 1;
}

function getOrderItems(order) {
    const items = order.items || order.cart || order.foods || [];
    return Array.isArray(items) ? items : [];
}

function displayOrders() {
    clearAllTimers();
    ordersContainer.innerHTML = '';

    const filteredOrders = orders.filter(order => {
        const table = String(order.table || order.tableNumber || '').toLowerCase();
        return table.includes(currentSearch);
    });

    if (filteredOrders.length === 0) {
        ordersContainer.innerHTML = `<div class="empty-msg" style="grid-column:1/-1;text-align:center;padding:40px;color:#9ca3af;font-size:1.1rem;background:#1c2536;border-radius:12px;">${currentSearch ? 'لا توجد نتائج مطابقة للبحث 🔍' : 'لا توجد طلبات حالياً 🍽️'}</div>`;
        return;
    }

    filteredOrders.forEach(order => {
        const card = template.content.cloneNode(true);
        const cardRoot = card.querySelector('.order-card');

        card.querySelector('.tableNumber').textContent = order.table || order.tableNumber || '-';

        const status = card.querySelector('.status');
        status.textContent = getStatusText(order.status);
        status.className = 'status ' + getSafeStatusClass(order.status);

        const itemsContainer = card.querySelector('.items');
        getOrderItems(order).forEach(item => {
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.gap = '8px';

            const name = document.createElement('span');
            name.textContent = '🍽️ ' + getItemName(item);

            const qty = document.createElement('strong');
            qty.textContent = '× ' + getItemQuantity(item);
            qty.style.cssText = 'background:#2563eb;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;white-space:nowrap;';

            li.appendChild(name);
            li.appendChild(qty);
            itemsContainer.appendChild(li);
        });

        card.querySelector('.notes').textContent = order.notes && String(order.notes).trim() !== '' ? order.notes : 'لا توجد ملاحظات';

        const timeElement = card.querySelector('.time');
        startTimer(order, timeElement);

        const startBtn = card.querySelector('.startBtn');
        const finishBtn = card.querySelector('.finishBtn');

        startBtn.disabled = order.status !== 'new' || isUpdating;
        finishBtn.disabled = order.status !== 'preparing' || isUpdating;

        startBtn.onclick = () => updateOrderStatus(order, 'preparing');
        finishBtn.onclick = () => updateOrderStatus(order, 'ready');

        // منع أي زر داخل البطاقة من التأثير على البطاقات الأخرى.
        if (cardRoot) cardRoot.dataset.orderId = order.firebaseId;

        ordersContainer.appendChild(card);
    });
}

async function updateOrderStatus(order, newStatus) {
    if (!order || !order.firebaseId || isUpdating) return;

    if (newStatus === 'preparing' && order.status !== 'new') return;
    if (newStatus === 'ready' && order.status !== 'preparing') return;

    isUpdating = true;
    displayOrders();

    const updateData = {};

    if (newStatus === 'preparing') {
        updateData.status = 'preparing';
        updateData.startTime = Date.now();
        updateData.timerStopped = false;
    }

    if (newStatus === 'ready') {
        updateData.status = 'ready';
        updateData.timerStopped = true;
        updateData.finishTime = Date.now();
    }

    try {
        await db.collection('orders').doc(order.firebaseId).update(updateData);
    } catch (error) {
        console.error('Firebase update error:', error);
        alert('تعذر تحديث حالة الطلب. حاول مرة أخرى.');
    } finally {
        isUpdating = false;
        displayOrders();
    }
}

function getSafeStatusClass(status) {
    return ['new', 'preparing', 'ready', 'delivered'].includes(status) ? status : 'new';
}

function getStatusText(status) {
    switch (status) {
        case 'new': return 'جديد';
        case 'preparing': return 'قيد التحضير';
        case 'ready': return 'جاهز';
        case 'delivered': return 'تم التقديم';
        default: return 'غير معروف';
    }
}

function updateStatistics() {
    document.getElementById('newCount').textContent = orders.filter(order => order.status === 'new').length;
    document.getElementById('preparingCount').textContent = orders.filter(order => order.status === 'preparing').length;
    document.getElementById('readyCount').textContent = orders.filter(order => order.status === 'ready').length;
}

function formatElapsed(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function startTimer(order, element) {
    if (!order || !element || !order.firebaseId) return;

    const start = getTimestamp(order.startTime);
    const finish = getTimestamp(order.finishTime);
    const created = getTimestamp(order.createdAt || order.time);

    const update = () => {
        if (order.status === 'preparing' && start) {
            element.textContent = formatElapsed((Date.now() - start) / 1000);
            return;
        }

        if (order.status === 'ready' && start) {
            const end = finish || Date.now();
            element.textContent = formatElapsed((end - start) / 1000);
            return;
        }

        // الطلب الجديد يعرض وقت الانتظار منذ وصوله، بدون تشغيل مؤقت تحضير.
        if (order.status === 'new' && created) {
            element.textContent = formatElapsed((Date.now() - created) / 1000);
            return;
        }

        element.textContent = '00:00';
    };

    update();

    if (order.status === 'new' || order.status === 'preparing') {
        const interval = setInterval(update, 1000);
        timerIntervals.set(order.firebaseId, interval);
    }
}

refreshBtn.onclick = () => loadOrders();

searchInput.addEventListener('input', function () {
    currentSearch = this.value.trim().toLowerCase();
    displayOrders();
});

window.addEventListener('beforeunload', () => {
    clearAllTimers();
    if (unsubscribeOrders) unsubscribeOrders();
});

loadOrders();
