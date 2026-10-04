import { api } from '../api.js';
import { html, icon, fmt, options, toast, statusBadge, emptyState, today } from '../ui.js';
import { formatCell, reportToPdf } from '../pdf.js';

const REPORTS = [
  { id: 'valuation', title: 'Inventory valuation', desc: 'Stock value at cost and retail, per product', icon: 'dollar', filters: ['category'] },
  { id: 'movements', title: 'Stock movement', desc: 'All stock in, out and adjustments over a period', icon: 'layers', filters: ['dates', 'type', 'product'] },
  { id: 'purchases', title: 'Purchases', desc: 'Purchase orders by supplier, status and date', icon: 'clipboard', filters: ['dates', 'supplier', 'status'] },
  { id: 'low-stock', title: 'Low stock', desc: 'Items at or below minimum, with reorder suggestions', icon: 'alert', filters: [] },
  { id: 'supplier-performance', title: 'Supplier performance', desc: 'Spend, lead time, on-time delivery and balances', icon: 'truck', filters: ['dates'] },
];

const monthStart = () => today().slice(0, 8) + '01';
const daysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const PRESETS = [
  { label: 'Last 30 days', from: () => daysAgo(29), to: today },
  { label: 'This month', from: monthStart, to: today },
  { label: 'Last 90 days', from: () => daysAgo(89), to: today },
  { label: 'This year', from: () => `${new Date().getFullYear()}-01-01`, to: today },
  { label: 'All time', from: () => '', to: () => '' },
];

