import { api } from '../api.js';
import { html, icon, fmt, statusBadge, emptyState } from '../ui.js';
import { monthlyChart, horizontalBarChart, onThemeChange } from '../charts.js';
import { movementRow } from './inventory.js';

export default async function dashboard(view) {
  const d = await api.get('/api/dashboard');
  const t = d.totals;
  const monthSales = d.monthly.sales.at(-1);
  const monthPurchases = d.monthly.purchases.at(-1);

  view.innerHTML = html`
    <section class="stats">
      <a class="stat" href="#/products">
        <span class="stat-label">${icon('box', 16)} Total products</span>
        <span class="stat-value">${fmt.int(t.total_products)}</span>
        <span class="stat-sub">${fmt.int(t.total_units)} units on hand</span>
      </a>
      <a class="stat" href="#/reports?r=valuation">
        <span class="stat-label">${icon('dollar', 16)} Inventory value</span>
        <span class="stat-value">${fmt.money(t.inventory_value)}</span>
        <span class="stat-sub">${fmt.money(t.retail_value)} at retail price</span>
      </a>
      <a class="stat ${t.low_stock_count ? 'stat-warn' : ''}" href="#/products?low=1">
        <span class="stat-label">${icon('alert', 16)} Low-stock products</span>
        <span class="stat-value">${fmt.int(t.low_stock_count)}</span>
        <span class="stat-sub">${t.out_of_stock_count ? `${t.out_of_stock_count} out of stock` : 'None out of stock'}</span>
      </a>
      <a class="stat" href="#/purchase-orders?status=ordered">
        <span class="stat-label">${icon('clipboard', 16)} Pending purchase orders</span>
        <span class="stat-value">${fmt.int(t.pending_orders)}</span>
        <span class="stat-sub">${fmt.money(t.pending_value)} on order · ${t.draft_orders} draft</span>
      </a>
    </section>

    <section class="grid-2-1">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>Monthly purchases &amp; sales</h2>
            <p class="muted small">Last 12 months · this month so far: ${fmt.money(monthPurchases)} purchased, ${fmt.money(monthSales)} sold</p>
          </div>
        </div>
        <div class="chart-box"><canvas id="monthly-chart" role="img" aria-label="Bar chart of monthly purchases and sales over the last 12 months"></canvas></div>
        <details class="table-view">
          <summary>Show as table</summary>
          <div class="table-wrap"><table class="table compact">
            <thead><tr><th>Month</th><th class="num">Purchases</th><th class="num">Sales</th></tr></thead>
            <tbody>${d.monthly.labels.map((m, i) => html`<tr><td>${fmt.month(m)}</td><td class="num">${fmt.money(d.monthly.purchases[i])}</td><td class="num">${fmt.money(d.monthly.sales[i])}</td></tr>`)}</tbody>
          </table></div>
        </details>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Stock value by category</h2><p class="muted small">At cost price</p></div></div>
        <div class="chart-box">${d.byCategory.length ? html`<canvas id="category-chart" role="img" aria-label="Bar chart of stock value by category"></canvas>` : emptyState('No stock yet')}</div>
      </div>
    </section>

    <section class="grid-2">
      <div class="card">
        <div class="card-head">
          <h2>Low-stock products</h2>
          <a class="link" href="#/reports?r=low-stock">Full report ${icon('arrow', 14)}</a>
        </div>
        ${d.lowStock.length ? html`
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Product</th><th>Supplier</th><th class="num">Stock</th><th class="num">Min</th><th>Status</th></tr></thead>
            <tbody>${d.lowStock.map((p) => html`
              <tr class="clickable" data-href="#/products/${p.id}">
                <td><a href="#/products/${p.id}">${p.name}</a><div class="muted small">${p.sku}</div></td>
                <td>${p.supplier_name || '—'}</td>
                <td class="num">${fmt.int(p.stock)}</td>
                <td class="num">${fmt.int(p.min_stock)}</td>
                <td>${p.stock === 0 ? html`<span class="badge badge-critical">${icon('alert', 12)} Out</span>` : html`<span class="badge badge-warning">${icon('alert', 12)} Low</span>`}</td>
              </tr>`)}
            </tbody>
          </table></div>` : emptyState('All stocked up', 'Every product is above its minimum threshold.')}
      </div>
      <div class="card">
        <div class="card-head">
          <h2>Open purchase orders</h2>
          <a class="link" href="#/purchase-orders">All orders ${icon('arrow', 14)}</a>
        </div>
        ${d.pendingOrders.length ? html`
          <div class="table-wrap"><table class="table">
            <thead><tr><th>PO #</th><th>Supplier</th><th>Status</th><th>Expected</th><th class="num">Total</th></tr></thead>
            <tbody>${d.pendingOrders.map((po) => html`
              <tr class="clickable" data-href="#/purchase-orders/${po.id}">
                <td class="nowrap"><a href="#/purchase-orders/${po.id}">${po.po_number}</a></td>
                <td>${po.supplier_name}</td>
                <td>${statusBadge(po.status)}</td>
                <td>${fmt.date(po.expected_date)}</td>
                <td class="num">${fmt.money(po.total)}</td>
              </tr>`)}
            </tbody>
          </table></div>` : emptyState('No open orders')}
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Recent stock movements</h2>
        <a class="link" href="#/inventory">Inventory history ${icon('arrow', 14)}</a>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Product</th><th>Type</th><th class="num">Change</th><th class="num">Balance</th><th>Reference</th><th>Reason</th></tr></thead>
        <tbody>${d.recentMovements.map(movementRow)}</tbody>
      </table></div>
    </section>`;

  view.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  }));

  let charts = [];
  const draw = () => {
    charts.forEach((c) => c.destroy());
    charts = [monthlyChart(view.querySelector('#monthly-chart'), d.monthly)];
    const cat = view.querySelector('#category-chart');
    if (cat) charts.push(horizontalBarChart(cat, d.byCategory.map((c) => c.name), d.byCategory.map((c) => c.value), 'Stock value'));
  };
  draw();
  const off = onThemeChange(draw);
  return () => { off(); charts.forEach((c) => c.destroy()); };
}
