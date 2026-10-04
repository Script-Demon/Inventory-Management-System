import { api } from '../api.js';
import { html, raw, icon, fmt, modal, toast, options, emptyState, debounce, confirmDialog, stockBadge, productThumb } from '../ui.js';

/** Add / edit product dialog. Resolves with the saved product. */
export async function openProductModal(product = null, { onSaved } = {}) {
  const [categories, suppliers] = await Promise.all([api.get('/api/categories'), api.get('/api/suppliers')]);
  const p = product || { unit: 'pcs', min_stock: 10 };
  const editing = Boolean(product);

  modal({
    title: editing ? `Edit ${p.name}` : 'Add product',
    wide: true,
    submitLabel: editing ? 'Save changes' : 'Add product',
    body: html`
      <div class="product-form">
        <div class="image-field">
          <div class="image-preview">${p.image ? html`<img src="/uploads/${p.image}" alt="">` : html`<span class="muted small">${icon('box', 28)}<br>No image</span>`}</div>
          <label class="btn btn-ghost btn-sm file-btn">Choose image<input type="file" name="image" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden></label>
          ${p.image ? html`<label class="check small"><input type="checkbox" name="remove_image" value="1"> Remove image</label>` : ''}
          <span class="muted small">PNG, JPG, GIF, WEBP · max 5 MB</span>
        </div>
        <div class="form-grid">
          <label class="field span-2"><span>Product name *</span><input name="name" required value="${p.name ?? ''}" autofocus></label>
          <label class="field"><span>SKU *</span><input name="sku" required value="${p.sku ?? ''}" placeholder="e.g. ELC-1001"></label>
          <label class="field"><span>Barcode</span><input name="barcode" value="${p.barcode ?? ''}" placeholder="EAN / UPC"></label>
          <label class="field"><span>Category</span>
            <div class="input-with-btn">
              <select name="category_id">${options(categories, p.category_id, { empty: 'Uncategorised' })}</select>
              <button type="button" class="btn btn-ghost btn-sm" id="new-cat" title="Add category">${icon('plus', 14)}</button>
            </div>
          </label>
          <label class="field"><span>Primary supplier</span><select name="supplier_id">${options(suppliers, p.supplier_id, { empty: 'None' })}</select></label>
          <label class="field"><span>Cost price *</span><input name="cost_price" type="number" min="0" step="0.01" required value="${p.cost_price ?? ''}"></label>
          <label class="field"><span>Unit (selling) price *</span><input name="unit_price" type="number" min="0" step="0.01" required value="${p.unit_price ?? ''}"></label>
          ${editing
            ? html`<div class="field"><span>Current stock</span><div class="readonly">${fmt.int(p.stock)} ${p.unit} <span class="muted small">— change via Inventory</span></div></div>`
            : html`<label class="field"><span>Opening stock</span><input name="stock" type="number" min="0" step="1" value="0"></label>`}
          <label class="field"><span>Minimum stock threshold</span><input name="min_stock" type="number" min="0" step="1" value="${p.min_stock ?? 0}"></label>
          <label class="field"><span>Unit of measure</span><input name="unit" value="${p.unit ?? 'pcs'}" list="unit-list"><datalist id="unit-list">${['pcs', 'box', 'pack', 'kg', 'litre', 'roll', 'ream', 'bottle', 'set'].map((u) => html`<option value="${u}">`)}</datalist></label>
          <div class="field margin-hint muted small" aria-live="polite"></div>
          <label class="field span-2"><span>Description</span><textarea name="description" rows="2">${p.description ?? ''}</textarea></label>
        </div>
      </div>`,
    onOpen(form) {
      const file = form.querySelector('[name=image]');
      file.addEventListener('change', () => {
        const f = file.files[0];
        if (f) form.querySelector('.image-preview').innerHTML = html`<img src="${URL.createObjectURL(f)}" alt="">`;
      });
      const hint = form.querySelector('.margin-hint');
      const updateMargin = () => {
        const cost = Number(form.cost_price.value), price = Number(form.unit_price.value);
        hint.textContent = price > 0 && form.cost_price.value !== '' ? `Margin: ${fmt.money(price - cost)} (${(((price - cost) / price) * 100).toFixed(1)}%)` : '';
      };
      form.cost_price.addEventListener('input', updateMargin);
      form.unit_price.addEventListener('input', updateMargin);
      updateMargin();
      form.querySelector('#new-cat').addEventListener('click', () => {
        openCategoryModal(null, (cat) => {
          const sel = form.category_id;
          sel.insertAdjacentHTML('beforeend', String(html`<option value="${cat.id}">${cat.name}</option>`));
          sel.value = cat.id;
        });
      });
    },
    async onSubmit(form) {
      const fd = new FormData(form);
      if (!fd.get('image')?.size) fd.delete('image');
      const saved = editing ? await api.put(`/api/products/${p.id}`, fd) : await api.post('/api/products', fd);
      toast(editing ? 'Product updated' : 'Product added');
      window.dispatchEvent(new Event('stockchange'));
      onSaved?.(saved);
    },
  });
}

