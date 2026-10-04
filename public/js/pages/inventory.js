import { api } from '../api.js';
import { html, raw, icon, fmt, statusBadge, modal, toast, options, emptyState, debounce } from '../ui.js';

export const movementRow = (m) => html`
  <tr>
    <td class="nowrap">${fmt.datetime(m.created_at)}</td>
    <td><a href="#/products/${m.product_id}">${m.product_name}</a><div class="muted small">${m.sku}</div></td>
    <td>${statusBadge(m.type)}</td>
    <td class="num ${m.quantity > 0 ? 'pos' : 'neg'}">${fmt.signed(m.quantity)}</td>
    <td class="num">${fmt.int(m.balance_after)}</td>
    <td>${m.po_id ? html`<a href="#/purchase-orders/${m.po_id}">${m.reference}</a>` : m.reference || '—'}</td>
    <td class="muted">${m.reason || '—'}</td>
  </tr>`;

const TYPE_INFO = {
  in: { title: 'Stock in', verb: 'Receive', icon: 'in', help: 'Add units to stock — e.g. a delivery without a purchase order, or returned goods.', valueLabel: 'Unit cost', reasons: ['Delivery received', 'Customer return', 'Transfer in', 'Production'] },
  out: { title: 'Stock out', verb: 'Remove', icon: 'out', help: 'Remove units from stock — e.g. a sale or internal use. Stock cannot go below zero.', valueLabel: 'Unit price', reasons: ['Sale', 'Internal use', 'Transfer out', 'Sample'] },
  adjustment: { title: 'Stock adjustment', verb: 'Adjust', icon: 'adjust', help: 'Correct stock after a physical count or write off damaged goods. Enter the counted quantity and the difference is recorded.', reasons: ['Cycle count correction', 'Damaged in warehouse', 'Expired / unsellable', 'Lost / stolen', 'Found stock'] },
};

/**
 * Stock in / out / adjustment dialog. Supports several product lines and a
 * scanner field: scanning (or typing) a SKU or barcode adds that product.
 */