export default async function reports(view, { params }) {
  const [categories, suppliers, products] = await Promise.all([api.get('/api/categories'), api.get('/api/suppliers'), api.get('/api/products')]);
  let current = REPORTS.find((r) => r.id === params.r) || REPORTS[0];
  const filters = {
    from: params.from ?? daysAgo(29), to: params.to ?? today(),
    category_id: params.category_id || '', supplier_id: params.supplier_id || '', status: params.status || '',
    type: params.type || '', product_id: params.product_id || '', q: params.q || '',
  };
  let report = null;
  let sort = { key: null, dir: 1 };

  view.innerHTML = html`
    <section class="report-picker" role="tablist" aria-label="Reports">
      ${REPORTS.map((r) => html`
        <button class="report-tab" role="tab" data-r="${r.id}" aria-selected="${r.id === current.id}">
          ${icon(r.icon, 18)}<span><strong>${r.title}</strong><span class="muted small">${r.desc}</span></span>
        </button>`)}
    </section>
    <section class="card">
      <div class="card-head">
        <div><h2 id="r-title"></h2><p class="muted small" id="r-sub"></p></div>
        <div class="btn-row">
          <a class="btn btn-ghost" id="csv" download>${icon('download', 16)} CSV</a>
          <button class="btn btn-ghost" id="pdf">${icon('file', 16)} PDF</button>
          <button class="btn btn-ghost" id="print">${icon('printer', 16)} Print</button>
        </div>
      </div>
      <form class="toolbar" id="filters"></form>
      <div id="r-body"></div>
    </section>`;

  const form = view.querySelector('#filters');
  const body = view.querySelector('#r-body');

  // Show the matching preset name, or "Custom range" when the dates were edited by hand.
  function syncPreset() {
    const preset = form.querySelector('#preset');
    if (!preset) return;
    const i = PRESETS.findIndex((p) => p.from() === filters.from && p.to() === filters.to);
    preset.value = i >= 0 ? String(i) : '';
  }

  function renderFilters() {
    const f = current.filters;
    form.innerHTML = html`
      ${f.includes('dates') ? html`
        <select id="preset" aria-label="Date range">
          <option value="">Custom range</option>
          ${PRESETS.map((p, i) => html`<option value="${i}">${p.label}</option>`)}
        </select>
        <label class="inline-field">From <input type="date" name="from" value="${filters.from}"></label>
        <label class="inline-field">To <input type="date" name="to" value="${filters.to}"></label>` : ''}
      ${f.includes('category') ? html`<select name="category_id" aria-label="Category">${options(categories, filters.category_id, { empty: 'All categories' })}</select>` : ''}
      ${f.includes('supplier') ? html`<select name="supplier_id" aria-label="Supplier">${options(suppliers, filters.supplier_id, { empty: 'All suppliers' })}</select>` : ''}
      ${f.includes('status') ? html`<select name="status" aria-label="Status">${options(['draft', 'ordered', 'received', 'cancelled'].map((s) => ({ id: s, name: s[0].toUpperCase() + s.slice(1) })), filters.status, { empty: 'All statuses' })}</select>` : ''}
      ${f.includes('type') ? html`<select name="type" aria-label="Movement type">${options([{ id: 'in', name: 'Stock in' }, { id: 'out', name: 'Stock out' }, { id: 'adjustment', name: 'Adjustment' }], filters.type, { empty: 'All types' })}</select>` : ''}
      ${f.includes('product') ? html`<select name="product_id" aria-label="Product">${options(products, filters.product_id, { empty: 'All products' })}</select>` : ''}
      ${!f.length ? html`<span class="muted small">Live snapshot — no filters needed.</span>` : ''}`;
    syncPreset();
  }

  const queryFor = () => {
    const q = {};
    if (current.filters.includes('dates')) Object.assign(q, { from: filters.from, to: filters.to });
    if (current.filters.includes('category')) q.category_id = filters.category_id;
    if (current.filters.includes('supplier')) q.supplier_id = filters.supplier_id;
    if (current.filters.includes('status')) q.status = filters.status;
    if (current.filters.includes('type')) q.type = filters.type;
    if (current.filters.includes('product')) { q.product_id = filters.product_id; q.q = filters.q; }
    return q;
  };

  function cell(row, col) {
    const v = row[col.key];
    if (col.type === 'status' && v) return statusBadge(v);
    if (col.key === 'quantity' && current.id === 'movements') return html`<span class="${v > 0 ? 'pos' : 'neg'}">${fmt.signed(v)}</span>`;
    return formatCell(v, col.type);
  }

  // Current rows in the order shown on screen (used by the table and the PDF).
  function sortedRows() {
    if (!sort.key) return report.rows;
    return [...report.rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }

  function renderTable() {
    const rows = sortedRows();
    const numeric = (c) => ['money', 'int', 'pct'].includes(c.type);
    body.innerHTML = rows.length ? html`
      <div class="table-wrap report-table"><table class="table">
        <thead><tr>${report.columns.map((c) => html`
          <th class="${numeric(c) ? 'num' : ''}" aria-sort="${sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">
            <button class="sort-btn" data-key="${c.key}">${c.label}<span class="sort-ind">${sort.key === c.key ? (sort.dir > 0 ? '▲' : '▼') : ''}</span></button>
          </th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr>${report.columns.map((c) => html`<td class="${numeric(c) ? 'num' : ''}">${cell(r, c)}</td>`)}</tr>`)}</tbody>
        ${report.totals ? html`<tfoot><tr>${report.columns.map((c) => html`<th class="${numeric(c) ? 'num' : ''}">${report.totals[c.key] === undefined ? '' : formatCell(report.totals[c.key], c.type)}</th>`)}</tr></tfoot>` : ''}
      </table></div>` : emptyState('Nothing to report', 'No records match these filters.');
    body.querySelectorAll('.sort-btn').forEach((b) => b.addEventListener('click', () => {
      sort = sort.key === b.dataset.key ? { key: b.dataset.key, dir: -sort.dir } : { key: b.dataset.key, dir: 1 };
      renderTable();
    }));
  }

  async function load() {
    const q = queryFor();
    history.replaceState(null, '', `#/reports${api.qs({ r: current.id, ...q })}`);
    view.querySelector('#csv').href = `/api/reports/${current.id}${api.qs({ ...q, format: 'csv' })}`;
    body.innerHTML = '<div class="loading">Loading…</div>';
    report = await api.get(`/api/reports/${current.id}`, q);
    view.querySelector('#r-title').textContent = report.title;
    view.querySelector('#r-sub').textContent = report.subtitle;
    renderTable();
  }

  form.addEventListener('change', (e) => {
    if (e.target.id === 'preset') {
      const p = PRESETS[Number(e.target.value)];
      if (!p) return;
      filters.from = p.from();
      filters.to = p.to();
      form.from.value = filters.from;
      form.to.value = filters.to;
    } else {
      Object.assign(filters, Object.fromEntries(new FormData(form)));
      syncPreset();
    }
    load();
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  view.querySelectorAll('.report-tab').forEach((tab) => tab.addEventListener('click', () => {
    current = REPORTS.find((r) => r.id === tab.dataset.r);
    sort = { key: null, dir: 1 };
    view.querySelectorAll('.report-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    renderFilters();
    load();
  }));

  view.querySelector('#pdf').addEventListener('click', () => {
    if (!report) return;
    try {
      reportToPdf({ ...report, rows: sortedRows() }, `${current.id}-${today()}.pdf`);
    } catch (err) {
      console.error(err);
      toast('Could not create the PDF: ' + err.message, 'error');
    }
  });
  view.querySelector('#print').addEventListener('click', () => window.print());

  renderFilters();
  await load();
}
