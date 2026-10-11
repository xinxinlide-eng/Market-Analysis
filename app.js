'use strict';

// ---------- Helpers ----------

const STORAGE_KEY = 'market-stall-v1';
const $ = (sel, root = document) => root.querySelector(sel);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const eur = n => '€' + n.toFixed(2);
const rmb = n => '¥' + n.toFixed(2);
const pct = n => Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '–';
const today = () => new Date().toISOString().slice(0, 10);
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);

// ---------- State ----------

function defaultState() {
  return {
    settings: { rate: 0.13 }, // 1 RMB in EUR
    categories: ['Tops', 'Skirts', 'Belts', 'Hair decorations'].map(name => ({ id: uid(), name })),
    products: [], // { id, name, categoryId, priceRmb, shippingEur, stock, photo }
    days: [],     // { id, date, notes, coins, paypalStart, actualCash, actualPaypal, sales: [...] }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to a fresh state */ }
  return defaultState();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    alert('Could not save: browser storage may be full. Export a backup in Settings and remove some photos.');
  }
}

let state = load();
const ui = {
  tab: 'products',
  productFilter: '',
  editingProductId: null,
  pendingPhoto: null,
  currentDayId: null,
  saleCategoryId: '',
};

const categoryName = id => state.categories.find(c => c.id === id)?.name ?? 'Uncategorised';
const productById = id => state.products.find(p => p.id === id);
// Landed cost of one item in EUR: purchase price converted + estimated shipping share.
const productCost = p => p.priceRmb * state.settings.rate + p.shippingEur;

