/**
 * PropertyLens Export Utilities
 * Generates CSV, PDF, Excel, and Tax Package ZIP exports.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { formatMoney, formatDate } from './format';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvEscape).join(',');
}

function money(n) {
  const v = parseFloat(n) || 0;
  return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(num, denom) {
  if (!denom || denom === 0) return '0%';
  return (Math.abs(num / denom) * 100).toFixed(1) + '%';
}

function getYearRange(year) {
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

function generatedStr() {
  return formatDate(new Date(), 'header');
}

/** Group transactions by category → { category: { count, total, type } } */
function categoryBreakdown(transactions) {
  const map = {};
  for (const tx of transactions) {
    const cat = tx.category || 'Uncategorized';
    if (!map[cat]) map[cat] = { count: 0, total: 0, type: tx.type };
    map[cat].count++;
    map[cat].total += Math.abs(parseFloat(tx.amount) || 0);
    if (tx.type === 'income') map[cat].type = 'income';
  }
  return Object.entries(map)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([category, v]) => ({ category, ...v }));
}

/** Month-by-month totals → [{ month, income, expenses, net }] sorted ascending */
function monthlyTrends(transactions) {
  const map = {};
  for (const tx of transactions) {
    const m = (tx.date || '').substring(0, 7);
    if (!m) continue;
    if (!map[m]) map[m] = { income: 0, expenses: 0 };
    if (tx.type === 'income') map[m].income += parseFloat(tx.amount) || 0;
    else map[m].expenses += Math.abs(parseFloat(tx.amount) || 0);
  }
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, net: v.income - v.expenses }));
}

/** Tenant payment summary for the period */
function tenantPayments(tenants, transactions, year) {
  return tenants.map(t => {
    const payments = transactions.filter(tx =>
      tx.tenant_id === t.id && tx.type === 'income'
    );
    const collected = payments.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);
    const expected = parseFloat(t.monthly_rent) * 12;
    return {
      name: t.name,
      property: t.property_name || '—',
      unit: t.unit || '—',
      monthly_rent: parseFloat(t.monthly_rent),
      expected,
      collected,
      variance: collected - expected,
      payments: payments.length,
    };
  });
}

// ─── Schedule E category mapping ─────────────────────────────────────────────

const SCHEDULE_E_MAP = {
  Insurance:              'Insurance',
  'Property Tax':         'Taxes',
  Repairs:                'Repairs',
  Maintenance:            'Cleaning and Maintenance',
  Utilities:              'Utilities',
  Landscaping:            'Cleaning and Maintenance',
  HOA:                    'Other Expenses',
  Mortgage:               'Mortgage Interest',
  Legal:                  'Legal & Professional Fees',
  'Professional Services':'Legal & Professional Fees',
  Software:               'Other Expenses',
  Advertising:            'Advertising',
  Other:                  'Other Expenses',
  'Other Income':         null, // income, skip
  rent:                   null, // income, skip
};

const SCHEDULE_E_COLS = [
  'Advertising', 'Auto and Travel', 'Cleaning and Maintenance',
  'Commissions', 'Insurance', 'Legal & Professional Fees',
  'Management Fees', 'Mortgage Interest', 'Other Interest',
  'Repairs', 'Supplies', 'Taxes', 'Utilities',
  'Depreciation', 'Other Expenses',
];

// ═════════════════════════════════════════════════════════════════════════════
//  CSV EXPORT
// ═════════════════════════════════════════════════════════════════════════════