export function openCategoryModal(cat, onSaved) {
  modal({
    title: cat ? 'Edit category' : 'New category',
    submitLabel: cat ? 'Save' : 'Add category',
    body: html`
      <label class="field"><span>Name *</span><input name="name" required value="${cat?.name ?? ''}" autofocus></label>
      <label class="field"><span>Description</span><input name="description" value="${cat?.description ?? ''}"></label>`,
    async onSubmit(form) {
      const body = { name: form.name.value, description: form.description.value };
      const saved = cat ? await api.put(`/api/categories/${cat.id}`, body) : await api.post('/api/categories', body);
      toast(cat ? 'Category updated' : 'Category added');
      onSaved?.(saved);
    },
  });
}

async function openCategoriesManager(onChange) {
  const render = async (container) => {
    const cats = await api.get('/api/categories');
    container.innerHTML = cats.length ? html`
      <table class="table compact">
        <thead><tr><th>Category</th><th class="num">Products</th><th class="num">Stock value</th><th></th></tr></thead>
        <tbody>${cats.map((c) => html`
          <tr>
            <td><strong>${c.name}</strong><div class="muted small">${c.description}</div></td>
            <td class="num">${c.product_count}</td>
            <td class="num">${fmt.money(c.stock_value)}</td>
            <td class="row-actions">
              <button type="button" class="icon-btn" data-edit="${c.id}" aria-label="Edit ${c.name}">${icon('edit', 16)}</button>
              <button type="button" class="icon-btn danger" data-del="${c.id}" aria-label="Delete ${c.name}">${icon('trash', 16)}</button>
            </td>
          </tr>`)}</tbody>
      </table>` : String(emptyState('No categories yet'));
    container.onclick = async (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');
      if (edit) openCategoryModal(cats.find((c) => c.id === Number(edit.dataset.edit)), () => { render(container); onChange(); });
      if (del) {
        const c = cats.find((x) => x.id === Number(del.dataset.del));
        if (await confirmDialog({ title: 'Delete category', message: `Delete "${c.name}"? ${c.product_count ? `Its ${c.product_count} product(s) will become uncategorised.` : ''}` })) {
          await api.del(`/api/categories/${c.id}`);
          toast('Category deleted');
          render(container);
          onChange();
        }
      }
    };
  };
  const { form } = modal({
    title: 'Product categories',
    body: html`<div class="cat-list"></div><button type="button" class="btn btn-ghost btn-sm" id="add-cat">${icon('plus', 14)} New category</button>`,
  });
  const list = form.querySelector('.cat-list');
  form.querySelector('#add-cat').addEventListener('click', () => openCategoryModal(null, () => { render(list); onChange(); }));
  await render(list);
}