const categoryOptions = selected => state.categories
  .map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`)
  .join('');

// ---------- Rendering ----------

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === ui.tab));
  ({ products: renderProducts, day: renderDay, analysis: renderAnalysis, settings: renderSettings })[ui.tab]();
}

function renderProducts() {
  const editing = productById(ui.editingProductId);
  const p = editing || { name: '', categoryId: state.categories[0]?.id, priceRmb: '', shippingEur: '', stock: 1, photo: '' };
  const photo = ui.pendingPhoto ?? p.photo;
  const list = state.products.filter(x => !ui.productFilter || x.categoryId === ui.productFilter);

  $('#products').innerHTML = `
    <form id="product-form" class="card">
      <h2>${editing ? 'Edit product' : 'Add product'}</h2>
      ${state.categories.length ? '' : '<p class="hint">Add a category in Settings first.</p>'}
      <label>Photo / screenshot <input type="file" id="photo-input" accept="image/*"></label>
      <img id="photo-preview" class="thumb-lg" src="${photo || ''}" ${photo ? '' : 'hidden'} alt="">
      <label>Name <input name="name" required value="${esc(p.name)}"></label>
      <label>Category <select name="categoryId" required>${categoryOptions(p.categoryId)}</select></label>
      <div class="row">
        <label>Price (RMB) <input name="priceRmb" inputmode="decimal" required value="${p.priceRmb}"></label>
        <label>Shipping per item (€) <input name="shippingEur" inputmode="decimal" value="${p.shippingEur}"></label>
        <label>In stock <input name="stock" type="number" min="0" step="1" required value="${p.stock}"></label>
      </div>
      <p class="hint" id="cost-preview"></p>
      <div class="actions">
        <button type="submit" class="primary">${editing ? 'Save changes' : 'Add product'}</button>
        ${editing ? '<button type="button" data-action="cancel-edit">Cancel</button>' : ''}
      </div>
    </form>
    <div class="card">
      <div class="list-head">
        <h2>Stock (${sum(list, x => x.stock)} items)</h2>
        <select id="product-filter"><option value="">All categories</option>${categoryOptions(ui.productFilter)}</select>
      </div>
      ${list.length ? `<ul class="items">${list.map(productItem).join('')}</ul>` : '<p class="empty">No products yet.</p>'}
    </div>`;
  updateCostPreview();
}

function productItem(p) {
  return `<li>
    ${p.photo ? `<img class="thumb" src="${p.photo}" alt="">` : '<div class="thumb"></div>'}
    <div class="info">
      <strong>${esc(p.name)}</strong>
      <span class="muted">${esc(categoryName(p.categoryId))} · ${p.stock} in stock</span>
      <span class="muted">${rmb(p.priceRmb)} = ${eur(p.priceRmb * state.settings.rate)} + ${eur(p.shippingEur)} shipping → cost <b>${eur(productCost(p))}</b></span>
    </div>
    <div class="item-actions">
      <button class="small" data-action="edit-product" data-id="${p.id}">Edit</button>
      <button class="small danger" data-action="delete-product" data-id="${p.id}">Delete</button>
    </div>
  </li>`;
}

function updateCostPreview() {
  const form = $('#product-form');
  if (!form) return;
  const priceRmb = num(form.priceRmb.value);
  const shipping = num(form.shippingEur.value);
  const converted = priceRmb * state.settings.rate;
  $('#cost-preview').textContent =
    `${rmb(priceRmb)} ≈ ${eur(converted)} + ${eur(shipping)} shipping = ${eur(converted + shipping)} cost per item (rate 1 RMB = €${state.settings.rate})`;
}

function daySummary(day) {
  const cash = sum(day.sales.filter(s => s.method === 'cash'), s => s.price * s.qty);
  const paypal = sum(day.sales.filter(s => s.method === 'paypal'), s => s.price * s.qty);
  const cost = sum(day.sales, s => s.costEur * s.qty);
  const startCash = day.notes + day.coins;
  return {
    cash, paypal, cost,
    total: cash + paypal,
    profit: cash + paypal - cost,
    items: sum(day.sales, s => s.qty),
    startCash,
    expectedCash: startCash + cash,
    expectedPaypal: day.paypalStart + paypal,
  };
}

function renderDay() {
  const days = [...state.days].sort((a, b) => b.date.localeCompare(a.date));
  const day = state.days.find(d => d.id === ui.currentDayId) || days[0];
  ui.currentDayId = day?.id ?? null;

  $('#day').innerHTML = `
    <details class="card" ${days.length ? '' : 'open'}>
      <summary>Start a new selling day</summary>
      <form id="day-form">
        <div class="row">
          <label>Date <input type="date" name="date" required value="${today()}"></label>
          <label>Small change / notes (€) <input name="notes" inputmode="decimal" value="0"></label>
          <label>Coins (€) <input name="coins" inputmode="decimal" value="0"></label>
          <label>PayPal balance at start (€) <input name="paypalStart" inputmode="decimal" value="0"></label>
        </div>
        <div class="actions"><button type="submit" class="primary">Start day</button></div>
      </form>
    </details>
    ${days.length ? `
      <div class="card">
        <label>Selling day
          <select id="day-select">${days.map(d =>
            `<option value="${d.id}" ${d.id === day.id ? 'selected' : ''}>${d.date} (${d.sales.length} sales)</option>`).join('')}
          </select>
        </label>
        <p class="muted">Start: ${eur(day.notes)} notes + ${eur(day.coins)} coins, PayPal ${eur(day.paypalStart)}</p>
        <button class="small danger" data-action="delete-day" data-id="${day.id}">Delete this day</button>
      </div>
      ${renderSaleForm()}
      ${renderSalesList(day)}
      ${renderReconcile(day)}` : ''}`;
}

function renderSaleForm() {
  const catId = ui.saleCategoryId || state.categories[0]?.id || '';
  const products = state.products.filter(p => p.categoryId === catId && p.stock > 0);
  return `
    <form id="sale-form" class="card">
      <h2>Record a sale</h2>
      <label>Category <select id="sale-category">${categoryOptions(catId)}</select></label>
      <label>Product
        <select name="productId" required>
          ${products.length
            ? products.map(p => `<option value="${p.id}">${esc(p.name)} (${p.stock} left, cost ${eur(productCost(p))})</option>`).join('')
            : '<option value="">No products in stock in this category</option>'}
        </select>
      </label>
      <div class="row">
        <label>Selling price per item (€) <input name="price" inputmode="decimal" required></label>
        <label>Quantity <input name="qty" type="number" min="1" step="1" value="1" required></label>
      </div>
      <div class="methods">
        <label><input type="radio" name="method" value="cash" checked> Cash</label>
        <label><input type="radio" name="method" value="paypal"> PayPal</label>
      </div>
      <button type="submit" class="primary" ${products.length ? '' : 'disabled'}>Add sale</button>
    </form>`;
}

function renderSalesList(day) {
  const sales = [...day.sales].reverse();
  return `
    <div class="card">
      <h2>Sales (${sales.length})</h2>
      ${sales.length ? `<ul class="items">${sales.map(s => `
        <li>
          <div class="info">
            <strong>${esc(s.productName)}${s.qty > 1 ? ` × ${s.qty}` : ''}</strong>
            <span class="muted">${esc(categoryName(s.categoryId))} · ${s.method === 'cash' ? 'Cash' : 'PayPal'} · ${s.time}</span>
          </div>
          <b>${eur(s.price * s.qty)}</b>
          <button class="small danger" data-action="delete-sale" data-id="${s.id}">✕</button>
        </li>`).join('')}</ul>` : '<p class="empty">No sales yet.</p>'}
    </div>`;
}

function renderReconcile(day) {
  const s = daySummary(day);
  const diff = (actual, expected) => {
    if (actual == null) return '';
    const d = actual - expected;
    if (Math.abs(d) < 0.005) return '<span class="good">✓ matches</span>';
    return `<span class="bad">${d > 0 ? '+' : ''}${eur(d)} ${d > 0 ? 'over' : 'short'}</span>`;
  };
  return `
    <div class="card">
      <h2>End of day</h2>
      <div class="stats">
        <div class="stat"><span>Total sales</span><b>${eur(s.total)}</b></div>
        <div class="stat"><span>Items sold</span><b>${s.items}</b></div>
        <div class="stat"><span>Cash sales</span><b>${eur(s.cash)}</b></div>
        <div class="stat"><span>PayPal sales</span><b>${eur(s.paypal)}</b></div>
        <div class="stat"><span>Profit</span><b>${eur(s.profit)}</b></div>
      </div>
      <h3>Check your money</h3>
      <div class="row">
        <label>Expected cash: ${eur(s.startCash)} + ${eur(s.cash)} = <b>${eur(s.expectedCash)}</b>
          <input id="actual-cash" inputmode="decimal" placeholder="Counted cash" value="${day.actualCash ?? ''}">
          <span id="cash-diff">${diff(day.actualCash, s.expectedCash)}</span>
        </label>
        <label>Expected PayPal: ${eur(day.paypalStart)} + ${eur(s.paypal)} = <b>${eur(s.expectedPaypal)}</b>
          <input id="actual-paypal" inputmode="decimal" placeholder="PayPal balance now" value="${day.actualPaypal ?? ''}">
          <span id="paypal-diff">${diff(day.actualPaypal, s.expectedPaypal)}</span>
        </label>
      </div>
    </div>`;
}

function analyse() {
  const sales = state.days.flatMap(d => d.sales.map(s => ({ ...s, date: d.date })));
  const byProduct = new Map();
  const byCategory = new Map();
  const add = (map, key, init, s) => {
    const row = map.get(key) || { ...init, units: 0, revenue: 0, cost: 0 };
    row.units += s.qty;
    row.revenue += s.price * s.qty;
    row.cost += s.costEur * s.qty;
    map.set(key, row);
  };
  for (const s of sales) {
    add(byProduct, s.productId, { id: s.productId, name: s.productName, categoryId: s.categoryId }, s);
    add(byCategory, s.categoryId, { id: s.categoryId }, s);
  }
  const finish = r => ({ ...r, profit: r.revenue - r.cost, margin: (r.revenue - r.cost) / r.revenue });
  const products = [...byProduct.values()].map(finish).sort((a, b) => b.profit - a.profit);
  const categories = state.categories.map(c => {
    const row = byCategory.get(c.id) || { id: c.id, units: 0, revenue: 0, cost: 0 };
    const stockItems = state.products.filter(p => p.categoryId === c.id);
    const stock = sum(stockItems, p => p.stock);
    return {
      ...finish(row),
      name: c.name,
      stock,
      stockValue: sum(stockItems, p => p.stock * productCost(p)),
      sellThrough: row.units / (row.units + stock),
    };
  });
  const revenue = sum(sales, s => s.price * s.qty);
  const cost = sum(sales, s => s.costEur * s.qty);
  return { sales, products, categories, revenue, cost, profit: revenue - cost };
}

function buyingTips(a) {
  const tips = [];
  const soldIds = new Set(a.products.map(p => p.id));

  const restock = a.products
    .filter(p => p.units >= 2 && (productById(p.id)?.stock ?? 0) <= 2)
    .slice(0, 5);
  if (restock.length) {
    tips.push(`<b>Restock best sellers running low:</b> ${restock.map(p =>
      `${esc(p.name)} (sold ${p.units}, ${productById(p.id)?.stock ?? 0} left)`).join(', ')}.`);
  }

  const sold = a.categories.filter(c => c.units > 0);
  if (sold.length) {
    const bestProfit = [...sold].sort((x, y) => y.profit - x.profit)[0];
    const bestMargin = [...sold].sort((x, y) => y.margin - x.margin)[0];
    tips.push(`<b>${esc(bestProfit.name)}</b> brings in the most profit (${eur(bestProfit.profit)}) - buy more of it.`);
    if (bestMargin.id !== bestProfit.id) {
      tips.push(`<b>${esc(bestMargin.name)}</b> has the best profit rate (${pct(bestMargin.margin)}) - worth expanding.`);
    }
    const fast = sold.filter(c => c.sellThrough >= 0.6);
    if (fast.length) {
      tips.push(`Sells fast (60%+ of stock sold): ${fast.map(c => `${esc(c.name)} (${pct(c.sellThrough)})`).join(', ')}.`);
    }
    const low = sold.filter(c => c.margin < 0.3);
    if (low.length) {
      tips.push(`Low profit rate (under 30%): ${low.map(c => esc(c.name)).join(', ')} - raise prices or find cheaper suppliers.`);
    }
  }

  const slow = state.products.filter(p => p.stock > 0 && !soldIds.has(p.id));
  if (slow.length && a.sales.length) {
    tips.push(`<b>Not sold yet:</b> ${slow.slice(0, 8).map(p => esc(p.name)).join(', ')}${slow.length > 8 ? ` and ${slow.length - 8} more` : ''} - don't buy more of these until they move.`);
  }
  const idleCats = a.categories.filter(c => c.units === 0 && c.stock > 0);
  if (idleCats.length && a.sales.length) {
    tips.push(`No sales yet in: ${idleCats.map(c => esc(c.name)).join(', ')} (${eur(sum(idleCats, c => c.stockValue))} of stock waiting).`);
  }
  return tips;
}

