import { api } from '../api.js';
import { html, icon, fmt, modal, toast, emptyState, debounce, confirmDialog, formData } from '../ui.js';

export function openSupplierModal(s = null, { onSaved } = {}) {
  const v = s || {};
  modal({
    title: s ? `Edit ${s.name}` : 'Add supplier',
    wide: true,
    submitLabel: s ? 'Save changes' : 'Add supplier',
    body: html`
      <div class="form-grid">
        <label class="field span-2"><span>Company name *</span><input name="name" required value="${v.name ?? ''}" autofocus></label>
        <label class="field"><span>Contact person</span><input name="contact_person" value="${v.contact_person ?? ''}"></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${v.email ?? ''}"></label>
        <label class="field"><span>Phone</span><input name="phone" type="tel" value="${v.phone ?? ''}"></label>
        <label class="field"><span>Payment terms</span><input name="payment_terms" value="${v.payment_terms ?? ''}" list="terms-list" placeholder="e.g. Net 30">
          <datalist id="terms-list">${['Due on receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60'].map((t) => html`<option value="${t}">`)}</datalist></label>
        <label class="field span-2"><span>Address</span><textarea name="address" rows="2">${v.address ?? ''}</textarea></label>
        <label class="field span-2"><span>Notes</span><textarea name="notes" rows="2">${v.notes ?? ''}</textarea></label>
      </div>`,
    async onSubmit(form) {
      const saved = s ? await api.put(`/api/suppliers/${s.id}`, formData(form)) : await api.post('/api/suppliers', formData(form));
      toast(s ? 'Supplier updated' : 'Supplier added');
      onSaved?.(saved);
    },
  });
}

export default async function suppliers(view, { params }) {
  let q = params.q || '';
  view.innerHTML = html`
    <section class="card">
      <div class="card-head">
        <div><h2>Suppliers</h2><p class="muted small" id="summary"></p></div>
        <button class="btn btn-primary" id="add">${icon('plus', 16)} Add supplier</button>
      </div>
      <div class="toolbar">
        <label class="search">${icon('search', 16)}<input id="q" type="search" placeholder="Search name, contact or email…" value="${q}" aria-label="Search suppliers"></label>
      </div>
      <div id="list"></div>
    </section>`;
  const listEl = view.querySelector('#list');
  let rows = [];

  async function load() {
    rows = await api.get('/api/suppliers', { q });
    const owed = rows.reduce((a, s) => a + Math.max(s.outstanding, 0), 0);
    view.querySelector('#summary').textContent = `${rows.length} supplier${rows.length === 1 ? '' : 's'} · ${fmt.money(owed)} outstanding`;
    listEl.innerHTML = rows.length ? html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Supplier</th><th>Contact</th><th>Terms</th><th class="num">Products</th><th class="num">Orders</th><th class="num">Purchased</th><th class="num">Outstanding</th><th></th></tr></thead>
        <tbody>${rows.map((s) => html`
          <tr class="clickable" data-id="${s.id}">
            <td><a href="#/suppliers/${s.id}"><strong>${s.name}</strong></a></td>
            <td>${s.contact_person || '—'}<div class="muted small">${[s.email, s.phone].filter(Boolean).join(' · ')}</div></td>
            <td>${s.payment_terms || '—'}</td>
            <td class="num">${s.product_count}</td>
            <td class="num">${s.po_count}</td>
            <td class="num">${fmt.money(s.total_purchased)}</td>
            <td class="num ${s.outstanding > 0.005 ? 'neg strong' : ''}">${fmt.money(s.outstanding)}</td>
            <td class="row-actions">
              <button class="icon-btn" data-edit="${s.id}" aria-label="Edit ${s.name}">${icon('edit', 16)}</button>
              <button class="icon-btn danger" data-del="${s.id}" aria-label="Delete ${s.name}">${icon('trash', 16)}</button>
            </td>
          </tr>`)}
        </tbody>
      </table></div>` : emptyState('No suppliers found', q ? 'Try a different search.' : 'Add your first supplier.');
  }

  listEl.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) return openSupplierModal(rows.find((s) => s.id === Number(edit.dataset.edit)), { onSaved: load });
    if (del) {
      const s = rows.find((x) => x.id === Number(del.dataset.del));
      if (await confirmDialog({ title: 'Delete supplier', message: `Delete "${s.name}"? Products assigned to them will have no primary supplier.` })) {
        try { await api.del(`/api/suppliers/${s.id}`); toast('Supplier deleted'); load(); } catch (err) { toast(err.message, 'error'); }
      }
      return;
    }
    const tr = e.target.closest('tr.clickable');
    if (tr && !e.target.closest('a, button')) location.hash = `#/suppliers/${tr.dataset.id}`;
  });
  view.querySelector('#q').addEventListener('input', debounce((e) => {
    q = e.target.value;
    history.replaceState(null, '', `#/suppliers${api.qs({ q })}`);
    load();
  }, 200));
  view.querySelector('#add').addEventListener('click', () => openSupplierModal(null, { onSaved: (s) => { location.hash = `#/suppliers/${s.id}`; } }));
  await load();
}
