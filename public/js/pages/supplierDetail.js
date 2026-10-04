import { api } from '../api.js';
import { html, icon, fmt, modal, toast, confirmDialog, statusBadge, emptyState, options, today } from '../ui.js';
import { openSupplierModal } from './suppliers.js';

function openPaymentModal(s, onSaved) {
  // Only received orders create a liability, so those are the ones worth linking.
  const payable = s.purchase_orders.filter((po) => po.status === 'received');
  modal({
    title: `Record payment to ${s.name}`,
    submitLabel: 'Record payment',
    body: html`
      <p class="muted">Outstanding balance: <strong>${fmt.money(s.outstanding)}</strong></p>
      <div class="form-grid">
        <label class="field"><span>Amount *</span><input name="amount" type="number" min="0.01" step="0.01" required value="${s.outstanding > 0 ? s.outstanding.toFixed(2) : ''}" autofocus></label>
        <label class="field"><span>Date</span><input name="paid_on" type="date" value="${today()}"></label>
        <label class="field"><span>Method</span><select name="method">${options(['Bank transfer', 'Cheque', 'Card', 'Cash'].map((m) => ({ id: m, name: m })), 'Bank transfer')}</select></label>
        <label class="field"><span>For purchase order</span><select name="po_id">${options(payable, '', { empty: 'General / on account', label: (po) => `${po.po_number} — ${fmt.money(po.total)}` })}</select></label>
        <label class="field span-2"><span>Note</span><input name="note"></label>
      </div>`,
    async onSubmit(form) {
      await api.post(`/api/suppliers/${s.id}/payments`, Object.fromEntries(new FormData(form)));
      toast('Payment recorded');
      onSaved();
    },
  });
}

export default async function supplierDetail(view, { id, setTitle }) {
  async function render() {
    const s = await api.get(`/api/suppliers/${id}`);
    setTitle(s.name);
    view.innerHTML = html`
      <a class="back" href="#/suppliers">← All suppliers</a>
      <section class="card">
        <div class="card-head">
          <div>
            <h2>${s.name}</h2>
            <p class="muted small">Supplier since ${fmt.date(s.created_at)}${s.payment_terms ? ` · Terms: ${s.payment_terms}` : ''}</p>
          </div>
          <div class="btn-row">
            <button class="btn btn-ghost" id="edit">${icon('edit', 16)} Edit</button>
            <a class="btn btn-primary" href="#/purchase-orders?new=1&supplier_id=${s.id}">${icon('plus', 16)} New purchase order</a>
          </div>
        </div>
        <div class="supplier-grid">
          <dl class="facts contact">
            <div><dt>Contact person</dt><dd>${s.contact_person || '—'}</dd></div>
            <div><dt>Email</dt><dd>${s.email ? html`<a href="mailto:${s.email}">${s.email}</a>` : '—'}</dd></div>
            <div><dt>Phone</dt><dd>${s.phone ? html`<a href="tel:${s.phone}">${s.phone}</a>` : '—'}</dd></div>
            <div><dt>Address</dt><dd class="pre">${s.address || '—'}</dd></div>
            ${s.notes ? html`<div><dt>Notes</dt><dd class="pre">${s.notes}</dd></div>` : ''}
          </dl>
          <div class="balance-box ${s.outstanding > 0.005 ? 'owing' : ''}">
            <span class="stat-label">Outstanding balance</span>
            <span class="stat-value">${fmt.money(s.outstanding)}</span>
            <span class="muted small">${fmt.money(s.total_purchased)} received − ${fmt.money(s.total_paid)} paid</span>
            <button class="btn btn-primary btn-sm" id="pay">${icon('dollar', 14)} Record payment</button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Products supplied</h2><span class="muted small">${s.products.length} products</span></div>
        ${s.products.length ? html`
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Product</th><th class="num">Stock</th><th class="num">Min</th><th class="num">Cost</th><th class="num">Qty purchased</th><th>Last received</th></tr></thead>
            <tbody>${s.products.map((p) => html`
              <tr>
                <td><a href="#/products/${p.id}">${p.name}</a> ${p.is_primary ? html`<span class="badge badge-neutral">Primary</span>` : ''}<div class="muted small">${p.sku}</div></td>
                <td class="num ${p.stock <= p.min_stock ? 'neg strong' : ''}">${fmt.int(p.stock)}</td>
                <td class="num">${fmt.int(p.min_stock)}</td>
                <td class="num">${fmt.money(p.cost_price)}</td>
                <td class="num">${fmt.int(p.qty_purchased)}</td>
                <td>${fmt.date(p.last_received)}</td>
              </tr>`)}
            </tbody>
          </table></div>` : emptyState('No products linked', 'Assign this supplier to products, or receive a purchase order from them.')}
      </section>

      <section class="grid-2">
        <div class="card">
          <div class="card-head"><h2>Purchase history</h2><span class="muted small">${s.purchase_orders.length} orders</span></div>
          ${s.purchase_orders.length ? html`
            <div class="table-wrap scroll-y"><table class="table">
              <thead><tr><th>PO #</th><th>Status</th><th>Ordered</th><th>Received</th><th class="num">Total</th></tr></thead>
              <tbody>${s.purchase_orders.map((po) => html`
                <tr>
                  <td class="nowrap"><a href="#/purchase-orders/${po.id}">${po.po_number}</a></td>
                  <td>${statusBadge(po.status)}</td>
                  <td>${fmt.date(po.order_date)}</td>
                  <td>${fmt.date(po.received_date)}</td>
                  <td class="num">${fmt.money(po.total)}</td>
                </tr>`)}
              </tbody>
            </table></div>` : emptyState('No purchase orders yet')}
        </div>
        <div class="card">
          <div class="card-head"><h2>Payments</h2><span class="muted small">${fmt.money(s.total_paid)} paid</span></div>
          ${s.payments.length ? html`
            <div class="table-wrap scroll-y"><table class="table">
              <thead><tr><th>Date</th><th>For</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead>
              <tbody>${s.payments.map((p) => html`
                <tr>
                  <td>${fmt.date(p.paid_on)}</td>
                  <td>${p.po_id ? html`<a href="#/purchase-orders/${p.po_id}">${p.po_number}</a>` : 'On account'}${p.note ? html`<div class="muted small">${p.note}</div>` : ''}</td>
                  <td>${p.method || '—'}</td>
                  <td class="num">${fmt.money(p.amount)}</td>
                  <td class="row-actions"><button class="icon-btn danger" data-del-pay="${p.id}" aria-label="Delete payment">${icon('trash', 16)}</button></td>
                </tr>`)}
              </tbody>
            </table></div>` : emptyState('No payments recorded')}
        </div>
      </section>`;

    view.querySelector('#edit').addEventListener('click', () => openSupplierModal(s, { onSaved: render }));
    view.querySelector('#pay').addEventListener('click', () => openPaymentModal(s, render));
    view.querySelectorAll('[data-del-pay]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Delete payment', message: 'Delete this payment record? The outstanding balance will increase accordingly.' }))) return;
      await api.del(`/api/suppliers/${s.id}/payments/${b.dataset.delPay}`);
      toast('Payment deleted');
      render();
    }));
  }
  await render();
}