export async function openStockModal(type, { productId, onDone } = {}) {
  const info = TYPE_INFO[type];
  const products = await api.get('/api/products');
  const byId = new Map(products.map((p) => [p.id, p]));
  const productLabel = (p) => `${p.name} (${p.sku}) — ${p.stock} ${p.unit}`;

  const lineHtml = (pid = '') => html`
    <div class="line">
      <select name="product_id" class="line-product" required aria-label="Product">${options(products, pid, { empty: 'Choose a product…', label: productLabel })}</select>
      ${type === 'adjustment'
        ? html`<input name="counted" type="number" min="0" step="1" placeholder="Counted qty" aria-label="Counted quantity" required>
               <span class="line-delta muted small" aria-live="polite"></span>`
        : html`<input name="quantity" type="number" min="1" step="1" placeholder="Qty" aria-label="Quantity" required>
               <input name="unit_value" type="number" min="0" step="0.01" placeholder="${info.valueLabel}" aria-label="${info.valueLabel}">`}
      <button type="button" class="icon-btn remove-line" aria-label="Remove line">${icon('trash', 16)}</button>
    </div>`;

  modal({
    title: info.title,
    wide: true,
    submitLabel: `${info.verb} stock`,
    body: html`
      <p class="muted">${info.help}</p>
      <div class="scan-row">
        <label class="field grow">
          <span>${icon('barcode', 14)} Scan or enter SKU / barcode</span>
          <input type="text" class="scan-input" placeholder="Scan a barcode and press Enter" autocomplete="off" ${productId ? '' : raw('autofocus')}>
        </label>
      </div>
      <div class="lines-head ${type === 'adjustment' ? 'adj' : ''}">
        <span>Product</span>${type === 'adjustment' ? html`<span>Counted</span><span>Change</span>` : html`<span>Quantity</span><span>${info.valueLabel}</span>`}<span></span>
      </div>
      <div class="lines">${lineHtml(productId)}</div>
      <button type="button" class="btn btn-ghost btn-sm add-line">${icon('plus', 14)} Add another product</button>
      <div class="form-grid">
        <label class="field"><span>Reason${type === 'adjustment' ? ' *' : ''}</span>
          <input name="reason" list="reason-list" placeholder="e.g. ${info.reasons[0]}" ${type === 'adjustment' ? raw('required') : ''}>
          <datalist id="reason-list">${info.reasons.map((r) => html`<option value="${r}">`)}</datalist>
        </label>
        <label class="field"><span>Reference</span><input name="reference" placeholder="Invoice, order or document #"></label>
      </div>`,
    onOpen(form) {
      const lines = form.querySelector('.lines');
      const refreshDelta = (line) => {
        const out = line.querySelector('.line-delta');
        if (!out) return;
        const p = byId.get(Number(line.querySelector('.line-product').value));
        const counted = line.querySelector('[name=counted]').value;
        if (!p || counted === '') { out.textContent = p ? `Current: ${p.stock}` : ''; out.className = 'line-delta muted small'; return; }
        const delta = Number(counted) - p.stock;
        out.textContent = delta === 0 ? 'No change' : fmt.signed(delta);
        out.className = `line-delta small ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'muted'}`;
      };
      const addLine = (pid) => {
        lines.insertAdjacentHTML('beforeend', String(lineHtml(pid)));
        const line = lines.lastElementChild;
        refreshDelta(line);
        return line;
      };
      lines.addEventListener('input', (e) => refreshDelta(e.target.closest('.line')));
      lines.addEventListener('change', (e) => {
        const line = e.target.closest('.line');
        if (e.target.matches('.line-product') && type !== 'adjustment') {
          const p = byId.get(Number(e.target.value));
          const val = line.querySelector('[name=unit_value]');
          if (p && !val.value) val.placeholder = `${info.valueLabel}: ${(type === 'in' ? p.cost_price : p.unit_price).toFixed(2)}`;
        }
        refreshDelta(line);
      });
      lines.addEventListener('click', (e) => {
        if (!e.target.closest('.remove-line')) return;
        if (lines.children.length > 1) e.target.closest('.line').remove();
        else lines.querySelector('.line-product').value = '';
      });
      form.querySelector('.add-line').addEventListener('click', () => addLine('').querySelector('select').focus());

      const scan = form.querySelector('.scan-input');
      scan.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const code = scan.value.trim();
        if (!code) return;
        try {
          const p = await api.get(`/api/products/lookup/${encodeURIComponent(code)}`);
          let line = [...lines.children].find((l) => Number(l.querySelector('.line-product').value) === p.id);
          if (!line) {
            line = [...lines.children].find((l) => !l.querySelector('.line-product').value) || addLine('');
            line.querySelector('.line-product').value = p.id;
            line.querySelector('.line-product').dispatchEvent(new Event('change', { bubbles: true }));
          }
          const qty = line.querySelector('[name=quantity]');
          if (qty) qty.value = Number(qty.value || 0) + 1;
          else line.querySelector('[name=counted]').focus();
          refreshDelta(line);
          scan.value = '';
        } catch (err) {
          toast(err.message, 'error');
          scan.select();
        }
      });
      if (productId) {
        lines.querySelector('.line-product').dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => lines.querySelector('input').focus());
      }
    },
    async onSubmit(form) {
      const items = [...form.querySelectorAll('.line')].map((l) => ({
        product_id: l.querySelector('[name=product_id]').value,
        quantity: l.querySelector('[name=quantity]')?.value,
        unit_value: l.querySelector('[name=unit_value]')?.value,
        counted: l.querySelector('[name=counted]')?.value,
      })).filter((it) => it.product_id);
      if (!items.length) throw new Error('Choose at least one product');
      const result = await api.post('/api/inventory/movements', {
        type,
        reason: form.reason.value.trim() || (type === 'adjustment' ? '' : info.reasons[0]),
        reference: form.reference.value.trim(),
        items,
      });
      const msg = result.recorded
        ? `${info.title} recorded for ${result.recorded} product${result.recorded === 1 ? '' : 's'}`
        : 'Counts match current stock — nothing to adjust';
      toast(result.skipped && result.recorded ? `${msg} (${result.skipped} unchanged)` : msg);
      window.dispatchEvent(new Event('stockchange'));
      onDone?.();
    },
  });
}