export function buildCSV({ plData, transactions, tenants, year }) {
  const { properties, portfolio_expenses, allocation_method } = plData;
  const totalIncome   = properties.reduce((s, p) => s + p.income, 0);
  const totalSpecific = properties.reduce((s, p) => s + p.specific_expenses, 0);
  const totalNet      = properties.reduce((s, p) => s + p.net, 0);
  const lines = [];

  // ── Section 1: Summary
  lines.push('SECTION 1 — SUMMARY');
  lines.push(csvRow(['Report Period', year]));
  lines.push(csvRow(['Generated', generatedStr()]));
  lines.push(csvRow(['Total Income', money(totalIncome)]));
  lines.push(csvRow(['Property Expenses', money(totalSpecific)]));
  lines.push(csvRow(['Portfolio Expenses', money(portfolio_expenses)]));
  lines.push(csvRow(['Net Income', money(totalNet)]));
  lines.push(csvRow(['Allocation Method', allocation_method]));
  lines.push('');

  // ── Section 2: Per-Property P&L
  lines.push('SECTION 2 — PER-PROPERTY P&L');
  const hasPfol = allocation_method !== 'unallocated';
  const hdr = ['Property', 'Income', 'Property Expenses'];
  if (hasPfol) hdr.push('Portfolio Allocated');
  hdr.push('Net', 'Margin %', 'Tenants');
  lines.push(csvRow(hdr));
  for (const p of properties) {
    const row = [p.name, money(p.income), money(p.specific_expenses)];
    if (hasPfol) row.push(money(p.portfolio_allocated));
    const margin = p.income > 0 ? ((p.net / p.income) * 100).toFixed(1) + '%' : 'N/A';
    row.push(money(p.net), margin, p.tenant_count);
    lines.push(csvRow(row));
  }
  // Totals row
  const totRow = ['TOTAL', money(totalIncome), money(totalSpecific)];
  if (hasPfol) totRow.push(money(portfolio_expenses));
  const totalMargin = totalIncome > 0 ? ((totalNet / totalIncome) * 100).toFixed(1) + '%' : 'N/A';
  totRow.push(money(totalNet), totalMargin, '');
  lines.push(csvRow(totRow));
  lines.push('');

  // ── Section 3: All Transactions
  lines.push('SECTION 3 — ALL TRANSACTIONS');
  lines.push(csvRow(['Date', 'Description', 'Amount', 'Type', 'Category', 'Property', 'Tenant', 'Rent Month']));
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  for (const tx of sorted) {
    lines.push(csvRow([
      tx.date,
      tx.display_description || tx.description,
      (parseFloat(tx.amount) || 0).toFixed(2),
      tx.type,
      tx.category || '',
      tx.property_scope === 'portfolio' ? 'All Properties (Portfolio)' : (tx.property_name || ''),
      tx.tenant_name || '',
      tx.rent_month || '',
    ]));
  }
  lines.push('');

  // ── Section 4: Category Breakdown
  lines.push('SECTION 4 — CATEGORY BREAKDOWN');
  lines.push(csvRow(['Category', 'Type', 'Transaction Count', 'Total Amount', '% of Type Total']));
  const cats = categoryBreakdown(transactions);
  const incomeTotal   = cats.filter(c => c.type === 'income').reduce((s, c) => s + c.total, 0);
  const expenseTotal  = cats.filter(c => c.type !== 'income').reduce((s, c) => s + c.total, 0);
  for (const c of cats) {
    const typeTotal = c.type === 'income' ? incomeTotal : expenseTotal;
    lines.push(csvRow([c.category, c.type, c.count, money(c.total), pct(c.total, typeTotal)]));
  }
  lines.push('');

  // ── Section 5: Tenant Payment History
  lines.push('SECTION 5 — TENANT PAYMENT HISTORY');
  lines.push(csvRow(['Tenant', 'Property', 'Unit', 'Monthly Rent', 'Expected (12 mo)', 'Collected', 'Variance', '# Payments']));
  for (const t of tenantPayments(tenants, transactions, year)) {
    lines.push(csvRow([
      t.name, t.property, t.unit,
      money(t.monthly_rent), money(t.expected),
      money(t.collected), money(t.variance),
      t.payments,
    ]));
  }

  return lines.join('\n');
}

export function downloadCSV({ plData, transactions, tenants, year }) {
  const csv = buildCSV({ plData, transactions, tenants, year });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `PropertyLens_${year}_Full_Report.csv`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  PDF EXPORT
// ═════════════════════════════════════════════════════════════════════════════

const PDF_FONT  = 'helvetica';
const PDF_BLACK = [0, 0, 0];
const PDF_GRAY  = [100, 100, 100];
const PDF_LGRAY = [200, 200, 200];
const PDF_FGRAY = [245, 245, 245];
const PDF_RED   = [227, 6, 19];
const PDF_MARGIN = 50;

function addPDFFooters(doc, year) {
  const totalPages = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_GRAY);
    doc.setDrawColor(...PDF_LGRAY);
    doc.line(PDF_MARGIN, H - 32, W - PDF_MARGIN, H - 32);
    doc.text(
      `PropertyLens  |  Page ${i} of ${totalPages}  |  Generated ${generatedStr()}`,
      W / 2, H - 20, { align: 'center' }
    );
  }
}

