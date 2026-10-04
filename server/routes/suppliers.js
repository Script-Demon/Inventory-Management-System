import { Router } from 'express';
import { all, get, run, HttpError } from '../db.js';

const router = Router();

// Amount owed = value of received purchase orders minus payments made.
export const SUPPLIER_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count,
    (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status != 'cancelled') AS po_count,
    COALESCE((SELECT SUM(i.quantity * i.unit_cost) FROM purchase_order_items i
              JOIN purchase_orders po ON po.id = i.po_id
              WHERE po.supplier_id = s.id AND po.status = 'received'), 0) AS total_purchased,
    COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0) AS total_paid
  FROM suppliers s`;

function withBalance(s) {
  if (s) s.outstanding = Math.round((s.total_purchased - s.total_paid) * 100) / 100;
  return s;
}

function readSupplierBody(body) {
  const s = {};
  for (const k of ['name', 'contact_person', 'email', 'phone', 'address', 'payment_terms', 'notes']) {
    s[k] = String(body[k] ?? '').trim();
  }
  if (!s.name) throw new HttpError(400, 'Supplier name is required');
  if (s.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) throw new HttpError(400, 'Email address looks invalid');
  return s;
}

router.get('/', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const rows = q
    ? all(`${SUPPLIER_SELECT} WHERE s.name LIKE ? OR s.contact_person LIKE ? OR s.email LIKE ? ORDER BY s.name COLLATE NOCASE`, q, q, q)
    : all(`${SUPPLIER_SELECT} ORDER BY s.name COLLATE NOCASE`);
  res.json(rows.map(withBalance));
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const supplier = withBalance(get(`${SUPPLIER_SELECT} WHERE s.id = ?`, id));
  if (!supplier) throw new HttpError(404, 'Supplier not found');

  // Products supplied: those assigned to this supplier plus anything ever bought from them.
  supplier.products = all(`
    SELECT p.id, p.name, p.sku, p.stock, p.min_stock, p.cost_price, p.unit,
           (p.supplier_id = ?) AS is_primary,
           COALESCE(SUM(CASE WHEN po.status = 'received' THEN i.quantity END), 0) AS qty_purchased,
           MAX(CASE WHEN po.status = 'received' THEN po.received_date END) AS last_received
    FROM products p
    LEFT JOIN purchase_order_items i ON i.product_id = p.id
    LEFT JOIN purchase_orders po ON po.id = i.po_id AND po.supplier_id = ?
    WHERE p.supplier_id = ? OR po.id IS NOT NULL
    GROUP BY p.id ORDER BY p.name COLLATE NOCASE`, id, id, id);

  supplier.purchase_orders = all(`
    SELECT po.*, COALESCE(SUM(i.quantity * i.unit_cost), 0) AS total, COUNT(i.id) AS line_count
    FROM purchase_orders po LEFT JOIN purchase_order_items i ON i.po_id = po.id
    WHERE po.supplier_id = ? GROUP BY po.id ORDER BY po.created_at DESC`, id);

  supplier.payments = all(`
    SELECT sp.*, po.po_number FROM supplier_payments sp
    LEFT JOIN purchase_orders po ON po.id = sp.po_id
    WHERE sp.supplier_id = ? ORDER BY sp.paid_on DESC, sp.id DESC`, id);

  res.json(supplier);
});

router.post('/', (req, res) => {
  const s = readSupplierBody(req.body);
  const info = run(
    'INSERT INTO suppliers (name, contact_person, email, phone, address, payment_terms, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    s.name, s.contact_person, s.email, s.phone, s.address, s.payment_terms, s.notes
  );
  res.status(201).json(withBalance(get(`${SUPPLIER_SELECT} WHERE s.id = ?`, Number(info.lastInsertRowid))));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT 1 FROM suppliers WHERE id = ?', id)) throw new HttpError(404, 'Supplier not found');
  const s = readSupplierBody(req.body);
  run(
    'UPDATE suppliers SET name=?, contact_person=?, email=?, phone=?, address=?, payment_terms=?, notes=? WHERE id=?',
    s.name, s.contact_person, s.email, s.phone, s.address, s.payment_terms, s.notes, id
  );
  res.json(withBalance(get(`${SUPPLIER_SELECT} WHERE s.id = ?`, id)));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const s = get('SELECT name FROM suppliers WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'Supplier not found');
  const pos = get('SELECT COUNT(*) AS n FROM purchase_orders WHERE supplier_id = ?', id).n;
  if (pos) throw new HttpError(409, `"${s.name}" has ${pos} purchase order(s) and cannot be deleted`);
  run('DELETE FROM suppliers WHERE id = ?', id);
  res.status(204).end();
});

router.post('/:id/payments', (req, res) => {
  const supplierId = Number(req.params.id);
  if (!get('SELECT 1 FROM suppliers WHERE id = ?', supplierId)) throw new HttpError(404, 'Supplier not found');
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Payment amount must be greater than 0');
  const poId = req.body.po_id ? Number(req.body.po_id) : null;
  if (poId && !get('SELECT 1 FROM purchase_orders WHERE id = ? AND supplier_id = ?', poId, supplierId)) {
    throw new HttpError(400, 'That purchase order does not belong to this supplier');
  }
  const info = run(
    "INSERT INTO supplier_payments (supplier_id, po_id, amount, paid_on, method, note) VALUES (?, ?, ?, COALESCE(NULLIF(?, ''), date('now', 'localtime')), ?, ?)",
    supplierId, poId, amount, String(req.body.paid_on ?? ''), String(req.body.method ?? ''), String(req.body.note ?? '')
  );
  res.status(201).json(get('SELECT * FROM supplier_payments WHERE id = ?', Number(info.lastInsertRowid)));
});

router.delete('/:id/payments/:paymentId', (req, res) => {
  const info = run('DELETE FROM supplier_payments WHERE id = ? AND supplier_id = ?', Number(req.params.paymentId), Number(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Payment not found');
  res.status(204).end();
});

export default router;
