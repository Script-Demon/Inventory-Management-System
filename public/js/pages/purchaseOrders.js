import { api } from '../api.js';
import { html, icon, fmt, modal, toast, options, emptyState, debounce, statusBadge, today } from '../ui.js';

/**
 * Create / edit a draft purchase order with any number of product lines.
 * `prefill` may carry supplier_id and product_id (e.g. from a "Reorder" button).
 */
export async function openPoEditor(po = null, { prefill = {}, onSaved } = {}) {
  const [suppliers, products] = await Promise.all([api.get('/api/suppliers'), api.get('/api/products')]);
  if (!suppliers.length) throw new Error('Add a supplier before creating a purchase order');
  const byId = new Map(products.map((p) => [p.id, p]));
  const supplierId = po?.supplier_id ?? prefill.supplier_id ?? '';

  // Products from the chosen supplier are listed first.
  const productOptions = (supId, selected) => {
    const mine = products.filter((p) => String(p.supplier_id) === String(supId));
    const other = products.filter((p) => String(p.supplier_id) !== String(supId));
    const label = (p) => `${p.name} (${p.sku}) — stock ${p.stock}`;
    return html`<option value="">Choose a product…</option>
      ${mine.length ? html`<optgroup label="From this supplier">${options(mine, selected, { label })}</optgroup>` : ''}
      <optgroup label="${mine.length ? 'Other products' : 'All products'}">${options(other, selected, { label })}</optgroup>`;
  };

  const lineHtml = (supId, it = {}) => html`
    <div class="line po-line">
      <select name="product_id" class="line-product" aria-label="Product">${productOptions(supId, it.product_id)}</select>
      <input name="quantity" type="number" min="1" step="1" placeholder="Qty" aria-label="Quantity" value="${it.quantity ?? ''}">
      <input name="unit_cost" type="number" min="0" step="0.01" placeholder="Unit cost" aria-label="Unit cost" value="${it.unit_cost ?? ''}">
      <span class="line-total num" aria-live="polite"></span>
      <button type="button" class="icon-btn remove-line" aria-label="Remove line">${icon('trash', 16)}</button>
    </div>`;

  // Starting lines: existing items, a prefilled product, or the supplier's low-stock items.
  let initialLines = po?.items?.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_cost: i.unit_cost })) || [];
  if (!initialLines.length && prefill.product_id) {
    const p = byId.get(Number(prefill.product_id));
    if (p) initialLines = [{ product_id: p.id, quantity: Math.max(p.min_stock * 2 - p.stock, 1), unit_cost: p.cost_price }];
  }
  if (!initialLines.length) initialLines = [{}];

  modal({
    title: po ? `Edit ${po.po_number}` : 'New purchase order',
    wide: true,
    submitLabel: po ? 'Save draft' : 'Create draft',
    body: html`
      <div class="form-grid three">
        <label class="field"><span>Supplier *</span><select name="supplier_id" required>${options(suppliers, supplierId, { empty: 'Choose a supplier…' })}</select></label>
        <label class="field"><span>Order date</span><input name="order_date" type="date" value="${po?.order_date ?? today()}"></label>
        <label class="field"><span>Expected delivery</span><input name="expected_date" type="date" value="${po?.expected_date ?? ''}"></label>
      </div>
      <div class="lines-head po"><span>Product</span><span>Quantity</span><span>Unit cost</span><span class="num">Line total</span><span></span></div>
      <div class="lines">${initialLines.map((it) => lineHtml(supplierId, it))}</div>
      <div class="lines-foot">
        <div class="btn-row">
          <button type="button" class="btn btn-ghost btn-sm add-line">${icon('plus', 14)} Add product</button>
          <button type="button" class="btn btn-ghost btn-sm add-low">${icon('alert', 14)} Add this supplier's low-stock items</button>
        </div>
        <div class="po-total">Total <strong class="grand-total">$0.00</strong></div>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2">${po?.notes ?? ''}</textarea></label>`,
    onOpen(form) {
      const lines = form.querySelector('.lines');
      const supplierSel = form.supplier_id;
      const recalc = () => {
        let total = 0;
        lines.querySelectorAll('.line').forEach((l) => {
          const q = Number(l.querySelector('[name=quantity]').value) || 0;
          const c = Number(l.querySelector('[name=unit_cost]').value) || 0;
          total += q * c;
          l.querySelector('.line-total').textContent = q && l.querySelector('[name=unit_cost]').value !== '' ? fmt.money(q * c) : '';
        });
        form.querySelector('.grand-total').textContent = fmt.money(total);
      };
      const addLine = (it) => {
        lines.insertAdjacentHTML('beforeend', String(lineHtml(supplierSel.value, it)));
        recalc();
        return lines.lastElementChild;
      };
      lines.addEventListener('input', recalc);
      lines.addEventListener('change', (e) => {
        if (!e.target.matches('.line-product')) return;
        const p = byId.get(Number(e.target.value));
        const line = e.target.closest('.line');
        if (p) {
          const cost = line.querySelector('[name=unit_cost]');
          const qty = line.querySelector('[name=quantity]');
          if (!cost.value) cost.value = p.cost_price;
          if (!qty.value) qty.value = Math.max(p.min_stock * 2 - p.stock, 1);
          qty.focus();
          qty.select();
        }
        recalc();
      });
      lines.addEventListener('click', (e) => {
        if (!e.target.closest('.remove-line')) return;
        if (lines.children.length > 1) e.target.closest('.line').remove();
        else lines.querySelectorAll('input, select').forEach((i) => { i.value = ''; });
        recalc();
      });
      supplierSel.addEventListener('change', () => {
        lines.querySelectorAll('.line-product').forEach((sel) => { const v = sel.value; sel.innerHTML = productOptions(supplierSel.value, v); });
      });
      form.querySelector('.add-line').addEventListener('click', () => addLine({}).querySelector('select').focus());
      form.querySelector('.add-low').addEventListener('click', () => {
        if (!supplierSel.value) return toast('Choose a supplier first', 'error');
        const present = new Set([...lines.querySelectorAll('.line-product')].map((s) => Number(s.value)));
        const low = products.filter((p) => String(p.supplier_id) === supplierSel.value && p.stock <= p.min_stock && !present.has(p.id));
        if (!low.length) return toast('No other low-stock items for this supplier');
        // Fill an empty first line before appending.
        [...lines.children].filter((l) => !l.querySelector('.line-product').value).forEach((l) => l.remove());
        low.forEach((p) => addLine({ product_id: p.id, quantity: Math.max(p.min_stock * 2 - p.stock, 1), unit_cost: p.cost_price }));
        toast(`Added ${low.length} low-stock item${low.length === 1 ? '' : 's'}`);
      });
      recalc();
    },
    async onSubmit(form) {
      const items = [...form.querySelectorAll('.line')].map((l) => ({
        product_id: l.querySelector('[name=product_id]').value,
        quantity: l.querySelector('[name=quantity]').value,
        unit_cost: l.querySelector('[name=unit_cost]').value,
      })).filter((it) => it.product_id || it.quantity);
      const body = { supplier_id: form.supplier_id.value, order_date: form.order_date.value, expected_date: form.expected_date.value, notes: form.notes.value, items };
      const saved = po ? await api.put(`/api/purchase-orders/${po.id}`, body) : await api.post('/api/purchase-orders', body);
      toast(po ? 'Purchase order updated' : `Draft ${saved.po_number} created`);
      onSaved?.(saved);
    },
  });
}

