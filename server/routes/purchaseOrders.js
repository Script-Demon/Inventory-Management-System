import { Router } from 'express';
import { all, get, run, tx, applyStockChange, HttpError } from '../db.js';

const router = Router();

// Allowed status changes. Received and cancelled are final.
const TRANSITIONS = {
  draft: ['ordered', 'cancelled'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

const PO_SELECT = `
  SELECT po.*, s.name AS supplier_name,
         COALESCE((SELECT SUM(quantity * unit_cost) FROM purchase_order_items WHERE po_id = po.id), 0) AS total,
         (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) AS line_count,
         (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_items WHERE po_id = po.id) AS unit_count,
         COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE po_id = po.id), 0) AS paid
  FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id`;

function loadPo(id) {
  const po = get(`${PO_SELECT} WHERE po.id = ?`, id);
  if (!po) throw new HttpError(404, 'Purchase order not found');
  po.items = all(`
    SELECT i.*, p.name AS product_name, p.sku, p.unit, p.stock, i.quantity * i.unit_cost AS line_total
    FROM purchase_order_items i JOIN products p ON p.id = i.product_id
    WHERE i.po_id = ? ORDER BY i.id`, id);
  return po;
}

function nextPoNumber() {
  const year = new Date().getFullYear();
  const last = get("SELECT po_number FROM purchase_orders WHERE po_number LIKE ? ORDER BY id DESC LIMIT 1", `PO-${year}-%`);
  const seq = last ? Number(last.po_number.split('-')[2]) + 1 : 1;
  return `PO-${year}-${String(seq).padStart(4, '0')}`;
}

function readItems(items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Add at least one product to the order');
  const seen = new Set();
  return items.map((it, i) => {
    const product_id = Number(it.product_id);
    const quantity = Math.trunc(Number(it.quantity));
    const unit_cost = Number(it.unit_cost);
    if (!product_id || !get('SELECT 1 FROM products WHERE id = ?', product_id)) throw new HttpError(400, `Line ${i + 1}: choose a valid product`);
    if (seen.has(product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed more than once`);
    seen.add(product_id);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, `Line ${i + 1}: quantity must be greater than 0`);
    if (!Number.isFinite(unit_cost) || unit_cost < 0) throw new HttpError(400, `Line ${i + 1}: unit cost must be 0 or more`);
    return { product_id, quantity, unit_cost };
  });
}

function writeItems(poId, items) {
  run('DELETE FROM purchase_order_items WHERE po_id = ?', poId);
  for (const it of items) {
    run('INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', poId, it.product_id, it.quantity, it.unit_cost);
  }
}

const dateOrNull = (v) => (v ? String(v).slice(0, 10) : null);

router.get('/', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('po.status = ?'); params.push(req.query.status); }
  if (req.query.supplier_id) { where.push('po.supplier_id = ?'); params.push(Number(req.query.supplier_id)); }
  if (req.query.q) { where.push('(po.po_number LIKE ? OR s.name LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  res.json(all(`${PO_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY po.created_at DESC, po.id DESC`, ...params));
});

router.get('/:id', (req, res) => res.json(loadPo(Number(req.params.id))));

router.post('/', (req, res) => {
  const supplierId = Number(req.body.supplier_id);
  if (!supplierId || !get('SELECT 1 FROM suppliers WHERE id = ?', supplierId)) throw new HttpError(400, 'Choose a supplier');
  const items = readItems(req.body.items);
  const id = tx(() => {
    const info = run(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, expected_date, notes) VALUES (?, ?, 'draft', ?, ?, ?)`,
      nextPoNumber(), supplierId, dateOrNull(req.body.order_date), dateOrNull(req.body.expected_date), String(req.body.notes ?? '')
    );
    const id = Number(info.lastInsertRowid);
    writeItems(id, items);
    return id;
  });
  res.status(201).json(loadPo(id));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const po = loadPo(id);
  if (po.status !== 'draft') throw new HttpError(409, `Only draft orders can be edited (this one is ${po.status})`);
  const supplierId = Number(req.body.supplier_id);
  if (!supplierId || !get('SELECT 1 FROM suppliers WHERE id = ?', supplierId)) throw new HttpError(400, 'Choose a supplier');
  const items = readItems(req.body.items);
  tx(() => {
    run(
      `UPDATE purchase_orders SET supplier_id=?, order_date=?, expected_date=?, notes=?, updated_at=datetime('now', 'localtime') WHERE id=?`,
      supplierId, dateOrNull(req.body.order_date), dateOrNull(req.body.expected_date), String(req.body.notes ?? ''), id
    );
    writeItems(id, items);
  });
  res.json(loadPo(id));
});

/**
 * Move an order through Draft → Ordered → Received, or cancel it.
 * Receiving adds every line to stock (one 'in' movement per line) and updates
 * each product's cost price to the price paid on this order.
 */
router.post('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const po = loadPo(id);
  if (!TRANSITIONS[po.status].includes(status)) {
    throw new HttpError(409, `Cannot change an order from ${po.status} to ${status}`);
  }
  tx(() => {
    if (status === 'ordered') {
      run(`UPDATE purchase_orders SET status='ordered', order_date=COALESCE(order_date, date('now', 'localtime')), updated_at=datetime('now', 'localtime') WHERE id=?`, id);
    } else if (status === 'received') {
      const receivedDate = dateOrNull(req.body.received_date) || get("SELECT date('now', 'localtime') AS d").d;
      for (const item of po.items) {
        applyStockChange({
          productId: item.product_id,
          type: 'in',
          delta: item.quantity,
          unitValue: item.unit_cost,
          reason: 'Purchase order received',
          reference: po.po_number,
          poId: id,
        });
        run("UPDATE products SET cost_price = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", item.unit_cost, item.product_id);
      }
      run(`UPDATE purchase_orders SET status='received', received_date=?, updated_at=datetime('now', 'localtime') WHERE id=?`, receivedDate, id);
    } else {
      run(`UPDATE purchase_orders SET status=?, updated_at=datetime('now', 'localtime') WHERE id=?`, status, id);
    }
  });
  res.json(loadPo(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const po = loadPo(id);
  if (!['draft', 'cancelled'].includes(po.status)) throw new HttpError(409, 'Only draft or cancelled orders can be deleted');
  run('DELETE FROM purchase_orders WHERE id = ?', id);
  res.status(204).end();
});

export default router;
