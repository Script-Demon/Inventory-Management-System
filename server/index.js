import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { UPLOAD_DIR, get } from './db.js';
import products from './routes/products.js';
import categories from './routes/categories.js';
import inventory from './routes/inventory.js';
import suppliers from './routes/suppliers.js';
import purchaseOrders from './routes/purchaseOrders.js';
import dashboard from './routes/dashboard.js';
import reports from './routes/reports.js';
import { seed } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

// First run: load demo data so the dashboard isn't empty. Set IMS_NO_SEED=1 to start blank.
if (!process.env.IMS_NO_SEED && get('SELECT COUNT(*) AS n FROM products').n === 0 && get('SELECT COUNT(*) AS n FROM suppliers').n === 0) {
  seed();
  console.log('Loaded demo data (run "npm run reset" to regenerate, or set IMS_NO_SEED=1 to start empty).');
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api/dashboard', dashboard);
app.use('/api/products', products);
app.use('/api/categories', categories);
app.use('/api/inventory', inventory);
app.use('/api/suppliers', suppliers);
app.use('/api/purchase-orders', purchaseOrders);
app.use('/api/reports', reports);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use('/vendor/chart.js', express.static(path.join(ROOT, 'node_modules/chart.js/dist')));
app.use('/vendor/jspdf', express.static(path.join(ROOT, 'node_modules/jspdf/dist')));
app.use('/vendor/jspdf-autotable', express.static(path.join(ROOT, 'node_modules/jspdf-autotable/dist')));
app.use(express.static(path.join(ROOT, 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'Something went wrong';
  if (err instanceof multer.MulterError) {
    status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Image must be 5 MB or smaller';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body is not valid JSON';
  } else if (/constraint failed/i.test(message)) {
    status = 409;
  }
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Inventory Management System running at http://localhost:${PORT}`);
});