function renderAnalysis() {
  const a = analyse();
  if (!a.sales.length) {
    $('#analysis').innerHTML = '<div class="card"><p class="empty">No sales recorded yet. Analysis appears once you record sales on a selling day.</p></div>';
    return;
  }
  const tips = buyingTips(a);
  const days = [...state.days].sort((x, y) => y.date.localeCompare(x.date));
  const stockValue = sum(state.products, p => p.stock * productCost(p));

  $('#analysis').innerHTML = `
    <div class="card">
      <h2>Overview</h2>
      <div class="stats">
        <div class="stat"><span>Revenue</span><b>${eur(a.revenue)}</b></div>
        <div class="stat"><span>Cost of goods sold</span><b>${eur(a.cost)}</b></div>
        <div class="stat"><span>Profit</span><b>${eur(a.profit)}</b></div>
        <div class="stat"><span>Profit rate</span><b>${pct(a.profit / a.revenue)}</b></div>
        <div class="stat"><span>Items sold</span><b>${sum(a.sales, s => s.qty)}</b></div>
        <div class="stat"><span>Stock left (at cost)</span><b>${eur(stockValue)}</b></div>
      </div>
      <p class="hint">Profit rate = profit ÷ revenue. Cost = RMB price converted to € plus estimated shipping, as it was when each item was sold.</p>
    </div>
    <div class="card">
      <h2>What to buy next</h2>
      ${tips.length ? `<ul class="tips">${tips.map(t => `<li>${t}</li>`).join('')}</ul>` : '<p class="empty">Not enough data yet.</p>'}
    </div>
    <div class="card">
      <h2>Top products</h2>
      <div class="table-wrap"><table>
        <tr><th>Product</th><th>Category</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Rate</th></tr>
        ${a.products.slice(0, 10).map(p => `<tr>
          <td>${esc(p.name)}</td><td>${esc(categoryName(p.categoryId))}</td>
          <td class="num">${p.units}</td><td class="num">${eur(p.revenue)}</td>
          <td class="num">${eur(p.profit)}</td><td class="num">${pct(p.margin)}</td></tr>`).join('')}
      </table></div>
    </div>
    <div class="card">
      <h2>By category</h2>
      <div class="table-wrap"><table>
        <tr><th>Category</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Rate</th><th class="num">In stock</th><th class="num">Sold through</th></tr>
        ${a.categories.map(c => `<tr>
          <td>${esc(c.name)}</td><td class="num">${c.units}</td><td class="num">${eur(c.revenue)}</td>
          <td class="num">${eur(c.profit)}</td><td class="num">${pct(c.margin)}</td>
          <td class="num">${c.stock}</td><td class="num">${pct(c.sellThrough)}</td></tr>`).join('')}
      </table></div>
    </div>
    <div class="card">
      <h2>By selling day</h2>
      <div class="table-wrap"><table>
        <tr><th>Date</th><th class="num">Items</th><th class="num">Cash</th><th class="num">PayPal</th><th class="num">Total</th><th class="num">Profit</th></tr>
        ${days.map(d => { const s = daySummary(d); return `<tr>
          <td>${d.date}</td><td class="num">${s.items}</td><td class="num">${eur(s.cash)}</td>
          <td class="num">${eur(s.paypal)}</td><td class="num">${eur(s.total)}</td><td class="num">${eur(s.profit)}</td></tr>`; }).join('')}
      </table></div>
    </div>`;
}

