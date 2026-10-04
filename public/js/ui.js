// Shared rendering helpers: escaping, formatting, toasts, modals, icons.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Tagged template that escapes interpolations. It returns a Raw (safe) string, so
 * nested html`` results and arrays of them are inserted without double-escaping.
 * Plain strings are always escaped; wrap trusted markup in raw().
 */
class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => (s instanceof Raw ? s : new Raw(String(s ?? '')));
const part = (v) => (v instanceof Raw ? v.s : v === false || v == null ? '' : esc(v));
export function html(strings, ...values) {
  return new Raw(strings.reduce((out, s, i) => {
    const v = values[i - 1];
    return out + (Array.isArray(v) ? v.map(part).join('') : part(v)) + s;
  }));
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const currencyShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const number = new Intl.NumberFormat();

export const fmt = {
  money: (v) => (v == null || v === '' ? '—' : currency.format(Number(v))),
  moneyShort: (v) => currencyShort.format(Number(v) || 0),
  int: (v) => (v == null || v === '' ? '—' : number.format(Number(v))),
  pct: (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`),
  date: (v) => {
    if (!v) return '—';
    const d = new Date(String(v).length <= 10 ? `${v}T00:00:00` : String(v).replace(' ', 'T'));
    return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  },
  datetime: (v) => {
    if (!v) return '—';
    const d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d) ? String(v) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  },
  signed: (v) => (Number(v) > 0 ? `+${number.format(v)}` : number.format(v)),
  month: (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  },
};

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// --- Icons (inline SVG, stroke = currentColor) -------------------------------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  in: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>',
  out: '<path d="M12 20V8M6 14l6-6 6 6M4 4h16"/>',
  adjust: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  moon: '<path d="M20 15A8 8 0 1 1 9 4a7 7 0 0 0 11 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  dollar: '<path d="M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6"/>',
  barcode: '<path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  printer: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/>',
};
export const icon = (name, size = 18) =>
  raw(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);

// --- Badges ------------------------------------------------------------------
const STATUS_LABEL = { draft: 'Draft', ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled', in: 'Stock in', out: 'Stock out', adjustment: 'Adjustment' };
export const statusLabel = (s) => STATUS_LABEL[s] || s;
export const statusBadge = (s) => html`<span class="badge badge-${s}">${statusLabel(s)}</span>`;

export function stockBadge(stock, min) {
  if (stock === 0) return html`<span class="badge badge-critical">${icon('alert', 12)} Out of stock</span>`;
  if (stock <= min) return html`<span class="badge badge-warning">${icon('alert', 12)} Low stock</span>`;
  return html`<span class="badge badge-good">${icon('check', 12)} In stock</span>`;
}

// --- Toasts ------------------------------------------------------------------
export function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = html`${icon(type === 'error' ? 'alert' : 'check', 16)}<span>${message}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.classList.add('leaving'), 3800);
  setTimeout(() => el.remove(), 4200);
}

// --- Modal -------------------------------------------------------------------
/**
 * Opens a modal. `body` is HTML; `onSubmit(form)` runs when the form is submitted,
 * and the modal closes if it resolves without throwing (errors show inline).
 */
export function modal({ title, body, submitLabel = 'Save', onSubmit, wide = false, danger = false, onOpen }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = html`
    <form class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" novalidate>
      <header class="modal-header">
        <h2 id="modal-title">${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="modal-body">${raw(body)}<div class="form-error" hidden></div></div>
      ${onSubmit ? html`<footer class="modal-footer">
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>
      </footer>` : ''}
    </form>`;
  root.appendChild(wrap);
  const form = wrap.querySelector('form');
  const errorEl = wrap.querySelector('.form-error');
  const previousFocus = document.activeElement;

  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    previousFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    errorEl.hidden = true;
    try {
      await onSubmit(form);
      close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  onOpen?.(form);
  (form.querySelector('[autofocus]') || form.querySelector('input:not([type=hidden]), select, textarea, button[type=submit]'))?.focus();
  return { form, close };
}

export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const { form } = modal({
      title,
      body: html`<p>${message}</p>`,
      submitLabel: confirmLabel,
      danger,
      onSubmit: () => { confirmed = true; },
    });
    const observer = new MutationObserver(() => {
      if (!form.isConnected) { observer.disconnect(); resolve(confirmed); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

/** Collects form fields into a plain object. */
export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export const options = (items, selected, { value = 'id', label = 'name', empty } = {}) => html`
  ${empty !== undefined ? html`<option value="">${empty}</option>` : ''}
  ${items.map((it) => html`<option value="${it[value]}" ${String(it[value]) === String(selected ?? '') ? raw('selected') : ''}>${typeof label === 'function' ? label(it) : it[label]}</option>`)}`;

export const emptyState = (title, text = '', action = '') =>
  html`<div class="empty">${icon('box', 32)}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${raw(action)}</div>`;

export const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

export function productThumb(p, size = 'sm') {
  if (p.image) return html`<img class="thumb thumb-${size}" src="/uploads/${p.image}" alt="" loading="lazy">`;
  const initials = String(p.name || p.product_name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return html`<span class="thumb thumb-${size} thumb-placeholder" aria-hidden="true">${initials}</span>`;
}
