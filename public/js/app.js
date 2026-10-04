import { api } from './api.js';
import { html, icon, toast } from './ui.js';
import dashboard from './pages/dashboard.js';
import products from './pages/products.js';
import productDetail from './pages/productDetail.js';
import inventory from './pages/inventory.js';
import suppliers from './pages/suppliers.js';
import supplierDetail from './pages/supplierDetail.js';
import purchaseOrders from './pages/purchaseOrders.js';
import purchaseOrderDetail from './pages/purchaseOrderDetail.js';
import reports from './pages/reports.js';

const NAV = [
  { path: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: 'products', label: 'Products', icon: 'box' },
  { path: 'inventory', label: 'Inventory', icon: 'layers' },
  { path: 'suppliers', label: 'Suppliers', icon: 'truck' },
  { path: 'purchase-orders', label: 'Purchase Orders', icon: 'clipboard' },
  { path: 'reports', label: 'Reports', icon: 'chart' },
];

// Route table: "section" or "section/:id". Each page is (view, ctx) => cleanup?
const ROUTES = {
  dashboard: { page: dashboard, title: 'Dashboard' },
  products: { page: products, detail: productDetail, title: 'Products' },
  inventory: { page: inventory, title: 'Inventory' },
  suppliers: { page: suppliers, detail: supplierDetail, title: 'Suppliers' },
  'purchase-orders': { page: purchaseOrders, detail: purchaseOrderDetail, title: 'Purchase Orders' },
  reports: { page: reports, title: 'Reports' },
};

const view = document.getElementById('view');
let cleanup = null;

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [section, id] = path.split('/');
  return { section: section || 'dashboard', id, params: Object.fromEntries(new URLSearchParams(query)) };
}

async function render() {
  const { section, id, params } = parseHash();
  const route = ROUTES[section] || ROUTES.dashboard;
  const page = id && route.detail ? route.detail : route.page;

  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === section));
  document.getElementById('page-title').textContent = route.title;
  document.getElementById('sidebar').classList.remove('open');
  document.title = `${route.title} · StockKeeper`;

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  view.innerHTML = '<div class="loading" aria-live="polite">Loading…</div>';
  try {
    cleanup = await page(view, { id, params, setTitle: (t) => { document.getElementById('page-title').textContent = t; document.title = `${t} · StockKeeper`; } });
  } catch (err) {
    console.error(err);
    view.innerHTML = html`<div class="empty">${icon('alert', 32)}<h3>Couldn't load this page</h3><p>${err.message}</p></div>`;
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// --- Low-stock alert bell ------------------------------------------------------
const alertsBtn = document.getElementById('alerts-btn');
const alertsPanel = document.getElementById('alerts-panel');

export async function refreshAlerts() {
  try {
    const items = await api.get('/api/inventory/alerts');
    alertsBtn.innerHTML = html`${icon('bell')}${items.length ? html`<span class="count">${items.length}</span>` : ''}`;
    alertsBtn.setAttribute('aria-label', `Low-stock alerts (${items.length})`);
    alertsPanel.innerHTML = html`
      <div class="alerts-head"><strong>Low-stock alerts</strong><span class="muted">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
      ${items.length ? html`<ul>${items.map((p) => html`
        <li><a href="#/products/${p.id}">
          <span><span class="alert-name">${p.name}</span><span class="muted small">${p.sku} · min ${p.min_stock}</span></span>
          <span class="badge ${p.stock === 0 ? 'badge-critical' : 'badge-warning'}">${icon('alert', 12)} ${p.stock} ${p.unit}</span>
        </a></li>`)}</ul>` : html`<p class="muted pad">All products are above their minimum stock level.</p>`}
      <a class="alerts-foot" href="#/reports?r=low-stock">View low-stock report ${icon('arrow', 14)}</a>`;
  } catch { /* the bell is non-critical */ }
}

alertsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = alertsPanel.hidden;
  alertsPanel.hidden = !open;
  alertsBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!alertsPanel.hidden && !alertsPanel.contains(e.target)) { alertsPanel.hidden = true; alertsBtn.setAttribute('aria-expanded', 'false'); }
});
alertsPanel.addEventListener('click', (e) => { if (e.target.closest('a')) alertsPanel.hidden = true; });

// --- Theme -------------------------------------------------------------------------
const themeBtn = document.getElementById('theme-btn');
export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
function paintThemeBtn() { themeBtn.innerHTML = html`${icon(isDark() ? 'sun' : 'moon')}`; }
themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ims-theme', next); } catch { /* ignore */ }
  paintThemeBtn();
  window.dispatchEvent(new Event('themechange'));
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paintThemeBtn(); window.dispatchEvent(new Event('themechange')); });

// --- Boot --------------------------------------------------------------------------
document.getElementById('nav').innerHTML = html`${NAV.map((n) => html`<a href="#/${n.path}" data-path="${n.path}">${icon(n.icon)}<span>${n.label}</span></a>`)}`;
const menuBtn = document.getElementById('menu-btn');
menuBtn.innerHTML = html`${icon('menu')}`;
menuBtn.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
paintThemeBtn();

window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || String(e.reason), 'error'));
// Any successful data change refreshes the alert bell.
window.addEventListener('stockchange', refreshAlerts);

render();
refreshAlerts();