function renderSettings() {
  $('#settings').innerHTML = `
    <form id="rate-form" class="card">
      <h2>Exchange rate</h2>
      <label>1 RMB = € <input name="rate" inputmode="decimal" required value="${state.settings.rate}"></label>
      <p class="hint">Used to convert product prices to euros. Past sales keep the cost they had when sold.</p>
      <button type="submit" class="primary">Save rate</button>
    </form>
    <div class="card">
      <h2>Categories</h2>
      <ul class="items">${state.categories.map(c => `
        <li>
          <div class="info"><input data-category-name="${c.id}" value="${esc(c.name)}"></div>
          <span class="muted">${state.products.filter(p => p.categoryId === c.id).length} products</span>
          <button class="small danger" data-action="delete-category" data-id="${c.id}">Delete</button>
        </li>`).join('')}
      </ul>
      <form id="category-form" class="actions">
        <input name="name" placeholder="New category, e.g. Earrings" required style="flex:1">
        <button type="submit" class="primary">Add</button>
      </form>
    </div>
    <div class="card">
      <h2>Backup</h2>
      <p class="hint">Your data is stored only in this browser. Export a backup regularly, and import it to move to another device.</p>
      <div class="actions">
        <button data-action="export">Export backup</button>
        <label class="small" style="margin:0"><button type="button" data-action="import">Import backup</button>
          <input type="file" id="import-input" accept="application/json,.json" hidden></label>
        <button class="danger" data-action="reset">Delete all data</button>
      </div>
    </div>`;
}

