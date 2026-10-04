import { api } from '../api.js';
import { html, raw, icon, fmt, modal, toast, confirmDialog, statusBadge, today } from '../ui.js';
import { openPoEditor } from './purchaseOrders.js';
import { purchaseOrderToPdf } from '../pdf.js';

const STEPS = ['draft', 'ordered', 'received'];

function stepper(po) {
  if (po.status === 'cancelled') {
    return html`<div class="stepper cancelled"><span class="step done">Draft</span><span class="step-line"></span><span class="step cancelled">${icon('x', 14)} Cancelled</span></div>`;
  }
  const idx = STEPS.indexOf(po.status);
  const dates = { draft: po.created_at, ordered: po.order_date, received: po.received_date };
  return html`<ol class="stepper">${STEPS.map((s, i) => html`
    ${i ? html`<li class="step-line ${i <= idx ? 'done' : ''}" aria-hidden="true"></li>` : ''}
    <li class="step ${i < idx ? 'done' : i === idx ? 'current' : ''}" ${i === idx ? raw('aria-current="step"') : ''}>
      <span class="step-dot">${i < idx || (i === idx && s === 'received') ? icon('check', 12) : i + 1}</span>
      <span>${s[0].toUpperCase() + s.slice(1)}${i <= idx && dates[s] ? html`<span class="muted small"> · ${fmt.date(dates[s])}</span>` : ''}</span>
    </li>`)}</ol>`;
}

export default async function purchaseOrderDetail(view, { id, setTitle }) {
  async function setStatus(status, extra = {}) {
    await api.post(`/api/purchase-orders/${id}/status`, { status, ...extra });
    if (status === 'received') window.dispatchEvent(new Event('stockchange'));
    await render();
  }

  async function render() {
    const po = await api.get(`/api/purchase-orders/${id}`);
    setTitle(po.po_number);
    const balance = po.total - po.paid;

    view.innerHTML = html`
      <a class="back" href="#/purchase-orders">← All purchase orders</a>
      <section class="card">
        <div class="card-head">
          <div>
            <h2>${po.po_number} ${statusBadge(po.status)}</h2>
            <p class="muted small">Supplier: <a href="#/suppliers/${po.supplier_id}">${po.supplier_name}</a></p>
          </div>
          <div class="btn-row">
            <button class="btn btn-ghost" id="pdf">${icon('printer', 16)} PDF</button>
            ${po.status === 'draft' ? html`
              <button class="btn btn-ghost" id="edit">${icon('edit', 16)} Edit</button>
              <button class="btn btn-ghost danger" id="delete">${icon('trash', 16)} Delete</button>
              <button class="btn btn-ghost" id="cancel">Cancel order</button>
              <button class="btn btn-primary" id="order">${icon('arrow', 16)} Mark as ordered</button>` : ''}
            ${po.status === 'ordered' ? html`
              <button class="btn btn-ghost" id="cancel">Cancel order</button>
              <button class="btn btn-primary" id="receive">${icon('in', 16)} Receive order</button>` : ''}
            ${po.status === 'cancelled' ? html`<button class="btn btn-ghost danger" id="delete">${icon('trash', 16)} Delete</button>` : ''}
            ${po.status === 'received' && balance > 0.005 ? html`<a class="btn btn-primary" href="#/suppliers/${po.supplier_id}">${icon('dollar', 16)} Pay supplier</a>` : ''}
          </div>
        </div>
        ${stepper(po)}
        <dl class="facts">
          <div><dt>Order date</dt><dd>${fmt.date(po.order_date)}</dd></div>
          <div><dt>Expected delivery</dt><dd>${fmt.date(po.expected_date)}</dd></div>
          <div><dt>Received</dt><dd>${fmt.date(po.received_date)}</dd></div>
          <div><dt>Order total</dt><dd class="big">${fmt.money(po.total)}</dd></div>
          ${po.status === 'received' ? html`<div><dt>Paid</dt><dd>${fmt.money(po.paid)} ${balance > 0.005 ? html`<span class="neg small">(${fmt.money(balance)} due)</span>` : html`<span class="pos small">(settled)</span>`}</dd></div>` : ''}
        </dl>
        ${po.notes ? html`<p class="notes">${po.notes}</p>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><h2>Items</h2><span class="muted small">${po.line_count} lines · ${fmt.int(po.unit_count)} units</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Product</th><th class="num">Quantity</th><th class="num">Unit cost</th><th class="num">Line total</th><th class="num">${po.status === 'received' ? 'Stock now' : 'Current stock'}</th></tr></thead>
          <tbody>${po.items.map((it) => html`
            <tr>
              <td><a href="#/products/${it.product_id}">${it.product_name}</a><div class="muted small">${it.sku}</div></td>
              <td class="num">${fmt.int(it.quantity)} <span class="muted small">${it.unit}</span></td>
              <td class="num">${fmt.money(it.unit_cost)}</td>
              <td class="num">${fmt.money(it.line_total)}</td>
              <td class="num">${fmt.int(it.stock)}${po.status === 'ordered' ? html` <span class="pos small">→ ${fmt.int(it.stock + it.quantity)}</span>` : ''}</td>
            </tr>`)}
          </tbody>
          <tfoot><tr><th>Total</th><th class="num">${fmt.int(po.unit_count)}</th><th></th><th class="num">${fmt.money(po.total)}</th><th></th></tr></tfoot>
        </table></div>
      </section>`;

    const on = (sel, fn) => view.querySelector(sel)?.addEventListener('click', fn);
    on('#pdf', async () => purchaseOrderToPdf(po, await api.get(`/api/suppliers/${po.supplier_id}`)));
    on('#edit', () => openPoEditor(po, { onSaved: render }));
    on('#order', async () => {
      if (await confirmDialog({ title: 'Mark as ordered', message: `Confirm that ${po.po_number} has been sent to ${po.supplier_name}? The order can no longer be edited afterwards.`, confirmLabel: 'Mark as ordered', danger: false })) {
        await setStatus('ordered');
        toast(`${po.po_number} marked as ordered`);
      }
    });
    on('#cancel', async () => {
      if (await confirmDialog({ title: 'Cancel order', message: `Cancel ${po.po_number}? No stock will be received for it.`, confirmLabel: 'Cancel order' })) {
        await setStatus('cancelled');
        toast(`${po.po_number} cancelled`);
      }
    });
    on('#receive', () => modal({
      title: `Receive ${po.po_number}`,
      submitLabel: 'Receive & add to stock',
      body: html`
        <p>This adds the following to stock and updates each product's cost price to the price on this order:</p>
        <ul class="receive-list">${po.items.map((it) => html`<li><span>${it.product_name}</span><span class="pos">+${fmt.int(it.quantity)} ${it.unit}</span></li>`)}</ul>
        <label class="field"><span>Received date</span><input type="date" name="received_date" value="${today()}" max="${today()}"></label>`,
      async onSubmit(form) {
        await setStatus('received', { received_date: form.received_date.value });
        toast(`${po.po_number} received — stock updated`);
      },
    }));
    on('#delete', async () => {
      if (await confirmDialog({ title: 'Delete purchase order', message: `Delete ${po.po_number}? This cannot be undone.` })) {
        await api.del(`/api/purchase-orders/${po.id}`);
        toast(`${po.po_number} deleted`);
        location.hash = '#/purchase-orders';
      }
    });
  }
  await render();
}