function pdfSectionTitle(doc, text, y) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_GRAY);
  doc.setFillColor(...PDF_FGRAY);
  doc.rect(PDF_MARGIN, y - 12, W - PDF_MARGIN * 2, 16, 'F');
  doc.text(text.toUpperCase(), PDF_MARGIN + 6, y);
  return y + 14;
}

export function buildPDF({ plData, transactions, tenants, year }) {
  const { properties, portfolio_expenses, allocation_method } = plData;
  const totalIncome   = properties.reduce((s, p) => s + p.income, 0);
  const totalSpecific = properties.reduce((s, p) => s + p.specific_expenses, 0);
  const totalNet      = properties.reduce((s, p) => s + p.net, 0);
  const hasPfol       = allocation_method !== 'unallocated';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();

  // ── PAGE 1: Cover / Summary ───────────────────────────────────────────────

  // Brand header bar
  doc.setFillColor(...PDF_BLACK);
  doc.rect(0, 0, W, 60, 'F');
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.setCharSpace(3);
  doc.text('PROPERTYLENS', PDF_MARGIN, 38);
  doc.setCharSpace(0);

  // Title
  let y = 100;
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...PDF_BLACK);
  doc.text(`Annual Report ${year}`, PDF_MARGIN, y);

  y += 18;
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...PDF_GRAY);
  doc.text(`Tax Year ${year}  ·  Generated ${generatedStr()}`, PDF_MARGIN, y);

  // Divider
  y += 28;
  doc.setDrawColor(...PDF_LGRAY);
  doc.line(PDF_MARGIN, y, W - PDF_MARGIN, y);

  // Summary stat boxes (2×2 grid)
  y += 24;
  const statItems = [
    { label: 'Total Income',       value: money(totalIncome),                  neg: false },
    { label: 'Total Expenses',     value: money(totalSpecific + portfolio_expenses), neg: true },
    { label: 'Net Income',         value: money(totalNet),                     neg: totalNet < 0 },
    { label: 'Properties',         value: String(properties.length),           neg: false },
    { label: 'Tenants',            value: String(tenants.length),              neg: false },
    { label: 'Transactions',       value: String(transactions.length),         neg: false },
  ];
  const boxW = (W - PDF_MARGIN * 2 - 16) / 3;
  const boxH = 64;
  const boxGap = 8;
  statItems.forEach((item, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const bx = PDF_MARGIN + col * (boxW + boxGap);
    const by = y + row * (boxH + boxGap);
    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(...PDF_LGRAY);
    doc.roundedRect(bx, by, boxW, boxH, 2, 2, 'FD');
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_GRAY);
    doc.text(item.label.toUpperCase(), bx + 10, by + 18);
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(20);
    doc.setTextColor(item.neg && totalNet < 0 && item.label === 'Net Income' ? PDF_RED[0] : PDF_BLACK[0],
                     item.neg && totalNet < 0 && item.label === 'Net Income' ? PDF_RED[1] : PDF_BLACK[1],
                     item.neg && totalNet < 0 && item.label === 'Net Income' ? PDF_RED[2] : PDF_BLACK[2]);
    doc.text(item.value, bx + 10, by + 46);
  });

  // ── PAGE 2: Per-Property P&L ──────────────────────────────────────────────

  doc.addPage();
  y = PDF_MARGIN;
  y = pdfSectionTitle(doc, `Per-Property Performance — ${year}`, y + 12);
  y += 8;

  const propCols = ['Property', 'Income', 'Expenses'];
  if (hasPfol) propCols.push('Portfolio Alloc.');
  propCols.push('Net', 'Margin %', 'Tenants');

  const propBody = properties.map(p => {
    const row = [p.name, money(p.income), money(p.specific_expenses)];
    if (hasPfol) row.push(money(p.portfolio_allocated));
    row.push(money(p.net), pct(p.net, p.income), String(p.tenant_count));
    return row;
  });
  const propTotal = ['TOTAL', money(totalIncome), money(totalSpecific)];
  if (hasPfol) propTotal.push(money(portfolio_expenses));
  propTotal.push(money(totalNet), pct(totalNet, totalIncome), '');

  autoTable(doc, {
    startY: y,
    head: [propCols],
    body: propBody,
    foot: [propTotal],
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    styles: { font: PDF_FONT, fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: PDF_BLACK, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [240, 240, 240], textColor: PDF_BLACK, fontStyle: 'bold', fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', fontStyle: 'normal' },
      2: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });

  // ── PAGE 3: Category Breakdown ────────────────────────────────────────────

  doc.addPage();
  y = PDF_MARGIN;
  y = pdfSectionTitle(doc, `Expense & Income Category Breakdown — ${year}`, y + 12);
  y += 8;

  const cats = categoryBreakdown(transactions);
  const incTotal = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);
  const expTotal = transactions.filter(t => t.type !== 'income').reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);

  autoTable(doc, {
    startY: y,
    head: [['Category', 'Type', '# Transactions', 'Total', '% of Type']],
    body: cats.map(c => [
      c.category,
      c.type,
      String(c.count),
      money(c.total),
      pct(c.total, c.type === 'income' ? incTotal : expTotal),
    ]),
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    styles: { font: PDF_FONT, fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: PDF_BLACK, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 1) {
        data.cell.styles.textColor = data.cell.raw === 'income' ? [0, 120, 0] : [180, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // ── PAGE 4: Tenant Payment History ───────────────────────────────────────

  doc.addPage();
  y = PDF_MARGIN;
  y = pdfSectionTitle(doc, `Tenant Payment History — ${year}`, y + 12);
  y += 8;

  const tp = tenantPayments(tenants, transactions, year);

  autoTable(doc, {
    startY: y,
    head: [['Tenant', 'Property', 'Unit', 'Monthly Rent', 'Expected', 'Collected', 'Variance', '# Payments']],
    body: tp.map(t => [
      t.name, t.property, t.unit,
      money(t.monthly_rent), money(t.expected),
      money(t.collected), money(t.variance),
      String(t.payments),
    ]),
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    styles: { font: PDF_FONT, fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: PDF_BLACK, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      3: { halign: 'right' }, 4: { halign: 'right' },
      5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 6) {
        const v = parseFloat(tp[data.row.index]?.variance) || 0;
        data.cell.styles.textColor = v < 0 ? PDF_RED : PDF_BLACK;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // ── PAGE 5+: Transaction Ledger ───────────────────────────────────────────

  doc.addPage();
  y = PDF_MARGIN;
  y = pdfSectionTitle(doc, `Transaction Ledger — ${year} (${transactions.length} transactions)`, y + 12);
  y += 8;

  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Description', 'Amount', 'Type', 'Category', 'Property', 'Tenant']],
    body: sorted.map(tx => [
      tx.date,
      (tx.display_description || tx.description || '').substring(0, 48),
      money(Math.abs(parseFloat(tx.amount) || 0)),
      tx.type || '',
      tx.category || '',
      tx.property_scope === 'portfolio' ? 'Portfolio' : (tx.property_name || '—'),
      tx.tenant_name || '—',
    ]),
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    styles: { font: PDF_FONT, fontSize: 8, cellPadding: 4, overflow: 'ellipsize' },
    headStyles: { fillColor: PDF_BLACK, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 70 },
      3: { cellWidth: 48 },
      4: { cellWidth: 80 },
      5: { cellWidth: 90 },
      6: { cellWidth: 80 },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    showHead: 'everyPage',
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 3) {
        data.cell.styles.textColor = data.cell.raw === 'income' ? [0, 120, 0] : [180, 0, 0];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Footers on all pages
  addPDFFooters(doc, year);

  return doc.output('blob');
}

export function downloadPDF({ plData, transactions, tenants, year }) {
  const blob = buildPDF({ plData, transactions, tenants, year });
  saveAs(blob, `PropertyLens_${year}_Report.pdf`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXCEL EXPORT (SheetJS)
// ═════════════════════════════════════════════════════════════════════════════

const XL_HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '000000' } },
  alignment: { horizontal: 'center' },
  border: { bottom: { style: 'thin', color: { rgb: '888888' } } },
};

const XL_TOTAL_STYLE = {
  font: { bold: true },
  fill: { fgColor: { rgb: 'F0F0F0' } },
};

function xlMakeCurrency(ws, col, startRow, endRow) {
  for (let r = startRow; r <= endRow; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
    if (cell) {
      cell.t = 'n';
      cell.z = '$#,##0.00';
    }
  }
}

function xlAutoWidth(ws, data) {
  const cols = [];
  if (!data || data.length === 0) return;
  const colCount = data[0].length;
  for (let c = 0; c < colCount; c++) {
    let maxLen = 10;
    for (const row of data) {
      const val = row[c] == null ? '' : String(row[c]);
      maxLen = Math.max(maxLen, val.length + 2);
    }
    cols.push({ wch: Math.min(maxLen, 40) });
  }
  ws['!cols'] = cols;
}

export function buildExcel({ plData, transactions, tenants, year }) {
  const { properties, portfolio_expenses, allocation_method } = plData;
  const totalIncome   = properties.reduce((s, p) => s + p.income, 0);
  const totalSpecific = properties.reduce((s, p) => s + p.specific_expenses, 0);
  const totalNet      = properties.reduce((s, p) => s + p.net, 0);
  const hasPfol       = allocation_method !== 'unallocated';
  const wb            = XLSX.utils.book_new();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────

  const summaryData = [
    [`PropertyLens Annual Report — ${year}`],
    [`Generated: ${generatedStr()}`],
    [],
    ['Metric', 'Amount'],
    ['Total Income', totalIncome],
    ['Property Expenses', totalSpecific],
    ['Portfolio Expenses', portfolio_expenses],
    ['Total Expenses', totalSpecific + portfolio_expenses],
    ['Net Income', totalNet],
    [],
    ['Properties', properties.length],
    ['Tenants', tenants.length],
    ['Transactions', transactions.length],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  xlAutoWidth(ws1, summaryData);
  xlMakeCurrency(ws1, 1, 3, 8); // rows 4-9 (0-indexed: 3-8)
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  // ── Sheet 2: Per-Property P&L ─────────────────────────────────────────────

  const propHeaders = ['Property', 'Income', 'Property Expenses'];
  if (hasPfol) propHeaders.push('Portfolio Allocated');
  propHeaders.push('Net', 'Margin %', 'Tenants');

  const propRows = properties.map(p => {
    const row = [p.name, p.income, p.specific_expenses];
    if (hasPfol) row.push(p.portfolio_allocated);
    row.push(p.net, p.income > 0 ? p.net / p.income : 0, p.tenant_count);
    return row;
  });
  const totRow2 = ['TOTAL', totalIncome, totalSpecific];
  if (hasPfol) totRow2.push(portfolio_expenses);
  totRow2.push(totalNet, totalIncome > 0 ? totalNet / totalIncome : 0, '');
  propRows.push(totRow2);

  const ws2 = XLSX.utils.aoa_to_sheet([propHeaders, ...propRows]);
  xlAutoWidth(ws2, [propHeaders, ...propRows]);
  // Currency columns: Income=1, Expenses=2, Portfolio=3(if hasPfol), Net
  const netCol2 = hasPfol ? 4 : 3;
  xlMakeCurrency(ws2, 1, 1, propRows.length);
  xlMakeCurrency(ws2, 2, 1, propRows.length);
  if (hasPfol) xlMakeCurrency(ws2, 3, 1, propRows.length);
  xlMakeCurrency(ws2, netCol2, 1, propRows.length);
  // Percent format for margin column
  const pctCol2 = netCol2 + 1;
  for (let r = 1; r <= propRows.length; r++) {
    const cell = ws2[XLSX.utils.encode_cell({ r, c: pctCol2 })];
    if (cell) { cell.t = 'n'; cell.z = '0.0%'; }
  }
  // Freeze header
  ws2['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws2, 'Per-Property P&L');

  // ── Sheet 3: Transactions ─────────────────────────────────────────────────

  const txHeaders = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Property', 'Tenant', 'Rent Month'];
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const txRows = sorted.map(tx => [
    tx.date,
    tx.display_description || tx.description || '',
    Math.abs(parseFloat(tx.amount) || 0),
    tx.type || '',
    tx.category || '',
    tx.property_scope === 'portfolio' ? 'All Properties (Portfolio)' : (tx.property_name || ''),
    tx.tenant_name || '',
    tx.rent_month || '',
  ]);

  const ws3 = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows]);
  xlAutoWidth(ws3, [txHeaders, ...txRows]);
  xlMakeCurrency(ws3, 2, 1, txRows.length); // Amount column
  ws3['!freeze'] = { xSplit: 0, ySplit: 1 };
  // Auto-filter
  ws3['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: txRows.length, c: txHeaders.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws3, 'Transactions');

  // ── Sheet 4: Category Breakdown ───────────────────────────────────────────

  const cats = categoryBreakdown(transactions);
  const catHeaders = ['Category', 'Type', 'Transaction Count', 'Total Amount', '% of Type Total'];
  const incTotal = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);
  const expTotal = transactions.filter(t => t.type !== 'income').reduce((s, t) => s + Math.abs(parseFloat(t.amount) || 0), 0);
  const catRows = cats.map(c => [
    c.category,
    c.type,
    c.count,
    c.total,
    c.type === 'income' ? (incTotal > 0 ? c.total / incTotal : 0) : (expTotal > 0 ? c.total / expTotal : 0),
  ]);

  const ws4 = XLSX.utils.aoa_to_sheet([catHeaders, ...catRows]);
  xlAutoWidth(ws4, [catHeaders, ...catRows]);
  xlMakeCurrency(ws4, 3, 1, catRows.length);
  for (let r = 1; r <= catRows.length; r++) {
    const cell = ws4[XLSX.utils.encode_cell({ r, c: 4 })];
    if (cell) { cell.t = 'n'; cell.z = '0.0%'; }
  }
  ws4['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws4, 'Category Breakdown');

  // ── Sheet 5: Tenant Payments ──────────────────────────────────────────────

  const tpHeaders = ['Tenant', 'Property', 'Unit', 'Monthly Rent', 'Expected (12 mo)', 'Collected', 'Variance', '# Payments'];
  const tp = tenantPayments(tenants, transactions, year);
  const tpRows = tp.map(t => [t.name, t.property, t.unit, t.monthly_rent, t.expected, t.collected, t.variance, t.payments]);

  const ws5 = XLSX.utils.aoa_to_sheet([tpHeaders, ...tpRows]);
  xlAutoWidth(ws5, [tpHeaders, ...tpRows]);
  [3, 4, 5, 6].forEach(c => xlMakeCurrency(ws5, c, 1, tpRows.length));
  ws5['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws5, 'Tenant Payments');

  // ── Sheet 6: Monthly Trends ───────────────────────────────────────────────

  const trends = monthlyTrends(transactions);
  const trendHeaders = ['Month', 'Income', 'Expenses', 'Net'];
  const trendRows = trends.map(t => [t.month, t.income, t.expenses, t.net]);

  const ws6 = XLSX.utils.aoa_to_sheet([trendHeaders, ...trendRows]);
  xlAutoWidth(ws6, [trendHeaders, ...trendRows]);
  [1, 2, 3].forEach(c => xlMakeCurrency(ws6, c, 1, trendRows.length));
  ws6['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws6, 'Monthly Trends');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

export function downloadExcel({ plData, transactions, tenants, year }) {
  const buf = buildExcel({ plData, transactions, tenants, year });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `PropertyLens_${year}_Report.xlsx`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TAX PACKAGE (ZIP)
// ═════════════════════════════════════════════════════════════════════════════

function buildScheduleEExcel({ plData, transactions, year }) {
  const { properties } = plData;
  const wb = XLSX.utils.book_new();

  for (const prop of properties) {
    const propTxs = transactions.filter(tx =>
      (tx.property_id === prop.id || tx.property_scope === 'portfolio') && tx.type === 'expense'
    );
    const incTxs = transactions.filter(tx => tx.property_id === prop.id && tx.type === 'income');

    // Tally expenses by Schedule E column
    const schedE = {};
    SCHEDULE_E_COLS.forEach(c => { schedE[c] = 0; });
    for (const tx of propTxs) {
      const cat = tx.category || 'Other';
      const mapped = SCHEDULE_E_MAP[cat] || 'Other Expenses';
      if (mapped) schedE[mapped] = (schedE[mapped] || 0) + Math.abs(parseFloat(tx.amount) || 0);
    }

    const rentalIncome = incTxs.reduce((s, tx) => s + (parseFloat(tx.amount) || 0), 0);

    const rows = [
      [`Schedule E — ${prop.name}`, year],
      [],
      ['Rental Income', rentalIncome],
      [],
      ['EXPENSE CATEGORY', 'Amount'],
      ...SCHEDULE_E_COLS.map(c => [c, schedE[c]]),
      [],
      ['Total Deductible Expenses', Object.values(schedE).reduce((s, v) => s + v, 0)],
      ['Net Rental Income / (Loss)', rentalIncome - Object.values(schedE).reduce((s, v) => s + v, 0)],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 32 }, { wch: 14 }];
    // Format currency cells
    for (let r = 2; r < rows.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
      if (cell && typeof cell.v === 'number') { cell.t = 'n'; cell.z = '$#,##0.00'; }
    }
    const sheetName = prop.name.replace(/[\\/*?:[\]]/g, '_').substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

function buildReadme({ plData, year }) {
  const { properties } = plData;
  const propList = properties.map(p => `  - ${p.name}`).join('\n');
  return [
    `PropertyLens Tax Package — Tax Year ${year}`,
    `Generated: ${generatedStr()}`,
    '',
    `This package was exported from PropertyLens and contains Schedule E-ready data`,
    `for ${properties.length} rental propert${properties.length === 1 ? 'y' : 'ies'} for tax year ${year}.`,
    '',
    'PROPERTIES:',
    propList,
    '',
    'FILES INCLUDED:',
    '  Schedule_E_Ready.xlsx   — Pre-populated Schedule E data, one tab per property.',
    '                            Each tab shows rental income and categorized expenses',
    '                            mapped to IRS Schedule E line items.',
    '',
    '  Full_Transactions.csv   — Complete transaction ledger for the year.',
    '                            Includes date, description, amount, category,',
    '                            property, and tenant for every transaction.',
    '',
    '  PropertyLens_Report.pdf — Full financial report including P&L by property,',
    '                            category breakdown, tenant history, and transaction ledger.',
    '',
    'INSTRUCTIONS FOR CPA:',
    '  1. Open Schedule_E_Ready.xlsx — one tab per rental property.',
    `  2. Each tab maps to a separate Schedule E (Part I) for tax year ${year}.`,
    '  3. Review the "Other Expenses" line — some items may need re-categorization.',
    '  4. Depreciation is NOT included — add separately based on cost basis.',
    '  5. Mortgage interest shown is from bank transactions. Verify against 1098 forms.',
    '  6. If any property has portfolio-wide expenses, those are allocated proportionally.',
    '',
    `PropertyLens | propertylens.app | ${generatedStr()}`,
  ].join('\n');
}

export async function downloadTaxPackage({ plData, transactions, tenants, year }) {
  const zip = new JSZip();

  // Schedule E Excel
  const scheduleE = buildScheduleEExcel({ plData, transactions, year });
  zip.file('Schedule_E_Ready.xlsx', scheduleE);

  // Full transactions CSV (transactions section only)
  const csvLines = [];
  csvLines.push('Date,Description,Amount,Type,Category,Property,Tenant,Rent Month');
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  for (const tx of sorted) {
    csvLines.push(csvRow([
      tx.date,
      tx.display_description || tx.description,
      (Math.abs(parseFloat(tx.amount) || 0)).toFixed(2),
      tx.type,
      tx.category || '',
      tx.property_scope === 'portfolio' ? 'All Properties' : (tx.property_name || ''),
      tx.tenant_name || '',
      tx.rent_month || '',
    ]));
  }
  zip.file('Full_Transactions.csv', csvLines.join('\n'));

  // Full PDF report
  const pdfBlob = buildPDF({ plData, transactions, tenants, year });
  zip.file('PropertyLens_Report.pdf', pdfBlob);

  // README
  zip.file('README.txt', buildReadme({ plData, year }));

  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  saveAs(zipBlob, `PropertyLens_${year}_Tax_Package.zip`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  QUICK EXPORT: Filtered transactions CSV
// ═════════════════════════════════════════════════════════════════════════════

export function downloadFilteredTransactionsCSV(transactions, label = 'transactions') {
  const lines = [];
  lines.push(csvRow(['Date', 'Description', 'Amount', 'Type', 'Category', 'Property', 'Tenant', 'Rent Month']));
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  for (const tx of sorted) {
    lines.push(csvRow([
      tx.date,
      tx.display_description || tx.description,
      (Math.abs(parseFloat(tx.amount) || 0)).toFixed(2),
      tx.type,
      tx.category || '',
      tx.property_scope === 'portfolio' ? 'All Properties' : (tx.property_name || ''),
      tx.tenant_name || '',
      tx.rent_month || '',
    ]));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, `PropertyLens_${label}_${new Date().toISOString().substring(0, 10)}.csv`);
}
