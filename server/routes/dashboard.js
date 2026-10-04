import { Router } from 'express';
import { all, get } from '../db.js';
import { MOVEMENT_SELECT } from './inventory.js';

const router = Router();

/** Last `n` months as YYYY-MM keys, oldest first. */
function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

router.get('/', (_req, res) => {
  const totals = get(`
    SELECT COUNT(*) AS total_products,
           COALESCE(SUM(stock), 0) AS total_units,
           COALESCE(SUM(stock * cost_price), 0) AS inventory_value,
           COALESCE(SUM(stock * unit_price), 0) AS retail_value,
           COALESCE(SUM(CASE WHEN stock <= min_stock THEN 1 ELSE 0 END), 0) AS low_stock_count,
           COALESCE(SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count
    FROM products`);

  const pending = get(`
    SELECT COALESCE(SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END), 0) AS ordered,
           COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft,
           COALESCE((SELECT SUM(i.quantity * i.unit_cost) FROM purchase_order_items i
                     JOIN purchase_orders o ON o.id = i.po_id WHERE o.status = 'ordered'), 0) AS ordered_value
    FROM purchase_orders`);

  const outstanding = get(`
    SELECT COALESCE((SELECT SUM(i.quantity * i.unit_cost) FROM purchase_order_items i
                     JOIN purchase_orders o ON o.id = i.po_id WHERE o.status = 'received'), 0)
         - COALESCE((SELECT SUM(amount) FROM supplier_payments), 0) AS amount`).amount;

  const lowStock = all(`
    SELECT p.id, p.name, p.sku, p.stock, p.min_stock, p.unit, s.name AS supplier_name
    FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.stock <= p.min_stock
    ORDER BY (p.stock = 0) DESC, CAST(p.stock AS REAL) / MAX(p.min_stock, 1), p.name LIMIT 8`);

  const pendingOrders = all(`
    SELECT po.id, po.po_number, po.status, po.expected_date, s.name AS supplier_name,
           COALESCE((SELECT SUM(quantity * unit_cost) FROM purchase_order_items WHERE po_id = po.id), 0) AS total
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status IN ('draft', 'ordered')
    ORDER BY CASE po.status WHEN 'ordered' THEN 0 ELSE 1 END, po.expected_date IS NULL, po.expected_date LIMIT 6`);

  const recentMovements = all(`${MOVEMENT_SELECT} ORDER BY m.created_at DESC, m.id DESC LIMIT 10`);

  const months = lastMonths(12);
  const since = `${months[0]}-01`;
  const purchases = Object.fromEntries(all(`
    SELECT strftime('%Y-%m', o.received_date) AS month, SUM(i.quantity * i.unit_cost) AS value
    FROM purchase_orders o JOIN purchase_order_items i ON i.po_id = o.id
    WHERE o.status = 'received' AND o.received_date >= ? GROUP BY month`, since).map((r) => [r.month, r.value]));
  const sales = Object.fromEntries(all(`
    SELECT strftime('%Y-%m', created_at) AS month, SUM(-quantity * unit_value) AS value, SUM(-quantity) AS units
    FROM stock_movements WHERE type = 'out' AND created_at >= ? GROUP BY month`, since).map((r) => [r.month, r.value]));

  const byCategory = all(`
    SELECT COALESCE(c.name, 'Uncategorised') AS name, SUM(p.stock * p.cost_price) AS value
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    GROUP BY c.id HAVING value > 0 ORDER BY value DESC`);

  res.json({
    totals: { ...totals, pending_orders: pending.ordered, draft_orders: pending.draft, pending_value: pending.ordered_value, outstanding_payments: outstanding },
    lowStock,
    pendingOrders,
    recentMovements,
    monthly: {
      labels: months,
      purchases: months.map((m) => purchases[m] ?? 0),
      sales: months.map((m) => sales[m] ?? 0),
    },
    byCategory,
  });
});

export default router;
