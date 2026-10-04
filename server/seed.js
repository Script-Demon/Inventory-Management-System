/*
 * Demo data: simulates a year of trading so the dashboard, charts and reports
 * have something realistic to show. Sales happen daily, products are reordered
 * from their supplier when they run low, orders arrive after the supplier's lead
 * time and get paid some weeks later.
 *
 *   npm run seed    – load demo data into an empty database
 *   npm run reset   – wipe everything and reload demo data
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, get, run, tx, applyStockChange, UPLOAD_DIR } from './db.js';

// Small deterministic PRNG so every reset produces the same data.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  ['Electronics', 'Devices, accessories and peripherals'],
  ['Office Supplies', 'Paper, writing and desk essentials'],
  ['Furniture', 'Desks, chairs and storage'],
  ['Packaging', 'Boxes, tape and shipping materials'],
  ['Cleaning', 'Janitorial and hygiene products'],
];

// name, contact, email, phone, address, terms, lead days, on-time reliability
const SUPPLIERS = [
  ['TechSource Distribution', 'Maya Chen', 'orders@techsource.example', '+1 415 555 0142', '220 Market St, San Francisco, CA', 'Net 30', 6, 0.9],
  ['OfficeHub Wholesale', 'Daniel Ortiz', 'sales@officehub.example', '+1 312 555 0187', '48 Wacker Dr, Chicago, IL', 'Net 15', 3, 0.95],
  ['Northwood Furniture Co.', 'Priya Nair', 'trade@northwood.example', '+1 503 555 0110', '9 Mill Rd, Portland, OR', 'Net 45', 14, 0.7],
  ['PackRight Supplies', 'Tom Becker', 'hello@packright.example', '+1 646 555 0199', '15 Dock St, Brooklyn, NY', 'Net 30', 4, 0.85],
  ['CleanPro Industrial', 'Aisha Rahman', 'accounts@cleanpro.example', '+1 713 555 0165', '700 Industrial Blvd, Houston, TX', 'Due on receipt', 5, 0.8],
];

// name, sku, category idx, supplier idx, unit, cost, price, min stock, avg daily sales
const PRODUCTS = [
  ['Wireless Mouse', 'ELC-1001', 0, 0, 'pcs', 8.5, 19.99, 25, 2.2],
  ['Mechanical Keyboard', 'ELC-1002', 0, 0, 'pcs', 42, 89.0, 10, 0.8],
  ['27" 4K Monitor', 'ELC-1003', 0, 0, 'pcs', 210, 349.0, 5, 0.35],
  ['USB-C Hub 7-in-1', 'ELC-1004', 0, 0, 'pcs', 14, 34.5, 20, 1.6],
  ['Noise-Cancelling Headset', 'ELC-1005', 0, 0, 'pcs', 55, 119.0, 8, 0.6],
  ['HD Webcam 1080p', 'ELC-1006', 0, 0, 'pcs', 22, 49.99, 12, 0.9],
  ['HDMI Cable 2m', 'ELC-1007', 0, 0, 'pcs', 2.1, 9.99, 40, 3.1],
  ['A4 Copy Paper (500 sheets)', 'OFF-2001', 1, 1, 'ream', 3.2, 6.49, 60, 6.5],
  ['Ballpoint Pens (Box of 50)', 'OFF-2002', 1, 1, 'box', 6.0, 12.99, 20, 1.4],
  ['Sticky Notes 3x3 (12-pack)', 'OFF-2003', 1, 1, 'pack', 4.4, 9.49, 25, 1.9],
  ['Lever Arch File', 'OFF-2004', 1, 1, 'pcs', 1.8, 4.25, 30, 2.4],
  ['Desk Stapler', 'OFF-2005', 1, 1, 'pcs', 5.5, 13.0, 10, 0.5],
  ['Whiteboard Markers (4-pack)', 'OFF-2006', 1, 1, 'pack', 3.0, 7.99, 20, 1.5],
  ['Ergonomic Office Chair', 'FUR-3001', 2, 2, 'pcs', 145, 279.0, 4, 0.25],
  ['Standing Desk 140cm', 'FUR-3002', 2, 2, 'pcs', 260, 499.0, 3, 0.15],
  ['3-Drawer Filing Cabinet', 'FUR-3003', 2, 2, 'pcs', 95, 189.0, 3, 0.12],
  ['Bookshelf 5-Tier', 'FUR-3004', 2, 2, 'pcs', 60, 129.0, 4, 0.18],
  ['Shipping Box Medium (25)', 'PKG-4001', 3, 3, 'bundle', 11, 24.0, 30, 2.6],
  ['Packing Tape 48mm (6 rolls)', 'PKG-4002', 3, 3, 'pack', 5.8, 12.5, 25, 2.0],
  ['Bubble Wrap Roll 50m', 'PKG-4003', 3, 3, 'roll', 9.5, 21.0, 10, 0.7],
  ['Thermal Shipping Labels (500)', 'PKG-4004', 3, 3, 'roll', 7.2, 15.99, 15, 1.1],
  ['All-Purpose Cleaner 5L', 'CLN-5001', 4, 4, 'bottle', 6.5, 14.0, 15, 1.0],
  ['Disinfectant Wipes (100)', 'CLN-5002', 4, 4, 'tub', 3.9, 8.99, 30, 2.3],
  ['Nitrile Gloves (Box of 100)', 'CLN-5003', 4, 4, 'box', 5.2, 11.5, 25, 1.7],
  ['Paper Towels (12 rolls)', 'CLN-5004', 4, 4, 'pack', 9.0, 18.99, 20, 1.3],
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export function reset() {
  tx(() => {
    for (const t of ['supplier_payments', 'stock_movements', 'purchase_order_items', 'purchase_orders', 'products', 'suppliers', 'categories']) {
      run(`DELETE FROM ${t}`);
    }
    run("DELETE FROM sqlite_sequence");
  });
  for (const f of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
}

export function seed() {
  const rand = rng(20261004);
  const poisson = (lambda) => {
    let L = Math.exp(-lambda), k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const stamp = (day) => {
    const h = 8 + Math.floor(rand() * 10), m = Math.floor(rand() * 60), s = Math.floor(rand() * 60);
    return `${iso(day)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  tx(() => {
    const catIds = CATEGORIES.map(([name, desc]) => Number(run('INSERT INTO categories (name, description) VALUES (?, ?)', name, desc).lastInsertRowid));
    const suppliers = SUPPLIERS.map(([name, contact, email, phone, address, terms, lead, reliability]) => ({
      id: Number(run(
        'INSERT INTO suppliers (name, contact_person, email, phone, address, payment_terms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        name, contact, email, phone, address, terms, iso(addDays(new Date(), -380))
      ).lastInsertRowid),
      lead, reliability,
    }));

    const start = addDays(new Date(new Date().toDateString()), -364);
    const products = PRODUCTS.map(([name, sku, cat, sup, unit, cost, price, min, demand], i) => {
      const id = Number(run(
        `INSERT INTO products (name, sku, barcode, category_id, supplier_id, unit, unit_price, cost_price, min_stock, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        name, sku, `0${String(890123400000 + i * 7919).slice(0, 12)}`, catIds[cat], suppliers[sup].id, unit, price, cost, min,
        `${name} — stocked item supplied by ${SUPPLIERS[sup][0]}.`, `${iso(start)} 08:00:00`
      ).lastInsertRowid);
      applyStockChange({ productId: id, type: 'in', delta: min * 3, unitValue: cost, reason: 'Opening stock', reference: 'OPENING', createdAt: `${iso(start)} 08:00:00` });
      return { id, sup, cost, price, min, demand, pending: false };
    });

    let poSeq = 0;
    const openPos = []; // { id, number, supplier, arrive, items }
    const toPay = []; // { supplierId, poId, amount, due }
    const today = new Date(new Date().toDateString());

    for (let day = new Date(start); day <= today; day = addDays(day, 1)) {
      const dow = day.getDay();
      const daysIn = Math.round((day - start) / 86400000);
      // Quieter weekends, gentle growth over the year and a Q4 bump.
      const factor = (dow === 0 || dow === 6 ? 0.35 : 1.1) * (0.8 + 0.4 * daysIn / 365) * (day.getMonth() >= 9 ? 1.25 : 1);

      // Deliveries arriving today.
      for (const po of openPos.filter((p) => p.arrive <= day && p.status === 'ordered')) {
        for (const it of po.items) {
          applyStockChange({ productId: it.product.id, type: 'in', delta: it.qty, unitValue: it.cost, reason: 'Purchase order received', reference: po.number, poId: po.id, createdAt: stamp(day) });
          run('UPDATE products SET cost_price = ? WHERE id = ?', it.cost, it.product.id);
          it.product.pending = false;
        }
        run("UPDATE purchase_orders SET status = 'received', received_date = ?, updated_at = ? WHERE id = ?", iso(day), `${iso(day)} 17:00:00`, po.id);
        po.status = 'received';
        toPay.push({ supplierId: suppliers[po.supplier].id, poId: po.id, amount: po.total, due: addDays(day, 10 + Math.floor(rand() * 35)) });
      }

      // Supplier payments.
      for (const p of toPay.filter((p) => !p.paid && p.due <= day)) {
        const partial = rand() < 0.15;
        const amount = Math.round(p.amount * (partial ? 0.5 : 1) * 100) / 100;
        run('INSERT INTO supplier_payments (supplier_id, po_id, amount, paid_on, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          p.supplierId, p.poId, amount, iso(day), pick(['Bank transfer', 'Bank transfer', 'Cheque', 'Card']), partial ? 'Part payment' : '', `${iso(day)} 12:00:00`);
        p.paid = true;
      }

      // Sales.
      for (const prod of products) {
        const stock = get('SELECT stock FROM products WHERE id = ?', prod.id).stock;
        const qty = Math.min(stock, poisson(prod.demand * factor));
        if (qty > 0) {
          applyStockChange({ productId: prod.id, type: 'out', delta: -qty, unitValue: prod.price, reason: 'Sale', reference: `SO-${iso(day).replace(/-/g, '')}`, createdAt: stamp(day) });
        }
      }

      // Occasional damage / count corrections.
      if (rand() < 0.04) {
        const prod = pick(products);
        const stock = get('SELECT stock FROM products WHERE id = ?', prod.id).stock;
        const delta = rand() < 0.7 ? -Math.min(stock, 1 + Math.floor(rand() * 3)) : 1 + Math.floor(rand() * 2);
        if (delta !== 0) {
          applyStockChange({ productId: prod.id, type: 'adjustment', delta, unitValue: prod.cost,
            reason: delta < 0 ? pick(['Damaged in warehouse', 'Cycle count correction', 'Expired / unsellable']) : 'Cycle count correction',
            reference: `ADJ-${iso(day).replace(/-/g, '')}`, createdAt: stamp(day) });
        }
      }

      // Weekly reorder run on Mondays (stop a few days before today so some orders are still open).
      if (dow === 1) {
        for (const [si, sup] of suppliers.entries()) {
          const needs = products.filter((p) => p.sup === si && !p.pending && get('SELECT stock FROM products WHERE id = ?', p.id).stock <= p.min * 1.6);
          if (!needs.length || (daysIn > 355 && si === 1)) continue;
          poSeq++;
          const number = `PO-${day.getFullYear()}-${String(poSeq).padStart(4, '0')}`;
          const lead = sup.lead;
          const late = rand() > sup.reliability ? 1 + Math.floor(rand() * 5) : -Math.floor(rand() * 2);
          const expected = addDays(day, lead);
          const items = needs.map((p) => ({
            product: p,
            qty: Math.max(p.min * 3 - get('SELECT stock FROM products WHERE id = ?', p.id).stock, p.min),
            cost: Math.round(p.cost * (0.97 + rand() * 0.08) * 100) / 100,
          }));
          const total = items.reduce((a, it) => a + it.qty * it.cost, 0);
          const id = Number(run(
            "INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, expected_date, notes, created_at, updated_at) VALUES (?, ?, 'ordered', ?, ?, ?, ?, ?)",
            number, sup.id, iso(day), iso(expected), 'Weekly replenishment', `${iso(day)} 09:00:00`, `${iso(day)} 09:00:00`
          ).lastInsertRowid);
          for (const it of items) {
            run('INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', id, it.product.id, it.qty, it.cost);
            it.product.pending = true;
          }
          openPos.push({ id, number, supplier: si, arrive: addDays(expected, late), items, total, status: 'ordered' });
        }
      }
    }

    // A couple of extra orders in other states so every status shows up.
    const mkPo = (status, supIdx, daysAgo, lines, notes) => {
      poSeq++;
      const d = addDays(today, -daysAgo);
      const id = Number(run(
        'INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, expected_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        `PO-${d.getFullYear()}-${String(poSeq).padStart(4, '0')}`, suppliers[supIdx].id, status,
        status === 'draft' ? null : iso(d), iso(addDays(d, suppliers[supIdx].lead + 3)), notes, `${iso(d)} 10:00:00`, `${iso(d)} 10:00:00`
      ).lastInsertRowid);
      for (const [pi, qty] of lines) run('INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', id, products[pi].id, qty, products[pi].cost);
    };
    mkPo('draft', 0, 1, [[2, 6], [4, 10]], 'Restock for new office fit-out — awaiting budget approval');
    mkPo('draft', 3, 0, [[19, 15], [20, 20]], '');
    mkPo('cancelled', 2, 40, [[14, 4]], 'Cancelled — supplier price increase');
    mkPo('ordered', 2, 5, [[13, 8], [16, 6]], 'Q4 furniture restock');
    mkPo('ordered', 4, 2, [[22, 60], [24, 30]], 'Urgent — wipes running low');

    // Make sure a few items are visibly short so low-stock alerts have something to show.
    for (const [pi, reason] of [[1, 'Damaged in warehouse'], [11, 'Cycle count correction'], [22, 'Expired / unsellable']]) {
      const p = get('SELECT id, stock, min_stock, cost_price FROM products WHERE id = ?', products[pi].id);
      const target = Math.floor(p.min_stock / 3);
      if (p.stock > target) {
        applyStockChange({ productId: p.id, type: 'adjustment', delta: target - p.stock, unitValue: p.cost_price, reason, reference: 'ADJ-COUNT', createdAt: stamp(today) });
      }
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const hasData = get('SELECT COUNT(*) AS n FROM products').n > 0;
  if (process.argv.includes('--reset')) {
    reset();
  } else if (hasData) {
    console.log('Database already has data. Use "npm run reset" to wipe it and reload the demo data.');
    process.exit(0);
  }
  const t = Date.now();
  seed();
  const counts = Object.fromEntries(['products', 'suppliers', 'purchase_orders', 'stock_movements', 'supplier_payments']
    .map((t) => [t, get(`SELECT COUNT(*) AS n FROM ${t}`).n]));
  console.log(`Demo data loaded in ${Date.now() - t} ms`, counts);
  db.close();
}
