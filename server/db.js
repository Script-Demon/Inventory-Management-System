import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const DB_PATH = process.env.IMS_DB || path.join(DATA_DIR, 'inventory.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  email          TEXT DEFAULT '',
  phone          TEXT DEFAULT '',
  address        TEXT DEFAULT '',
  payment_terms  TEXT DEFAULT '',
  notes          TEXT DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  sku         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  barcode     TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  description TEXT DEFAULT '',
  unit        TEXT DEFAULT 'pcs',
  unit_price  REAL NOT NULL DEFAULT 0,
  cost_price  REAL NOT NULL DEFAULT 0,
  stock       INTEGER NOT NULL DEFAULT 0,
  min_stock   INTEGER NOT NULL DEFAULT 0,
  image       TEXT DEFAULT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- Every change to products.stock is recorded here. quantity is the signed change.
CREATE TABLE IF NOT EXISTS stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('in','out','adjustment')),
  quantity      INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  unit_value    REAL NOT NULL DEFAULT 0,
  reason        TEXT DEFAULT '',
  reference     TEXT DEFAULT '',
  po_id         INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(created_at);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number     TEXT NOT NULL UNIQUE,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','cancelled')),
  order_date    TEXT,
  expected_date TEXT,
  received_date TEXT,
  notes         TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id      INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost  REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  po_id       INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
  amount      REAL NOT NULL CHECK (amount > 0),
  paid_on     TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  method      TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`);

/** Run fn inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * The single place stock levels change. Applies a signed delta to a product,
 * refuses to go negative, and writes the movement record.
 * Must be called inside tx().
 */
export function applyStockChange({ productId, type, delta, unitValue, reason = '', reference = '', poId = null, createdAt = null }) {
  const product = get('SELECT id, name, stock, cost_price, unit_price FROM products WHERE id = ?', productId);
  if (!product) throw new HttpError(404, `Product ${productId} not found`);
  delta = Math.trunc(Number(delta));
  if (!Number.isFinite(delta)) throw new HttpError(400, 'Quantity must be a number');
  const balance = product.stock + delta;
  if (balance < 0) {
    throw new HttpError(400, `Insufficient stock for "${product.name}": ${product.stock} available, ${-delta} requested`);
  }
  if (unitValue == null) unitValue = type === 'out' ? product.unit_price : product.cost_price;
  run("UPDATE products SET stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?", balance, productId);
  const info = run(
    `INSERT INTO stock_movements (product_id, type, quantity, balance_after, unit_value, reason, reference, po_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', 'localtime')))`,
    productId, type, delta, balance, Number(unitValue) || 0, reason, reference, poId, createdAt
  );
  return { id: Number(info.lastInsertRowid), balance_after: balance };
}
