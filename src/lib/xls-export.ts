/**
 * Excel Export utilities for budget data.
 * Generates .xlsx files structured like an industry-standard Top Sheet.
 */

import * as XLSX from 'xlsx';
import type { ProjectBudgetLine } from '@/hooks/useBudgets';
import { BUDGET_CATEGORIES } from '@/hooks/useBudgets';

interface BudgetExportData {
  projectTitle: string;
  budgetLabel: string;
  currency: string;
  lines: ProjectBudgetLine[];
  totalAmount: number;
}

function getCategoryLabel(value: string): string {
  return BUDGET_CATEGORIES.find(c => c.value === value)?.label || value;
}

/**
 * Export budget as a formatted .xlsx Top Sheet — the format financiers and
 * line producers expect when importing into Movie Magic or similar tools.
 */
export function exportBudgetXLSX(data: BudgetExportData) {
  const { projectTitle, budgetLabel, currency, lines, totalAmount } = data;
  const wb = XLSX.utils.book_new();

  // ---- Sheet 1: Top Sheet (summary by category) ----
  const categoryTotals: Record<string, number> = {};
  const categoryLineCount: Record<string, number> = {};
  for (const l of lines) {
    categoryTotals[l.category] = (categoryTotals[l.category] || 0) + Number(l.amount);
    categoryLineCount[l.category] = (categoryLineCount[l.category] || 0) + 1;
  }

  const topSheetData: (string | number)[][] = [
    ['IFFY — Budget Top Sheet'],
    [],
    ['Project', projectTitle],
    ['Version', budgetLabel],
    ['Currency', currency],
    ['Generated', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
    [],
    ['Account', 'Category', 'Amount', '% of Total'],
  ];

  // Standard account numbering (industry convention)
  const ACCOUNT_MAP: Record<string, string> = {
    atl: '1000',
    btl: '2000',
    post: '3000',
    vfx: '4000',
    logistics: '5000',
    schedule: '6000',
    contingency: '7000',
    'soft-money': '8000',
    other: '9000',
  };

  const sortedCategories = Object.keys(categoryTotals).sort(
    (a, b) => (parseInt(ACCOUNT_MAP[a] || '9999') - parseInt(ACCOUNT_MAP[b] || '9999'))
  );

  for (const cat of sortedCategories) {
    const pct = totalAmount > 0 ? ((categoryTotals[cat] / totalAmount) * 100) : 0;
    topSheetData.push([
      ACCOUNT_MAP[cat] || '',
      getCategoryLabel(cat),
      categoryTotals[cat],
      Math.round(pct * 10) / 10,
    ]);
  }

  topSheetData.push([]);
  topSheetData.push(['', 'TOTAL', totalAmount, 100]);

  const topSheet = XLSX.utils.aoa_to_sheet(topSheetData);

  // Column widths
  topSheet['!cols'] = [
    { wch: 10 },
    { wch: 24 },
    { wch: 16 },
    { wch: 12 },
  ];

  // Number format for amount column
  const amountCells = topSheetData
    .map((_, i) => i)
    .filter(i => i >= 7 && topSheetData[i] && typeof topSheetData[i][2] === 'number');
  for (const rowIdx of amountCells) {
    const cell = topSheet[XLSX.utils.encode_cell({ r: rowIdx, c: 2 })];
    if (cell) cell.z = '#,##0';
    const pctCell = topSheet[XLSX.utils.encode_cell({ r: rowIdx, c: 3 })];
    if (pctCell) pctCell.z = '0.0"%"';
  }

  XLSX.utils.book_append_sheet(wb, topSheet, 'Top Sheet');

  // ---- Sheet 2: Detail (all line items) ----
  const detailData: (string | number)[][] = [
    ['Account', 'Category', 'Line Item', 'Amount', '% of Total', 'Notes'],
  ];

  let accountCounter: Record<string, number> = {};
  const sortedLines = [...lines].sort((a, b) => {
    const aAcct = parseInt(ACCOUNT_MAP[a.category] || '9999');
    const bAcct = parseInt(ACCOUNT_MAP[b.category] || '9999');
    return aAcct - bAcct || a.sort_order - b.sort_order;
  });

  for (const l of sortedLines) {
    const base = ACCOUNT_MAP[l.category] || '9000';
    accountCounter[l.category] = (accountCounter[l.category] || 0) + 1;
    const acctNum = `${base}-${String(accountCounter[l.category]).padStart(2, '0')}`;
    const pct = totalAmount > 0 ? Math.round(((Number(l.amount) / totalAmount) * 100) * 10) / 10 : 0;
    detailData.push([
      acctNum,
      getCategoryLabel(l.category),
      l.line_name,
      Number(l.amount),
      pct,
      l.notes || '',
    ]);
  }

  // Total row
  detailData.push([]);
  detailData.push(['', '', 'TOTAL', totalAmount, 100, '']);

  const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
  detailSheet['!cols'] = [
    { wch: 12 },
    { wch: 20 },
    { wch: 32 },
    { wch: 16 },
    { wch: 10 },
    { wch: 30 },
  ];

  // Format amount column
  for (let r = 1; r < detailData.length; r++) {
    const cell = detailSheet[XLSX.utils.encode_cell({ r, c: 3 })];
    if (cell && typeof cell.v === 'number') cell.z = '#,##0';
  }

  XLSX.utils.book_append_sheet(wb, detailSheet, 'Detail');

  // ---- Download ----
  const safeName = projectTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const safeLabel = budgetLabel.replace(/\s/g, '_');
  XLSX.writeFile(wb, `${safeName}_${safeLabel}_topsheet.xlsx`);
}
