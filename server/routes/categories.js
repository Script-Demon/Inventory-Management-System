import { Router } from 'express';
import { all, get, run, HttpError } from '../db.js';

const router = Router();

const CATEGORY_SELECT = `
  SELECT c.*, COUNT(p.id) AS product_count, COALESCE(SUM(p.stock * p.cost_price), 0) AS stock_value
  FROM categories c LEFT JOIN products p ON p.category_id = c.id`;

function readName(body, exceptId = 0) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Category name is required');
  if (get('SELECT 1 FROM categories WHERE name = ? AND id != ?', name, exceptId)) throw new HttpError(409, `Category "${name}" already exists`);
  return name;
}

router.get('/', (_req, res) => res.json(all(`${CATEGORY_SELECT} GROUP BY c.id ORDER BY c.name COLLATE NOCASE`)));

router.post('/', (req, res) => {
  const info = run('INSERT INTO categories (name, description) VALUES (?, ?)', readName(req.body), String(req.body.description ?? ''));
  res.status(201).json(get(`${CATEGORY_SELECT} WHERE c.id = ? GROUP BY c.id`, Number(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT 1 FROM categories WHERE id = ?', id)) throw new HttpError(404, 'Category not found');
  run('UPDATE categories SET name = ?, description = ? WHERE id = ?', readName(req.body, id), String(req.body.description ?? ''), id);
  res.json(get(`${CATEGORY_SELECT} WHERE c.id = ? GROUP BY c.id`, id));
});

// Products in a deleted category become uncategorised (ON DELETE SET NULL).
router.delete('/:id', (req, res) => {
  const info = run('DELETE FROM categories WHERE id = ?', Number(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Category not found');
  res.status(204).end();
});

export default router;