// ---------- Actions ----------

function resizeImage(file, max = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function saveProduct(form) {
  const data = {
    name: form.name.value.trim(),
    categoryId: form.categoryId.value,
    priceRmb: num(form.priceRmb.value),
    shippingEur: num(form.shippingEur.value),
    stock: Math.max(0, Math.round(num(form.stock.value))),
  };
  if (!data.name || !data.categoryId) return;
  const existing = productById(ui.editingProductId);
  if (existing) {
    Object.assign(existing, data);
    if (ui.pendingPhoto) existing.photo = ui.pendingPhoto;
  } else {
    state.products.push({ id: uid(), ...data, photo: ui.pendingPhoto || '' });
  }
  ui.editingProductId = null;
  ui.pendingPhoto = null;
  save();
  render();
}

function addSale(form) {
  const day = state.days.find(d => d.id === ui.currentDayId);
  const product = productById(form.productId.value);
  const qty = Math.max(1, Math.round(num(form.qty.value)));
  if (!day || !product) return;
  if (qty > product.stock) {
    alert(`Only ${product.stock} of ${product.name} left in stock.`);
    return;
  }
  day.sales.push({
    id: uid(),
    productId: product.id,
    productName: product.name,
    categoryId: product.categoryId,
    qty,
    price: num(form.price.value),
    method: form.method.value,
    costEur: productCost(product),
    time: new Date().toTimeString().slice(0, 5),
  });
  product.stock -= qty;
  save();
  render();
}

// Put sold items back into stock (when a sale or a whole day is deleted).
function restock(sales) {
  for (const s of sales) {
    const p = productById(s.productId);
    if (p) p.stock += s.qty;
  }
}

const actions = {
  'edit-product': id => { ui.editingProductId = id; ui.pendingPhoto = null; render(); scrollTo(0, 0); },
  'cancel-edit': () => { ui.editingProductId = null; ui.pendingPhoto = null; render(); },
  'delete-product': id => {
    const p = productById(id);
    if (!confirm(`Delete "${p.name}"? Past sales of it stay in the analysis.`)) return;
    state.products = state.products.filter(x => x.id !== id);
    save(); render();
  },
  'delete-sale': id => {
    const day = state.days.find(d => d.id === ui.currentDayId);
    const sale = day.sales.find(s => s.id === id);
    if (!confirm(`Delete sale of ${sale.productName}? It goes back into stock.`)) return;
    restock([sale]);
    day.sales = day.sales.filter(s => s.id !== id);
    save(); render();
  },
  'delete-day': id => {
    const day = state.days.find(d => d.id === id);
    if (!confirm(`Delete selling day ${day.date} and its ${day.sales.length} sales? Sold items go back into stock.`)) return;
    restock(day.sales);
    state.days = state.days.filter(d => d.id !== id);
    ui.currentDayId = null;
    save(); render();
  },
  'delete-category': id => {
    if (state.products.some(p => p.categoryId === id)) {
      alert('Move or delete the products in this category first.');
      return;
    }
    state.categories = state.categories.filter(c => c.id !== id);
    if (ui.saleCategoryId === id) ui.saleCategoryId = '';
    if (ui.productFilter === id) ui.productFilter = '';
    save(); render();
  },
  'export': () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `market-stall-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  'import': () => $('#import-input').click(),
  'reset': () => {
    if (!confirm('Delete ALL products, categories and selling days? Export a backup first if unsure.')) return;
    state = defaultState();
    save(); render();
  },
};

// ---------- Events ----------

document.addEventListener('click', e => {
  const tab = e.target.closest('#tabs button');
  if (tab) { ui.tab = tab.dataset.tab; render(); return; }
  const btn = e.target.closest('[data-action]');
  if (btn) actions[btn.dataset.action](btn.dataset.id);
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  switch (form.id) {
    case 'product-form': saveProduct(form); break;
    case 'sale-form': addSale(form); break;
    case 'day-form': {
      const day = {
        id: uid(),
        date: form.date.value,
        notes: num(form.notes.value),
        coins: num(form.coins.value),
        paypalStart: num(form.paypalStart.value),
        actualCash: null,
        actualPaypal: null,
        sales: [],
      };
      state.days.push(day);
      ui.currentDayId = day.id;
      save(); render();
      break;
    }
    case 'rate-form': {
      const rate = num(form.rate.value);
      if (rate <= 0) { alert('Enter a rate above 0.'); return; }
      state.settings.rate = rate;
      save(); render();
      break;
    }
    case 'category-form':
      state.categories.push({ id: uid(), name: form.name.value.trim() });
      save(); render();
      break;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.closest('#product-form')) updateCostPreview();
  if (t.dataset.categoryName) {
    const c = state.categories.find(x => x.id === t.dataset.categoryName);
    c.name = t.value.trim() || c.name;
    save();
  }
  if (t.id === 'actual-cash' || t.id === 'actual-paypal') {
    const day = state.days.find(d => d.id === ui.currentDayId);
    const key = t.id === 'actual-cash' ? 'actualCash' : 'actualPaypal';
    day[key] = t.value.trim() === '' ? null : num(t.value);
    save();
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'product-filter') { ui.productFilter = t.value; render(); }
  if (t.id === 'day-select') { ui.currentDayId = t.value; render(); }
  if (t.id === 'sale-category') { ui.saleCategoryId = t.value; render(); }
  // Re-render the money check once the user leaves the field, so typing isn't interrupted.
  if (t.id === 'actual-cash' || t.id === 'actual-paypal') render();
  if (t.id === 'photo-input' && t.files[0]) {
    try {
      ui.pendingPhoto = await resizeImage(t.files[0]);
      const preview = $('#photo-preview');
      preview.src = ui.pendingPhoto;
      preview.hidden = false;
    } catch {
      alert('Could not read that image.');
    }
  }
  if (t.id === 'import-input' && t.files[0]) {
    try {
      const data = JSON.parse(await t.files[0].text());
      if (!Array.isArray(data.products) || !Array.isArray(data.days)) throw new Error();
      if (!confirm('Replace all current data with this backup?')) return;
      state = data;
      save(); render();
    } catch {
      alert('That file is not a valid backup.');
    }
  }
});

render();
