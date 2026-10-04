import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx, applyStockChange, HttpError, UPLOAD_DIR } from '../db.js';

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.img';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'Only PNG, JPG, GIF, WEBP or SVG images are allowed'));
  },
});

function removeImage(filename) {
  if (!filename) return;
  fs.rm(path.join(UPLOAD_DIR, path.basename(filename)), { force: true }, () => {});
}

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, s.name AS supplier_name,
         p.stock * p.cost_price AS stock_value,
         CASE WHEN p.stock <= p.min_stock THEN 1 ELSE 0 END AS is_low
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id`;

function readProductBody(body) {
  const num = (v, d = 0) => (v === undefined || v === '' || v === null ? d : Number(v));
  const p = {
    name: String(body.name ?? '').trim(),
    sku: String(body.sku ?? '').trim(),
    barcode: String(body.barcode ?? '').trim(),
    category_id: body.category_id ? Number(body.category_id) : null,
    supplier_id: body.supplier_id ? Number(body.supplier_id) : null,
    description: String(body.description ?? ''),
    unit: String(body.unit ?? 'pcs').trim() || 'pcs',
    unit_price: num(body.unit_price),
    cost_price: num(body.cost_price),
    min_stock: Math.trunc(num(body.min_stock)),
  };
  if (!p.name) throw new HttpError(400, 'Product name is required');
  if (!p.sku) throw new HttpError(400, 'SKU is required');
  for (const k of ['unit_price', 'cost_price', 'min_stock']) {
    if (!Number.isFinite(p[k]) || p[k] < 0) throw new HttpError(400, `${k.replace('_', ' ')} must be a non-negative number`);
  }
  return p;
}

function assertSkuFree(sku, exceptId = 0) {
  if (get('SELECT 1 FROM products WHERE sku = ? AND id != ?', sku, exceptId)) {
    throw new HttpError(409, `SKU "${sku}" is already in use`);
  }
}

router.get('/', (req, res) => {
  const { q, category_id, supplier_id, low } = req.query;
  const where = [];
  const params = [];
  if (q) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category_id) { where.push('p.category_id = ?'); params.push(Number(category_id)); }
  if (supplier_id) { where.push('p.supplier_id = ?'); params.push(Number(supplier_id)); }
  if (low === '1') where.push('p.stock <= p.min_stock');
  const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name COLLATE NOCASE`;
  res.json(all(sql, ...params));
});

// Exact SKU / barcode lookup, used by the scanner field on stock forms.
router.get('/lookup/:code', (req, res) => {
  const row = get(`${PRODUCT_SELECT} WHERE p.sku = ? OR (p.barcode != '' AND p.barcode = ?)`, req.params.code, req.params.code);
  if (!row) throw new HttpError(404, `No product with SKU or barcode "${req.params.code}"`);
  res.json(row);
});

router.get('/:id', (req, res) => {
  const product = get(`${PRODUCT_SELECT} WHERE p.id = ?`, Number(req.params.id));
  if (!product) throw new HttpError(404, 'Product not found');
  product.movements = all(
    'SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 50',
    product.id
  );
  res.json(product);
});

router.post('/', upload.single('image'), (req, res) => {
  try {
    const p = readProductBody(req.body);
    assertSkuFree(p.sku);
    const openingStock = Math.trunc(Number(req.body.stock || 0));
    if (!Number.isFinite(openingStock) || openingStock < 0) throw new HttpError(400, 'Opening stock must be a non-negative number');
    const id = tx(() => {
      const info = run(
        `INSERT INTO products (name, sku, barcode, category_id, supplier_id, description, unit, unit_price, cost_price, min_stock, image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.name, p.sku, p.barcode, p.category_id, p.supplier_id, p.description, p.unit,
        p.unit_price, p.cost_price, p.min_stock, req.file?.filename ?? null
      );
      const id = Number(info.lastInsertRowid);
      if (openingStock > 0) {
        applyStockChange({ productId: id, type: 'in', delta: openingStock, reason: 'Opening stock', reference: 'OPENING' });
      }
      return id;
    });
    res.status(201).json(get(`${PRODUCT_SELECT} WHERE p.id = ?`, id));
  } catch (err) {
    removeImage(req.file?.filename);
    throw err;
  }
});

// Stock is deliberately not editable here — it only changes through stock movements.
router.put('/:id', upload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  try {
    const existing = get('SELECT * FROM products WHERE id = ?', id);
    if (!existing) throw new HttpError(404, 'Product not found');
    const p = readProductBody(req.body);
    assertSkuFree(p.sku, id);
    let image = existing.image;
    if (req.file) image = req.file.filename;
    else if (req.body.remove_image === '1') image = null;
    run(
      `UPDATE products SET name=?, sku=?, barcode=?, category_id=?, supplier_id=?, description=?, unit=?,
              unit_price=?, cost_price=?, min_stock=?, image=?, updated_at=datetime('now', 'localtime') WHERE id=?`,
      p.name, p.sku, p.barcode, p.category_id, p.supplier_id, p.description, p.unit,
      p.unit_price, p.cost_price, p.min_stock, image, id
    );
    if (image !== existing.image) removeImage(existing.image);
    res.json(get(`${PRODUCT_SELECT} WHERE p.id = ?`, id));
  } catch (err) {
    removeImage(req.file?.filename);
    throw err;
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM products WHERE id = ?', id);
  if (!existing) throw new HttpError(404, 'Product not found');
  const onPo = get('SELECT COUNT(*) AS n FROM purchase_order_items WHERE product_id = ?', id).n;
  if (onPo) throw new HttpError(409, `"${existing.name}" appears on ${onPo} purchase order line(s) and cannot be deleted`);
  run('DELETE FROM products WHERE id = ?', id);
  removeImage(existing.image);
  res.status(204).end();
});

export default router;