const TABS = [
  { id: '', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'ordered', label: 'Ordered' },
  { id: 'received', label: 'Received' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default async function purchaseOrders(view, { params }) {
  const suppliers = await api.get('/api/suppliers');
  const filters = { status: params.status || '', supplier_id: params.supplier_id && !params.new ? params.supplier_id : '', q: params.q || '' };

  view.innerHTML = html`
    <section class="card">
      <div class="card-head">
        <div><h2>Purchase orders</h2><p class="muted small">Draft → Ordered → Received. Receiving an order adds its items to stock automatically.</p></div>
        <button class="btn btn-primary" id="add">${icon('plus', 16)} New purchase order</button>
      </div>
      <div class="tabs" role="tablist">${TABS.map((t) => html`<button role="tab" data-status="${t.id}" aria-selected="${filters.status === t.id}">${t.label}<span class="tab-count" data-count="${t.id}"></span></button>`)}</div>
      <form class="toolbar" id="filters">
        <label class="search">${icon('search', 16)}<input name="q" type="search" placeholder="Search PO number or supplier…" value="${filters.q}" aria-label="Search orders"></label>
        <select name="supplier_id" aria-label="Supplier">${options(suppliers, filters.supplier_id, { empty: 'All suppliers' })}</select>
      </form>
      <div id="list"></div>
    </section>`;

  const listEl = view.querySelector('#list');
  const form = view.querySelector('#filters');

  async function load() {
    const all = await api.get('/api/purchase-orders', { supplier_id: filters.supplier_id, q: filters.q });
    for (const t of TABS) {
      const n = t.id ? all.filter((p) => p.status === t.id).length : all.length;
      view.querySelector(`[data-count="${t.id}"]`).textContent = n;
    }
    const rows = filters.status ? all.filter((p) => p.status === filters.status) : all;
    listEl.innerHTML = rows.length ? html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>PO #</th><th>Supplier</th><th>Status</th><th>Ordered</th><th>Expected</th><th>Received</th><th class="num">Items</th><th class="num">Total</th><th class="num">Paid</th></tr></thead>
        <tbody>${rows.map((po) => {
          const overdue = po.status === 'ordered' && po.expected_date && po.expected_date < today();
          return html`
          <tr class="clickable" data-id="${po.id}">
            <td><a href="#/purchase-orders/${po.id}"><strong>${po.po_number}</strong></a></td>
            <td>${po.supplier_name}</td>
            <td>${statusBadge(po.status)}</td>
            <td>${fmt.date(po.order_date)}</td>
            <td class="${overdue ? 'neg strong' : ''}">${fmt.date(po.expected_date)}${overdue ? html` <span class="small">(overdue)</span>` : ''}</td>
            <td>${fmt.date(po.received_date)}</td>
            <td class="num">${po.line_count} <span class="muted small">/ ${fmt.int(po.unit_count)} units</span></td>
            <td class="num">${fmt.money(po.total)}</td>
            <td class="num">${po.status === 'received' ? fmt.money(po.paid) : html`<span class="muted">—</span>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>` : emptyState('No purchase orders', 'Create one to restock from a supplier.');
  }

  listEl.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.clickable');
    if (tr && !e.target.closest('a')) location.hash = `#/purchase-orders/${tr.dataset.id}`;
  });
  view.querySelectorAll('[role=tab]').forEach((tab) => tab.addEventListener('click', () => {
    filters.status = tab.dataset.status;
    view.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    history.replaceState(null, '', `#/purchase-orders${api.qs(filters)}`);
    load();
  }));
  const apply = () => {
    Object.assign(filters, Object.fromEntries(new FormData(form)));
    history.replaceState(null, '', `#/purchase-orders${api.qs(filters)}`);
    load();
  };
  form.addEventListener('input', debounce(apply, 200));
  form.addEventListener('submit', (e) => e.preventDefault());
  const openNew = (prefill = {}) => openPoEditor(null, { prefill, onSaved: (po) => { location.hash = `#/purchase-orders/${po.id}`; } }).catch((err) => toast(err.message, 'error'));
  view.querySelector('#add').addEventListener('click', () => openNew());

  await load();
  if (params.new) {
    history.replaceState(null, '', '#/purchase-orders');
    openNew({ supplier_id: params.supplier_id, product_id: params.product_id });
  }
}
