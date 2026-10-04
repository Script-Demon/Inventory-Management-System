// PDF export via jsPDF + AutoTable (loaded as UMD globals in index.html).
import { fmt, statusLabel } from './ui.js';

export function formatCell(value, type) {
  if (value === null || value === undefined || value === '') return type === 'text' ? '' : '—';
  switch (type) {
    case 'money': return typeof value === 'number' ? fmt.money(value) : String(value);
    case 'int': return typeof value === 'number' ? fmt.int(value) : String(value);
    case 'pct': return typeof value === 'number' ? fmt.pct(value) : String(value);
    case 'date': return /^\d{4}-\d{2}-\d{2}/.test(value) ? fmt.date(value) : String(value);
    case 'datetime': return /^\d{4}-\d{2}-\d{2}/.test(value) ? fmt.datetime(value) : String(value);
    case 'status': return statusLabel(value);
    default: return String(value);
  }
}

const NUMERIC = new Set(['money', 'int', 'pct']);

function newDoc(landscape) {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
}

function header(doc, title, subtitle) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 40, 44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  if (subtitle) doc.text(doc.splitTextToSize(subtitle, doc.internal.pageSize.getWidth() - 80), 40, 60);
  doc.text(`Generated ${new Date().toLocaleString()} · StockKeeper Inventory`, 40, subtitle ? 74 : 60);
  doc.setTextColor(0);
  return subtitle ? 88 : 74;
}

function footer(doc) {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`Page ${i} of ${pages}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }
}

const tableStyles = {
  styles: { fontSize: 8, cellPadding: 4, lineColor: [225, 224, 217], lineWidth: 0.5 },
  headStyles: { fillColor: [42, 120, 214], textColor: 255, fontStyle: 'bold' },
  footStyles: { fillColor: [240, 239, 236], textColor: 20, fontStyle: 'bold' },
  alternateRowStyles: { fillColor: [249, 249, 247] },
  margin: { left: 40, right: 40 },
};

/** Generic report → PDF. Uses landscape for wide tables. */
export function reportToPdf(report, filename) {
  const doc = newDoc(report.columns.length > 6);
  const startY = header(doc, report.title, report.subtitle);
  const columnStyles = {};
  report.columns.forEach((c, i) => { if (NUMERIC.has(c.type)) columnStyles[i] = { halign: 'right' }; });
  doc.autoTable({
    ...tableStyles,
    startY,
    head: [report.columns.map((c) => c.label)],
    body: report.rows.map((r) => report.columns.map((c) => formatCell(r[c.key], c.type))),
    foot: report.totals ? [report.columns.map((c) => (report.totals[c.key] === undefined ? '' : formatCell(report.totals[c.key], c.type)))] : undefined,
    showFoot: 'lastPage',
    columnStyles,
  });
  footer(doc);
  doc.save(filename);
}

/** A printable purchase order document. */
export function purchaseOrderToPdf(po, supplier) {
  const doc = newDoc(false);
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('PURCHASE ORDER', 40, 50);
  doc.setFontSize(11);
  doc.text(po.po_number, w - 40, 50, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Status: ${statusLabel(po.status)}`, w - 40, 64, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.text('Supplier', 40, 90);
  doc.setFont('helvetica', 'normal');
  const supLines = [supplier.name, supplier.contact_person, ...(supplier.address || '').split('\n'), supplier.email, supplier.phone].filter(Boolean);
  doc.text(supLines, 40, 104);

  const meta = [
    ['Order date', fmt.date(po.order_date)],
    ['Expected', fmt.date(po.expected_date)],
    ['Received', fmt.date(po.received_date)],
    ['Payment terms', supplier.payment_terms || '—'],
  ];
  meta.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'bold'); doc.text(k, w - 200, 90 + i * 14);
    doc.setFont('helvetica', 'normal'); doc.text(v, w - 40, 90 + i * 14, { align: 'right' });
  });

  doc.autoTable({
    ...tableStyles,
    startY: Math.max(104 + supLines.length * 11, 150) + 10,
    head: [['#', 'SKU', 'Product', 'Qty', 'Unit cost', 'Line total']],
    body: po.items.map((it, i) => [i + 1, it.sku, it.product_name, `${fmt.int(it.quantity)} ${it.unit}`, fmt.money(it.unit_cost), fmt.money(it.line_total)]),
    foot: [['', '', 'Total', fmt.int(po.unit_count), '', fmt.money(po.total)]],
    columnStyles: { 0: { cellWidth: 24 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    styles: { ...tableStyles.styles, fontSize: 9 },
  });
  if (po.notes) {
    const y = doc.lastAutoTable.finalY + 24;
    doc.setFont('helvetica', 'bold'); doc.text('Notes', 40, y);
    doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(po.notes, w - 80), 40, y + 14);
  }
  footer(doc);
  doc.save(`${po.po_number}.pdf`);
}