export default async function inventory(view, { params }) {
  const products = await api.get('/api/products');
  const filters = { q: params.q || '', type: params.type || '', product_id: params.product_id || '', from: params.from || '', to: params.to || '', limit: 200 };

  view.innerHTML = html`
    <section class="action-cards">
      ${['in', 'out', 'adjustment'].map((t) => html`
        <button class="action-card action-${t}" data-type="${t}">
          <span class="action-icon">${icon(TYPE_INFO[t].icon, 22)}</span>
          <span><strong>${TYPE_INFO[t].title}</strong><span class="muted small">${TYPE_INFO[t].help.split(' — ')[0].split('. ')[0]}</span></span>
        </button>`)}
    </section>
    <section class="card">
      <div class="card-head">
        <div><h2>Inventory history</h2><p class="muted small">Every stock change, newest first. Stock levels are calculated from these movements.</p></div>
        <a class="btn btn-ghost btn-sm" id="to-report" href="#/reports?r=movements">${icon('download', 14)} Export</a>
      </div>
      <form class="toolbar" id="filters">
        <label class="search">${icon('search', 16)}<input name="q" type="search" placeholder="Search product, SKU, reference…" value="${filters.q}" aria-label="Search movements"></label>
        <select name="type" aria-label="Movement type">${options([{ id: 'in', name: 'Stock in' }, { id: 'out', name: 'Stock out' }, { id: 'adjustment', name: 'Adjustment' }], filters.type, { empty: 'All types' })}</select>
        <select name="product_id" aria-label="Product">${options(products, filters.product_id, { empty: 'All products' })}</select>
        <label class="inline-field">From <input type="date" name="from" value="${filters.from}"></label>
        <label class="inline-field">To <input type="date" name="to" value="${filters.to}"></label>
      </form>
      <div id="history"></div>
    </section>`;

  const historyEl = view.querySelector('#history');
  const form = view.querySelector('#filters');

  async function load() {
    const rows = await api.get('/api/inventory/movements', filters);
    view.querySelector('#to-report').href = `#/reports${api.qs({ r: 'movements', type: filters.type, product_id: filters.product_id, from: filters.from, to: filters.to, q: filters.q })}`;
    historyEl.innerHTML = rows.length ? html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Product</th><th>Type</th><th class="num">Change</th><th class="num">Balance</th><th>Reference</th><th>Reason</th></tr></thead>
        <tbody>${rows.map(movementRow)}</tbody>
      </table></div>
      ${rows.length >= filters.limit ? html`<div class="center pad"><button class="btn btn-ghost btn-sm" id="more">Show more</button></div>` : ''}`
      : String(emptyState('No movements found', 'Try changing the filters.'));
    historyEl.querySelector('#more')?.addEventListener('click', () => { filters.limit += 200; load(); });
  }

  const apply = () => {
    Object.assign(filters, Object.fromEntries(new FormData(form)), { limit: 200 });
    history.replaceState(null, '', `#/inventory${api.qs({ q: filters.q, type: filters.type, product_id: filters.product_id, from: filters.from, to: filters.to })}`);
    load();
  };
  form.addEventListener('input', debounce(apply, 250));
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  view.querySelectorAll('.action-card').forEach((b) => b.addEventListener('click', () => openStockModal(b.dataset.type, { onDone: load })));

  await load();
}

