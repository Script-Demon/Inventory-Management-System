import { Router } from 'express';
import { all, get, tx, applyStockChange, HttpError } from '../db.js';

const router = Router();

export const MOVEMENT_SELECT = `
  SELECT m.*, p.name AS product_name, p.sku, p.unit, po.po_number
  FROM stock_movements m
  JOIN products p ON p.id = m.product_id
  LEFT JOIN purchase_orders po ON po.id = m.po_id`;

/** Builds WHERE clause shared by the history list and the stock movement report. */
export function movementFilters(query) {
  const where = [];
  const params = [];
  if (query.product_id) { where.push('m.product_id = ?'); params.push(Number(query.product_id)); }
  if (query.type) { where.push('m.type = ?'); params.push(query.type); }
  if (query.from) { where.push('date(m.created_at) >= date(?)'); params.push(query.from); }
  if (query.to) { where.push('date(m.created_at) <= date(?)'); params.push(query.to); }
  if (query.q) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR m.reference LIKE ? OR m.reason LIKE ?)');
    params.push(...Array(4).fill(`%${query.q}%`));
  }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

router.get('/movements', (req, res) => {
  const { clause, params } = movementFilters(req.query);
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  res.json(all(`${MOVEMENT_SELECT} ${clause} ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit}`, ...params));
});

/**
 * Record stock in / out / adjustment for one or more products.
 * Body: { type, reason, reference, items: [{ product_id, quantity, unit_value?, counted? }] }
 *  - in / out: quantity is a positive number of units.
 *  - adjustment: either `counted` (physical count, sets stock to that value) or a signed `quantity`.
 * All lines succeed or none do.
 */
router.post('/movements', (req, res) => {
  const { type, reason = '', reference = '' } = req.body;
  const items = Array.isArray(req.body.items) ? req.body.items : [req.body];
  if (!['in', 'out', 'adjustment'].includes(type)) throw new HttpError(400, 'type must be in, out or adjustment');
  if (!items.length) throw new HttpError(400, 'At least one product line is required');
  if (type === 'adjustment' && !String(reason).trim()) throw new HttpError(400, 'A reason is required for stock adjustments');

  const results = tx(() => items.map((item, i) => {
    const productId = Number(item.product_id);
    if (!productId) throw new HttpError(400, `Line ${i + 1}: choose a product`);
    let delta;
    if (type === 'adjustment') {
      if (item.counted !== undefined && item.counted !== '' && item.counted !== null) {
        const counted = Math.trunc(Number(item.counted));
        if (!Number.isFinite(counted) || counted < 0) throw new HttpError(400, `Line ${i + 1}: counted quantity must be 0 or more`);
        const current = get('SELECT stock FROM products WHERE id = ?', productId);
        if (!current) throw new HttpError(404, `Line ${i + 1}: product not found`);
        delta = counted - current.stock;
      } else {
        delta = Math.trunc(Number(item.quantity));
      }
      if (!Number.isFinite(delta)) throw new HttpError(400, `Line ${i + 1}: enter a quantity`);
      if (delta === 0) return null; // count matches, nothing to record
    } else {
      const qty = Math.trunc(Number(item.quantity));
      if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, `Line ${i + 1}: quantity must be greater than 0`);
      delta = type === 'in' ? qty : -qty;
    }
    const unitValue = item.unit_value === '' || item.unit_value == null ? null : Number(item.unit_value);
    return applyStockChange({ productId, type, delta, unitValue, reason: String(reason), reference: String(reference) });
  }));

  const recorded = results.filter(Boolean);
  res.status(201).json({ recorded: recorded.length, skipped: results.length - recorded.length, movements: recorded });
});

router.get('/alerts', (_req, res) => {
  res.json(all(`
    SELECT p.id, p.name, p.sku, p.stock, p.min_stock, p.unit, s.name AS supplier_name, p.supplier_id
    FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.stock <= p.min_stock
    ORDER BY (p.stock = 0) DESC, CAST(p.stock AS REAL) / MAX(p.min_stock, 1), p.name`));
});

export default router;
