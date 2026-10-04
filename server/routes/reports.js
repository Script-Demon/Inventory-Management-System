import { Router } from 'express';
import { all, HttpError } from '../db.js';
import { MOVEMENT_SELECT, movementFilters } from './inventory.js';

const router = Router();

/*
 * Every report returns the same shape so the client can render, print and export
 * any of them with one table component:
 *   { title, subtitle, columns: [{ key, label, type }], rows, totals }
 * Column types: text | int | money | date | datetime | pct | status
 */

const sum = (rows, key) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

function rangeLabel({ from, to }) {
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return 'All dates';
}

const reports = {
  valuation(q) {
    const params = [];
    let where = '';
    if (q.category_id) { where = 'WHERE p.category_id = ?'; params.push(Number(q.category_id)); }
    const rows = all(`
      SELECT p.sku, p.name, COALESCE(c.name, 'Uncategorised') AS category, p.stock, p.cost_price,
             p.stock * p.cost_price AS cost_value, p.unit_price, p.stock * p.unit_price AS retail_value,
             p.stock * (p.unit_price - p.cost_price) AS potential_profit
      FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}
      ORDER BY cost_value DESC, p.name`, ...params);
    return {
      title: 'Inventory Valuation',
      subtitle: `${rows.length} products valued at cost and retail price`,
      columns: [
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'name', label: 'Product', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'stock', label: 'Stock', type: 'int' },
        { key: 'cost_price', label: 'Unit Cost', type: 'money' },
        { key: 'cost_value', label: 'Value (Cost)', type: 'money' },
        { key: 'unit_price', label: 'Unit Price', type: 'money' },
        { key: 'retail_value', label: 'Value (Retail)', type: 'money' },
        { key: 'potential_profit', label: 'Potential Profit', type: 'money' },
      ],
      rows,
      totals: {
        sku: 'Total', stock: sum(rows, 'stock'), cost_value: sum(rows, 'cost_value'),
        retail_value: sum(rows, 'retail_value'), potential_profit: sum(rows, 'potential_profit'),
      },
    };
  },

  movements(q) {
    const { clause, params } = movementFilters(q);
    const rows = all(`${MOVEMENT_SELECT} ${clause} ORDER BY m.created_at DESC, m.id DESC`, ...params)
      .map((m) => ({ ...m, total_value: Math.abs(m.quantity) * m.unit_value }));
    const qtyIn = rows.filter((r) => r.quantity > 0).reduce((a, r) => a + r.quantity, 0);
    const qtyOut = rows.filter((r) => r.quantity < 0).reduce((a, r) => a - r.quantity, 0);
    return {
      title: 'Stock Movement',
      subtitle: `${rangeLabel(q)} · ${rows.length} movements · ${qtyIn} units in, ${qtyOut} units out`,
      columns: [
        { key: 'created_at', label: 'Date', type: 'datetime' },
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'product_name', label: 'Product', type: 'text' },
        { key: 'type', label: 'Type', type: 'status' },
        { key: 'quantity', label: 'Qty', type: 'int' },
        { key: 'balance_after', label: 'Balance', type: 'int' },
        { key: 'unit_value', label: 'Unit Value', type: 'money' },
        { key: 'total_value', label: 'Total Value', type: 'money' },
        { key: 'reference', label: 'Reference', type: 'text' },
        { key: 'reason', label: 'Reason', type: 'text' },
      ],
      rows,
      totals: { created_at: 'Total', quantity: sum(rows, 'quantity'), total_value: sum(rows, 'total_value') },
    };
  },

  purchases(q) {
    const where = [];
    const params = [];
    if (q.supplier_id) { where.push('po.supplier_id = ?'); params.push(Number(q.supplier_id)); }
    if (q.status) { where.push('po.status = ?'); params.push(q.status); }
    if (q.from) { where.push('COALESCE(po.order_date, date(po.created_at)) >= ?'); params.push(q.from); }
    if (q.to) { where.push('COALESCE(po.order_date, date(po.created_at)) <= ?'); params.push(q.to); }
    const rows = all(`
      SELECT po.po_number, s.name AS supplier, po.status, po.order_date, po.expected_date, po.received_date,
             COUNT(i.id) AS lines, COALESCE(SUM(i.quantity), 0) AS units,
             COALESCE(SUM(i.quantity * i.unit_cost), 0) AS total,
             COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE po_id = po.id), 0) AS paid
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN purchase_order_items i ON i.po_id = po.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY po.id ORDER BY COALESCE(po.order_date, po.created_at) DESC`, ...params);
    const received = rows.filter((r) => r.status === 'received');
    return {
      title: 'Purchase Report',
      subtitle: `${rangeLabel(q)} · ${rows.length} orders · ${received.length} received`,
      columns: [
        { key: 'po_number', label: 'PO #', type: 'text' },
        { key: 'supplier', label: 'Supplier', type: 'text' },
        { key: 'status', label: 'Status', type: 'status' },
        { key: 'order_date', label: 'Ordered', type: 'date' },
        { key: 'expected_date', label: 'Expected', type: 'date' },
        { key: 'received_date', label: 'Received', type: 'date' },
        { key: 'lines', label: 'Lines', type: 'int' },
        { key: 'units', label: 'Units', type: 'int' },
        { key: 'total', label: 'Total', type: 'money' },
        { key: 'paid', label: 'Paid', type: 'money' },
      ],
      rows,
      totals: { po_number: 'Total', units: sum(rows, 'units'), total: sum(rows, 'total'), paid: sum(rows, 'paid') },
    };
  },

  'low-stock'() {
    // Suggested reorder brings stock back up to twice the minimum threshold.
    const rows = all(`
      SELECT p.sku, p.name, COALESCE(s.name, '—') AS supplier, p.stock, p.min_stock,
             p.min_stock - p.stock AS shortfall,
             MAX(p.min_stock * 2 - p.stock, 1) AS reorder_qty,
             p.cost_price, MAX(p.min_stock * 2 - p.stock, 1) * p.cost_price AS reorder_cost
      FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.stock <= p.min_stock
      ORDER BY (p.stock = 0) DESC, CAST(p.stock AS REAL) / MAX(p.min_stock, 1), p.name`);
    return {
      title: 'Low-Stock Report',
      subtitle: `${rows.length} products at or below their minimum stock level · ${rows.filter((r) => r.stock === 0).length} out of stock`,
      columns: [
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'name', label: 'Product', type: 'text' },
        { key: 'supplier', label: 'Supplier', type: 'text' },
        { key: 'stock', label: 'Stock', type: 'int' },
        { key: 'min_stock', label: 'Minimum', type: 'int' },
        { key: 'shortfall', label: 'Shortfall', type: 'int' },
        { key: 'reorder_qty', label: 'Suggested Reorder', type: 'int' },
        { key: 'cost_price', label: 'Unit Cost', type: 'money' },
        { key: 'reorder_cost', label: 'Reorder Cost', type: 'money' },
      ],
      rows,
      totals: { sku: 'Total', reorder_qty: sum(rows, 'reorder_qty'), reorder_cost: sum(rows, 'reorder_cost') },
    };
  },

  'supplier-performance'(q) {
    const params = [];
    let dateFilter = '';
    if (q.from) { dateFilter += ' AND COALESCE(po.order_date, date(po.created_at)) >= ?'; params.push(q.from); }
    if (q.to) { dateFilter += ' AND COALESCE(po.order_date, date(po.created_at)) <= ?'; params.push(q.to); }
    const rows = all(`
      WITH pos AS (
        SELECT po.*, COALESCE((SELECT SUM(quantity * unit_cost) FROM purchase_order_items WHERE po_id = po.id), 0) AS total
        FROM purchase_orders po WHERE 1=1 ${dateFilter}
      )
      SELECT s.name AS supplier,
             COUNT(po.id) AS orders,
             SUM(po.status = 'received') AS received,
             SUM(po.status IN ('draft', 'ordered')) AS open,
             SUM(po.status = 'cancelled') AS cancelled,
             COALESCE(SUM(CASE WHEN po.status = 'received' THEN po.total END), 0) AS total_spent,
             AVG(CASE WHEN po.status = 'received' AND po.order_date IS NOT NULL
                      THEN julianday(po.received_date) - julianday(po.order_date) END) AS avg_lead_days,
             100.0 * SUM(po.status = 'received' AND po.expected_date IS NOT NULL AND po.received_date <= po.expected_date)
                   / NULLIF(SUM(po.status = 'received' AND po.expected_date IS NOT NULL), 0) AS on_time_pct,
             100.0 * SUM(po.status = 'received') / NULLIF(SUM(po.status IN ('received', 'cancelled')), 0) AS fulfilment_pct,
             COALESCE((SELECT SUM(i.quantity * i.unit_cost) FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.po_id
                       WHERE o.supplier_id = s.id AND o.status = 'received'), 0)
               - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id), 0) AS outstanding
      FROM suppliers s LEFT JOIN pos AS po ON po.supplier_id = s.id
      GROUP BY s.id ORDER BY total_spent DESC, s.name`, ...params)
      .map((r) => ({ ...r, avg_lead_days: r.avg_lead_days == null ? null : Math.round(r.avg_lead_days * 10) / 10 }));
    return {
      title: 'Supplier Performance',
      subtitle: `${rangeLabel(q)} · on-time = received on or before the expected date · fulfilment = received ÷ (received + cancelled)`,
      columns: [
        { key: 'supplier', label: 'Supplier', type: 'text' },
        { key: 'orders', label: 'Orders', type: 'int' },
        { key: 'received', label: 'Received', type: 'int' },
        { key: 'open', label: 'Open', type: 'int' },
        { key: 'cancelled', label: 'Cancelled', type: 'int' },
        { key: 'total_spent', label: 'Total Spent', type: 'money' },
        { key: 'avg_lead_days', label: 'Avg Lead (days)', type: 'int' },
        { key: 'on_time_pct', label: 'On-Time', type: 'pct' },
        { key: 'fulfilment_pct', label: 'Fulfilment', type: 'pct' },
        { key: 'outstanding', label: 'Balance Owed (now)', type: 'money' },
      ],
      rows,
      totals: { supplier: 'Total', orders: sum(rows, 'orders'), total_spent: sum(rows, 'total_spent'), outstanding: sum(rows, 'outstanding') },
    };
  },
};

router.get('/:name', (req, res) => {
  const build = reports[req.params.name];
  if (!build) throw new HttpError(404, `Unknown report "${req.params.name}"`);
  const report = build(req.query);

  if (req.query.format === 'csv') {
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmt = (v, type) => (type === 'money' || type === 'pct') && v != null ? Number(v).toFixed(2) : v;
    const lines = [report.columns.map((c) => esc(c.label)).join(',')];
    for (const row of report.rows) lines.push(report.columns.map((c) => esc(fmt(row[c.key], c.type))).join(','));
    if (report.totals) lines.push(report.columns.map((c) => esc(fmt(report.totals[c.key], c.type))).join(','));
    const filename = `${req.params.name}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('﻿' + lines.join('\r\n'));
  }

  res.json(report);
});

export default router;
