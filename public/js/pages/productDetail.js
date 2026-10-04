import { api } from '../api.js';
import { html, icon, fmt, toast, confirmDialog, stockBadge, productThumb, emptyState } from '../ui.js';
import { openProductModal } from './products.js';
import { openStockModal, movementRow } from './inventory.js';

export default async function productDetail(view, { id, setTitle }) {
  async function render() {
    const p = await api.get(`/api/products/${id}`);
    setTitle(p.name);
    const margin = p.unit_price - p.cost_price;

    view.innerHTML = html`
      <a class="back" href="#/products">← All products</a>
      <section class="card product-hero">
        <div class="product-hero-img">${productThumb(p, 'xl')}</div>
        <div class="product-hero-body">
          <div class="product-hero-title">
            <div>
              <h2>${p.name}</h2>
              <p class="muted">${p.sku}${p.barcode ? html` · ${icon('barcode', 14)} ${p.barcode}` : ''} · ${p.category_name || 'Uncategorised'}</p>
            </div>
            <div class="btn-row">
              <button class="btn btn-ghost" id="edit">${icon('edit', 16)} Edit</button>
              <button class="btn btn-ghost danger" id="delete">${icon('trash', 16)} Delete</button>
            </div>
          </div>
          ${p.description ? html`<p>${p.description}</p>` : ''}
          <dl class="facts">
            <div><dt>Current stock</dt><dd class="big">${fmt.int(p.stock)} <span class="muted small">${p.unit}</span></dd></div>
            <div><dt>Minimum threshold</dt><dd>${fmt.int(p.min_stock)}</dd></div>
            <div><dt>Status</dt><dd>${stockBadge(p.stock, p.min_stock)}</dd></div>
            <div><dt>Cost price</dt><dd>${fmt.money(p.cost_price)}</dd></div>
            <div><dt>Unit price</dt><dd>${fmt.money(p.unit_price)}</dd></div>
            <div><dt>Margin</dt><dd>${fmt.money(margin)} <span class="muted small">${p.unit_price ? `(${((margin / p.unit_price) * 100).toFixed(1)}%)` : ''}</span></dd></div>
            <div><dt>Stock value (cost)</dt><dd>${fmt.money(p.stock_value)}</dd></div>
            <div><dt>Primary supplier</dt><dd>${p.supplier_id ? html`<a href="#/suppliers/${p.supplier_id}">${p.supplier_name}</a>` : '—'}</dd></div>
          </dl>
          <div class="btn-row">
            <button class="btn btn-primary" data-stock="in">${icon('in', 16)} Stock in</button>
            <button class="btn btn-ghost" data-stock="out">${icon('out', 16)} Stock out</button>
            <button class="btn btn-ghost" data-stock="adjustment">${icon('adjust', 16)} Adjust</button>
            ${p.supplier_id ? html`<a class="btn btn-ghost" href="#/purchase-orders?new=1&supplier_id=${p.supplier_id}&product_id=${p.id}">${icon('clipboard', 16)} Reorder</a>` : ''}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <h2>Stock history</h2>
          <a class="link" href="#/inventory?product_id=${p.id}">Full history ${icon('arrow', 14)}</a>
        </div>
        ${p.movements.length ? html`
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th>Product</th><th>Type</th><th class="num">Change</th><th class="num">Balance</th><th>Reference</th><th>Reason</th></tr></thead>
            <tbody>${p.movements.map((m) => movementRow({ ...m, product_name: p.name, sku: p.sku }))}</tbody>
          </table></div>` : emptyState('No stock movements yet')}
      </section>`;

    view.querySelector('#edit').addEventListener('click', () => openProductModal(p, { onSaved: render }));
    view.querySelector('#delete').addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Delete product', message: `Delete "${p.name}"? Its stock history will also be removed. This cannot be undone.` }))) return;
      try {
        await api.del(`/api/products/${p.id}`);
        toast('Product deleted');
        window.dispatchEvent(new Event('stockchange'));
        location.hash = '#/products';
      } catch (err) { toast(err.message, 'error'); }
    });
    view.querySelectorAll('[data-stock]').forEach((b) => b.addEventListener('click', () => openStockModal(b.dataset.stock, { productId: p.id, onDone: render })));
  }
  await render();
}