export default async function products(view, { params }) {
  const [categories, suppliers] = await Promise.all([api.get('/api/categories'), api.get('/api/suppliers')]);
  const filters = { q: params.q || '', category_id: params.category_id || '', supplier_id: params.supplier_id || '', low: params.low || '' };
  let layout = 'table';
  try { layout = localStorage.getItem('ims-products-layout') || 'table'; } catch { /* ignore */ }

  view.innerHTML = html`
    <section class="card">
      <div class="card-head">
        <div><h2>Products</h2><p class="muted small" id="summary"></p></div>
        <div class="btn-row">
          <button class="btn btn-ghost" id="manage-cats">${icon('layers', 16)} Categories</button>
          <button class="btn btn-primary" id="add">${icon('plus', 16)} Add product</button>
        </div>
      </div>
      <form class="toolbar" id="filters">
        <label class="search">${icon('search', 16)}<input name="q" type="search" placeholder="Search name, SKU or barcode…" value="${filters.q}" aria-label="Search products"></label>
        <select name="category_id" aria-label="Category">${options(categories, filters.category_id, { empty: 'All categories' })}</select>
        <select name="supplier_id" aria-label="Supplier">${options(suppliers, filters.supplier_id, { empty: 'All suppliers' })}</select>
        <label class="check"><input type="checkbox" name="low" value="1" ${filters.low === '1' ? raw('checked') : ''}> Low stock only</label>
        <div class="segmented" role="group" aria-label="Layout">
          <button type="button" data-layout="table" aria-pressed="${layout === 'table'}">List</button>
          <button type="button" data-layout="grid" aria-pressed="${layout === 'grid'}">Grid</button>
        </div>
      </form>
      <div id="list"></div>
    </section>`;

  const listEl = view.querySelector('#list');
  const form = view.querySelector('#filters');
  let rows = [];

  async function load() {
    rows = await api.get('/api/products', filters);
    const value = rows.reduce((a, p) => a + p.stock_value, 0);
    view.querySelector('#summary').textContent = `${rows.length} product${rows.length === 1 ? '' : 's'} · ${fmt.money(value)} at cost`;
    if (!rows.length) {
      listEl.innerHTML = emptyState('No products found', filters.q || filters.low || filters.category_id || filters.supplier_id ? 'Try clearing the filters.' : 'Add your first product to get started.');
      return;
    }
    listEl.innerHTML = layout === 'grid' ? html`
      <div class="product-grid">${rows.map((p) => html`
        <a class="product-card" href="#/products/${p.id}">
          <div class="product-card-img">${productThumb(p, 'lg')}</div>
          <div class="product-card-body">
            <strong>${p.name}</strong>
            <span class="muted small">${p.sku} · ${p.category_name || 'Uncategorised'}</span>
            <div class="product-card-foot"><span>${fmt.money(p.unit_price)}</span><span class="${p.is_low ? 'neg' : ''}">${fmt.int(p.stock)} ${p.unit}</span></div>
            ${stockBadge(p.stock, p.min_stock)}
          </div>
        </a>`)}
      </div>` : html`
      <div class="table-wrap"><table class="table">
        <thead><tr>
          <th></th><th>Product</th><th>Category</th><th>Supplier</th>
          <th class="num">Cost</th><th class="num">Price</th><th class="num">Stock</th><th class="num">Min</th><th>Status</th><th class="num">Value</th><th></th>
        </tr></thead>
        <tbody>${rows.map((p) => html`
          <tr class="clickable" data-id="${p.id}">
            <td class="thumb-cell">${productThumb(p)}</td>
            <td><a href="#/products/${p.id}"><strong>${p.name}</strong></a><div class="muted small">${p.sku}${p.barcode ? html` · ${p.barcode}` : ''}</div></td>
            <td>${p.category_name || html`<span class="muted">—</span>`}</td>
            <td>${p.supplier_name || html`<span class="muted">—</span>`}</td>
            <td class="num">${fmt.money(p.cost_price)}</td>
            <td class="num">${fmt.money(p.unit_price)}</td>
            <td class="num"><strong>${fmt.int(p.stock)}</strong> <span class="muted small">${p.unit}</span></td>
            <td class="num">${fmt.int(p.min_stock)}</td>
            <td>${stockBadge(p.stock, p.min_stock)}</td>
            <td class="num">${fmt.money(p.stock_value)}</td>
            <td class="row-actions">
              <button class="icon-btn" data-edit="${p.id}" aria-label="Edit ${p.name}">${icon('edit', 16)}</button>
              <button class="icon-btn danger" data-del="${p.id}" aria-label="Delete ${p.name}">${icon('trash', 16)}</button>
            </td>
          </tr>`)}
        </tbody>
      </table></div>`;
  }

  listEl.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      const p = await api.get(`/api/products/${edit.dataset.edit}`);
      return openProductModal(p, { onSaved: load });
    }
    if (del) {
      const p = rows.find((r) => r.id === Number(del.dataset.del));
      if (await confirmDialog({ title: 'Delete product', message: `Delete "${p.name}" (${p.sku})? Its stock history will also be removed. This cannot be undone.` })) {
        try {
          await api.del(`/api/products/${p.id}`);
          toast('Product deleted');
          window.dispatchEvent(new Event('stockchange'));
          load();
        } catch (err) { toast(err.message, 'error'); }
      }
      return;
    }
    const tr = e.target.closest('tr.clickable');
    if (tr && !e.target.closest('a, button')) location.hash = `#/products/${tr.dataset.id}`;
  });

  const apply = () => {
    const fd = new FormData(form);
    Object.assign(filters, { q: fd.get('q') || '', category_id: fd.get('category_id') || '', supplier_id: fd.get('supplier_id') || '', low: fd.get('low') || '' });
    history.replaceState(null, '', `#/products${api.qs(filters)}`);
    load();
  };
  form.addEventListener('input', debounce(apply, 200));
  form.addEventListener('submit', (e) => e.preventDefault());
  form.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => {
    layout = b.dataset.layout;
    try { localStorage.setItem('ims-products-layout', layout); } catch { /* ignore */ }
    form.querySelectorAll('[data-layout]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));
  view.querySelector('#add').addEventListener('click', () => openProductModal(null, { onSaved: (p) => { location.hash = `#/products/${p.id}`; } }));
  view.querySelector('#manage-cats').addEventListener('click', () => openCategoriesManager(async () => {
    const cats = await api.get('/api/categories');
    form.category_id.innerHTML = options(cats, filters.category_id, { empty: 'All categories' });
    load();
  }));

  await load();
}
